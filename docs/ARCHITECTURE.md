# Survive The Night — Architecture & Conventions

Multiplayer co-op horror survival FPS. three.js client (Vite), authoritative Node server on uWebSockets.js,
custom binary protocol with per-client delta compression, client-side prediction + reconciliation,
entity interpolation and server-side lag compensation.

## Layout

```
shared/      code used by BOTH server and client (pure JS, no DOM, no three.js)
  constants.js   tick rates, physics, map, timings
  defs.js        items, weapons, recipes (stations + schematics), structures, containers, car supplies,
                 zombie types, sounds, events (wire ids)
  protocol.js    Writer/Reader, message ids, quantization, snapshot / command packet / entity update layouts
  layout.js      plans the valley for a seed: the course of Route 9, the lake and ponds, which named places
                 there are (PLACES: the core ones + a random draw) and where, and which the roads join
                 (a spanning tree out from Route 9 + loops)
  world.js       deterministic world generation from a seed: builds the plan - terrain, A*-routed roads,
                 roadside/woodland sites, buildings, props, containers, supply spots, doorways,
                 vegetation, colliders. A new playthrough is a new seed (S2C.WORLD_RESET); SEED pins it
  mine.js        the workings under Blackrock Mine: a second level under the heightfield (see The mine below)
  clinic.js      Mercy Clinic and the rule that its wards are dark at noon (see Dark interiors below)
  rail.js        the railway: its heights, the cut and fill, Whitlock Depot, the stalled train (see The railway)
  collision.js   static/dynamic collider grids, ray casts
  surfaces.js    what a blow or a bullet lands on (wood, stone, metal, glass, earth, cloth, rubber) and the mark,
                 the bits and the sound each kind of blow makes on it (see Blows on the world below)
  wrecks.js      a wreck's record of the blows it took, and its alarm (see Blows on the world below)
  playersim.js   deterministic player movement + weapon simulation (prediction on client, authority on server)
  nights.js      night themes: nightTheme(seed, night) picks what a night's horde is made of. The server applies
                 it to the wave weights and the client announces it, each from the seed: nothing on the wire
  progress.js    XP, levels and perks: the rules both ends read (see Experience, levels and perks below)
  nunchaku.js    the nunchucks: their moveset as rules (simNunchaku, NK_MOVES) and the simulation of their chain
                 and free handle that both views draw (ChainSim) - see Nunchucks below
  achievements.js the achievement list (ids, wire numbers, tiers, groups) and the rules on a player's progress
                 (see Achievements below)
  bestiary.js    the bestiary: every kind of the dead, its vague line and its tip, and what seeing one is (see The
                 bestiary below)
server/      authoritative game server (uWebSockets.js)
  index.js       the network thread: sockets, the lobby's HTTP API, static files, /status (see Many games below)
  rooms.js       the lobby: the games running, routing sockets to them, codes, allowances, the leaderboard's side
  room-worker.js one game server: a worker thread running one Game and its tick loop
  wire.js        the packed frames the two threads pass sockets' messages in
  game.js        the simulation of one game (Game), and everything it sends
client/      three.js client (Vite root)
  index.html, main.js
  net/        connection, snapshot decode, interpolation, prediction
  game/       client game state, entity views, input, weather schedule (weather.js)
  render/     renderer, sky, terrain, vegetation, water, post, particles, weather fx, textures, materials, models/
              (models, the viewmodel, held / worn items, pickups: read docs/object-clipping.md before changing them)
  audio/      WebAudio engine: procedural synthesis + CC0 recordings in audio/samples/ (samples.js loads
              them after init; any sound whose file fails to load/decode falls back to its procedural version)
  ui/         DOM HUD (hud.js + hud2.js: compass, objective, world markers, downed, summary), field map
              (mapcanvas.js bakes it, mapscreen.js shows it), splash, inventory/crafting, build menu, chat,
              contextual key hints (keyhints.js: reads the game state once a frame, owns its one HUD line)
  sandbox/    standalone dev pages for visually testing modules (not shipped)
scripts/     dev runner, headless screenshot helper (scripts/shot.js), look-dev harness (scripts/lookdev.js),
             clip checking for models, held items, pickups and world props (scripts/clip/, docs/object-clipping.md)
```

## Conventions

- ES modules everywhere. `import * as THREE from 'three'` on the client.
- Units: meters, seconds, radians. Y is up.
- **Facing:** yaw = rotation about +Y. yaw 0 faces **-Z**. forward = (-sin(yaw), 0, -cos(yaw)).
  Models must be authored so their FRONT faces **-Z**; then `object.rotation.y = yaw` orients them.
- Camera: Euler order `'YXZ'`, `rotation.y = yaw`, `rotation.x = pitch` (pitch > 0 looks up).
- Human player: capsule radius 0.35, height 1.8 m, eye height 1.62 m.
- The camera is not exactly the simulated eye: the client eases it over step-ups and step-downs
  (`Prediction.viewLag`: the simulation takes a kerb or a floor slab within one command) and dips it on landings
  (`Game.landDip`). Presentation only; anything that must agree with the server (where a shot leaves from) uses
  the simulated state, not `camera.position`.
- Materials: prefer `MeshLambertMaterial` (performance). Share geometries and materials; never allocate
  in per-frame paths. The scene keeps a FIXED number of lights (light count changes force shader recompiles);
  toggling a light's `castShadow` also recompiles, so only quality changes do it.
- Textures are procedural canvas textures. Audio is synthesized, with CC0 recordings in
  `client/audio/samples/` (credited in its CREDITS.md; CC0 only) layered over it; every recording keeps its
  procedural fallback (see Audio below).
- Performance budget: 60 fps on a mid-range laptop GPU with ~80 zombies on screen. What a frame costs is mostly the
  number of draw calls it issues, so the big populations are each drawn in a handful: the dead as a crowd (one
  instanced call for all of one body, their bones in one texture: `render/crowd.js`; at most two bones a vertex;
  the humanoid dead swap to a lighter copy of their mesh past `LOD_FAR`), the static world one call a material
  and the terrain one call, each drawing the pieces in sight with a multi-draw (`render/multimesh.js`), instanced
  vegetation culled to the view. How it is measured, the rules that keep it, and what was tried:
  [docs/performance.md](performance.md).

## Networking

One binary WebSocket per client (reliable + ordered, so every delta is simply against "what was last sent").
Layouts live in `shared/protocol.js`; `npm run bench:net` (`scripts/net-bench.js`) measures the traffic of a
seeded session and says where the bytes go - run it before and after touching anything below. Per client it is
about 1.3 KB/s down + 0.4 KB/s up of payload in 40 packets/s in a night-3 fight, and at that size the 40-odd
bytes of TCP/IP + WebSocket framing per packet are half of what crosses the wire: **a new message type costs
more than its bytes**, so put things into the packets that already flow.

- **Up: commands.** The client simulates at 60 Hz and sends one `C2S.INPUT` per server tick
  (`CMDS_PER_PACKET` commands; `Prediction.takeOutbox` sends earlier on a long frame and batches
  `CMDS_PER_PACKET_IDLE` while no key is held and the view is still). `writeInput` / `readInput`: the first
  command in full, the rest as deltas. The packet also carries the render time (lag compensation), a fingerprint
  of the predicted state (`hashPlayerState`) and, every 2 s, a ping bit that `EVT.PONG` answers in a snapshot.
  One render time per packet means a shot must not wait for the batch: a frame that fires or swings sends at
  once. On the server that render time stays with the packet's commands in the queue (`Game.processInputs`
  hands it to `Combat.rewindTime` as each one runs), and the per-tick command allowance banks up while nothing
  arrives (`CMD_QUEUE_MAX`) and refills slightly faster than commands are issued (`CMD_CATCH_UP`), so a burst
  that arrives late after a hiccup is run at once instead of standing in the queue from then on.
- **Early presses** (`client/game/inputbuffer.js`). The simulation acts on the press of fire, reload and jump,
  not on the button being down, so a press that comes a moment before it can act would do nothing. The client
  holds such a press out of its commands' buttons until the first command that can act on it (150 ms for fire
  and jump, the weapon draw for reload), and presses R itself when an automatic runs dry with the trigger held.
  Whether a press acts is asked of `simulatePlayer` on a scratch copy of the state, so a new rule in the
  simulation needs no counterpart there. This only shapes what the client sends: `Prediction.step` simulates the
  shaped command, and the server never knows.
- **Down: one snapshot per tick** (`Game.sendTick`), corked together with the player list and inventory when
  those changed. A flags byte (`SNAP`) says which sections follow; tick and acked command are implied
  (+1, +`CMDS_PER_PACKET`) unless flagged. A client whose socket is backed up is skipped, never sent a snapshot
  that then gets dropped (that would break every delta).
- **Own state** (`Game.writeSelf` / `readSelf`): the simulated part of `p.state` is NOT replicated while the
  client's prediction holds. It is sent (`SELF.SYNC`: the client rebases and replays) only in the first
  snapshot, while dead, when the fingerprint that came with a command disagrees with the server's state after
  that command, or when anything else changed the state - detected by comparing against `p.shadow`, the copy
  taken right after the last command, so code that shoves, teleports, arms or disarms a player needs no
  bookkeeping. On a sync the server rounds its own floats to what went on the wire (`snapPlayerState`) so both
  ends continue from identical numbers. A new field of the simulated state must be added to `copyPlayerState`,
  `samePlayerState`, `snapPlayerState` (floats), `hashPlayerState`, a `writeSelf` chunk and `readSelf`.
  Server-driven values the HUD shows (hp, armor, battery, hold progress...) are the status groups: sent when
  they change. `scripts/test-netsync.js` shoves a player on a laggy link and checks both ends agree again
  within a round trip.
- **An item in the hands** (`state.using`, `Game.useItem`): while a medkit, a tin or a battery is being used,
  `simulatePlayer` fires, swings, throws and reloads nothing, and a fresh click (or a weapon asked for) puts the
  item away unused (`use_cancel`) and brings the weapon back out (`DRAW_TIME`); a button held since before is no
  click. The server runs the use's clock (`updatePlayers`) and finishes it, which brings the weapon out too: that
  covers the round trip it takes the client to hear of it. Starting one needs no rebase: the client sends every
  command it has made before `ACT.USE_ITEM` (`Game.useConsumable`) and has the hands on the item from its next one
  (`Prediction.startUse`), and the server raises `using` on that same command (`p.useItem.from`, the one after the
  newest that had come in). It is the one field of the simulated state in no `writeSelf` chunk: `readSelf` takes it
  from the status's item in use, which the server only names while `using` is up (`Game.endUse`).
- **Entities** (`server/snapshot.js` / `client/net/decode.js`, tables `FIELD_COUNT` + `BIT_SLOTS` in both):
  area of interest per kind, creates in full, updates only for changed fields, sorted by id behind a one-byte
  head (id step, position as a 1 / 2 / 3-byte delta or absolute, which fields follow), far entities every other
  tick. Up to 10 fields per kind; the three most frequently changing ones belong in fields 1-3 (no ext byte).
  Players replicate their view angles at 9 + 7 bits. An entity is read and quantized once a tick for everyone,
  not once per client: `stageEntities` (in `Game.sendSnapshots`, before the client loop) copies the positions
  into typed arrays, `quant` runs the first time a client needs the entity that tick, and each client's
  `writeEntities` only diffs that staged copy against its own baseline. So what `quant` produces must not depend
  on who is looking, and code that changes an entity between two clients' snapshots has to restage it (the one
  case today, `writeSelf` rounding the viewer's own state, is handled in `writeEntities`). The staging arrays
  are allocated once; keep it that way. Every client's snapshot still walks every live entity, so the number of
  entities is what to keep an eye on (see Items on the ground below).
- **Global state**: all of it when anything but the clocks changed, otherwise just time / horde left once a
  second. **Events**: encoded once, filtered per client by radius / recipient; a shot carries no origin (the
  client uses the shooter's replicated position).
- `compression` stays off: permessage-deflate was measured at ~10% of the remaining payload, not worth the CPU.

## Many games on one server: the lobby

One process runs every game. The **network thread** (`server/index.js`) owns the sockets, the HTTP routes and the
leaderboard; **each game is a worker thread of its own** (`server/room-worker.js`: one `Game`, its own 20 Hz tick
loop, its own valley). So the games share the box's cores, generating a valley (a few hundred ms) in one game holds
up nobody else, and a game that crashes or runs out of its 512 MB heap ends alone: the network thread closes its
sockets (1011) and lets go of its records. `server/rooms.js` keeps them (`Lobby`, `Room`).

- **Codes and routing.** A game is known by its code: 6 characters for a public game, 10 for an invite-only one,
  from 32 that cannot be misread. `/ws?game=CODE` is that game; `/ws` with none is a quick join (`Lobby.quick`: the
  public game with the most people that has a seat, one in game over / victory last, else a new public game).
  The network thread answers a socket's first message (its JOIN) with `S2C.ROOM` (code, name, `ROOMF`) before
  passing it on, so the client knows its game - and its invite link - before WELCOME.
- **Seats are sockets.** A game is full when `maxPlayers` sockets are open in it; the network thread turns the
  next away itself (`REJECT_REASON.FULL`; an unknown code is `NO_GAME`). A socket that holds a seat for 15 s
  without joining is closed (`JOIN_WAIT` in room-worker.js), so idle sockets cannot keep a public game full.
- **Traffic between the threads** (`server/wire.js`): every message is a frame `[u16 slot][u32 length][bytes]`,
  packed with the rest of its batch into one ArrayBuffer that is transferred, not copied: socket messages go in
  once per turn of the event loop, a game's sends go out once per tick. A slot whose socket closed is only given
  to a new one once the worker says it is done with it (`'closed'`), so nothing meant for the old socket can reach
  the new. Backpressure crosses as a `SharedArrayBuffer` flag per slot: set by the network thread when a socket
  has over 256 KB unsent, read by the game through `conn.congested()` (it holds that client's snapshots back).
- **The leaderboard** (`PlayerStats`) stays on the network thread. A game's `records` is `RemoteRecords`, which
  posts enter / leave / bump with tokens; asked for the board (`C2S.BOARD`), the game posts who is asking and who
  is in the game and the network thread writes `S2C.BOARD` to the socket itself. The player id crosses to the
  network thread for `PlayerStats.enter` and goes nowhere else.
- **Lifecycle.** A game shuts down once it has been empty for 90 s (a reload, or a host getting the link out
  before joining, keeps it). Making a game: `POST /api/games` (JSON only, so a form on another site cannot).
- **Unlisted means unguessable.** Invite-only games are not in `/api/games` or `/status`. An address that asks for
  over 20 codes that do not exist (one more every 10 s) is told every code is missing for a while, the real ones
  included; an address may make 3 games in a row, then one a minute. `LOBBY_LIMITS=0` lifts both (load tests).
- **One game each, and a total.** A player has one game they made going at a time (`Lobby.make`, `room.maker`: the
  account signed in, else the guest's address; a quick join's game is nobody's): another is a 409 with the code of
  theirs, until it ends. `server_settings.max_total_games` (012, `serversettings.js`, read every 5 s, so it changes
  without a deploy: `npm run setting`) is the most games at once, quick joins' included; unset, only each server's
  `MAX_GAMES`. In a cluster both hold over every server (`Cluster.reserve`, under one lock). `LOBBY_LIMITS=0` lifts
  the one game each too.
- **HTTP:** `GET /api/games` (the public games and what a new one can be), `GET /api/games/:code` (one game,
  invite-only too: the invite card), `POST /api/games` `{ name, host, inviteOnly, maxPlayers }`. `GET /status`
  has per-game tick timings and CPU (`load.cpuMs`: ms of CPU that game's thread used per second), the network
  thread's (`net`) and the process RSS; no codes.
- **Client:** `client/net/lobby.js` (the API, and invite links: `?game=CODE`; while in a game the address bar
  carries its link), the splash in `ui/menus.js` (Quick join, Browse games, Create game, or the invitation of the
  game whose link opened the page), `ui/games.js` (the Browse and Create panels), the invite link behind "Invite friends" on the pause menu.
- **Capacity** (`npm run stress -- game|box`, scripts/stress.js; measured 2 Oct 2026 with bots at night 3 on a
  shared 11-core Mac, so read CPU ms per second, not wall-clock ticks): an 8-player game at night uses ~17 ms of
  CPU a second (45 in its worst second), ~62 MB of memory on a 70 MB base, ~2-2.6 KB/s down per player, and the
  network thread ~0.4 ms of CPU a second per player. A game levels off once its 120 zombies are all up (from
  ~24 players): 48 players in one game was 69 ms a second with a 7 ms tick p99. 64 games of 8 (512 players) ran
  with every game's tick p99 at 1.6 ms and every bot getting 20 snapshots a second. Memory runs out first, then
  the network thread (half a core at ~150 games): `defaultMaxGames` in rooms.js sizes `MAX_GAMES` from the memory
  the process may use (a container's limit when it has one) and caps it at 150. An emptied game builds its next
  valley only when someone joins it (`rollWhenEmpty: false`), not for nobody.

## The database: accounts, friends, messages, stats and match records

With `DATABASE_URL` set the server has a Postgres database (`server/db/index.js`: `pg` for a real server,
`pglite:<folder>` / `pglite:memory` for PGlite - Postgres in WebAssembly, in the process - in development and the
tests). **Only the network thread talks to it**; the games in their workers post what they have to say, as the
leaderboard always has. Without `DATABASE_URL` the server runs as it did before: no accounts, the leaderboard in a
JSON file (`server/stats.js`).

- **Migrations** (`server/db/migrate.js`, files in `server/db/migrations/NNN_name.sql`): applied in name order,
  each once (`schema_migrations`, with a checksum), all pending ones in one transaction under an advisory lock.
  The server migrates as it starts (`MIGRATE_ON_START=0`: not), and a production server whose migration fails
  exits, so that deploy never goes live; `npm run migrate` does the same by hand (and is the pre-deploy command in
  `railway.json`, which Railway has not been applying). An applied migration is never edited: a change is a new file. 001: accounts,
  sessions, `player_stats`, friends, messages. 002: the match tables. 003: the `analytics_*` functions. 006: the
  accounts' achievements. 007: XP, perks and respecs on `player_stats` (see Experience, levels and perks below). 008:
  `game_handoff` and `matches.continues` (Deploys below). 009: the account admin flag. 010: the accounts' bestiaries
  (`user_bestiary`, The bestiary below). A migration has to be additive: on a deploy the old server
  is still running on the schema while the new one migrates it.
- **Accounts** (`server/auth.js`): email + a name to play under (3-16 of letters, digits, `._-`, unique whatever
  the case) + a password (scrypt, node's crypto). Signing in is a random 32-byte token in an `HttpOnly`,
  `SameSite=Lax` cookie (`stn_session`, `Secure` behind https), its SHA-256 in `sessions`, 30 days from last use.
  `userForToken` caches what it found for a minute. Limits: 10 registrations an address then one per 5 min, 10
  sign-ins an address then one per 20 s, 8 wrong passwords an account then one a minute; an unknown account costs a
  scrypt too, and says no in the same words as a wrong password.
- **The API's plumbing** (`server/http.js`): `api(app, method, path, async (ctx, body) => ({ status, body, cookies }))`
  reads all it needs of uWS's request up front (it is only valid until the handler returns) and never writes to a
  response whose client went away. A POST must be JSON and, if it has an Origin, from this host - a page on another
  site cannot post with the player's cookie. The same Origin rule decides whether a WebSocket handshake's cookie is
  believed (`sessionToken` in index.js).
- **Playing signed in.** `/ws`'s upgrade looks the cookie up (async: the upgrade waits for it) and the socket's
  user data carries `{ id, name, isAdmin }`; `Room.attach` passes it to the worker (`{ t: 'open', user }`), `conn.user`, and
  `Game.handleJoin` makes the player's name the account's whatever the JOIN says, sets `p.account` (and
  `p.guestKey`, the SHA-256 of a guest's browser id) and tells everyone in the game who is signed in as what
  (`S2C.FRIENDS`: per player id the account name, '' for a guest), so the client can offer a friend request.
  `isAdmin` authorizes the debug chat commands on the server; the client only hears it as `WELCOMEF.ADMIN` on
  `S2C.WELCOME`, which offers the spawn menu (`client/ui/spawnmenu.js`, the `` ` `` key: a searchable list of every
  item, zombie type and world event that sends `/give`, `/spawn` and the rest as chat, each checked by the server
  as any typed command is). `npm run admin -- <user> [on|off]` updates it
  and revokes that account's sessions; the role is read again when they authenticate and open their next game socket.
- **Stats** (`server/dbstats.js`, `DbStats`, the same face as `PlayerStats`): an account's under `u:<user id>`, a
  guest's under `g:<sha-256 of the browser id>`. The board's four stats are counted as they happen and written
  every 2 s, one upsert for everyone who scored; `board()` is async (Room.board answers when it comes back). Each
  stint of a match adds games, deaths, downs, headshots, boss kills, time and the furthest day
  (`addStint`, from the match store). Registering or signing in with `guestId` (the browser's leaderboard id) moves
  the guest record onto the account, and its match stints with it (`claimGuest`).
- **Friends and messages** (`server/social.js`): a request until accepted, then a friendship stored both ways round.
  Asking someone who asked you accepts them. A friend's presence is `playing` (with the game's info, **its code
  included even for an invite-only game: friends may join friends**, and nobody else learns it), `online` (a
  signed-in page open: its `/social` socket) or `offline` with when they were last seen. `Lobby.userIn/userOut`
  track which accounts are in which room; a change reaches their online friends as `{ t: 'friends', why:
  'presence' }`, coalesced over 400 ms. Messages are only between friends, 1-500 characters, 20 in a row then one
  every 1.5 s; each goes to both accounts' `/social` sockets. The socket only pushes; everything is also in the
  HTTP API, which the page asks again when it hears something changed. Signing out closes that browser's socket
  (4001).
- **Match records** (`server/analytics.js` in the game, `server/matchstore.js` on the network thread): a
  `MatchTracker` in each `Game` (only when the server has a database: `analytics` in the worker's options) turns
  what happens into records - `match`, `match_end`, a `player` per stint, a `night` per night, rare `event`s with
  positions (downs, deaths, revives, bosses, supplies found and installed, the engine...) and a `sample` every 30 s.
  The worker posts each (`{ t: 'an', rec }`); `MatchStore` queues them and writes once a second, one statement per
  table (`jsonb_to_recordset`), a match before what hangs off it, retrying a failed batch one row at a time; past
  50,000 queued it drops and says so. The hot paths (shots, hits, damage) only bump counters on the player's stint.
  A deploy hands each game to the next server (see Deploys below): its match ends as `handoff`, and the next
  server's first match in that game names it in `continues`. A match that could not be handed over is ended as
  `interrupted` and written (`Lobby.finishAll`, the worker's `finish`) before the process goes; a match a crash left
  open is closed once nothing was heard from it for 5 minutes (`closeStale`: not at once, since on a deploy the old
  server is still playing its matches while the new one starts).
- **Client:** `client/net/account.js` (who is signed in, register / sign in / out; `guestId` is `playerId()`),
  `client/net/friends.js` (the `/social` socket with backoff, the friends list, requests, conversations, unread
  counts, `isFriendName`), `client/ui/account.js` (the account panel: sign in / create account, lifetime stats with
  ranks, the last games), `client/ui/friends.js` (requests, the signed-in players in this game to add, friends by
  presence with Chat and Join / Leave & join - which asks `/api/friends/:id/game` first, so it goes where they are
  now - and the conversation view). The splash has an account chip and locks the name field to the account's name;
  a message or request arriving in a game is a system line in the chat, nothing more. `S2C.FRIENDS` fills
  `conn.accounts` (player id -> account name) for the Tab-list star and "In this game".
- **Asking the records** (`003_analytics.sql`): `analytics_overview`, `_daily`, `_by_team_size`, `_night_funnel`,
  `_bosses`, `_death_causes`, `_damage_sources`, `_kills_by_type`, `_weapons`, `_supply_pacing`, `_retention`,
  `_server_health`, each a function of when to count from. `npm run report` (`scripts/analytics-report.js`:
  `--days`, `--since`, `--build <commit>`, `--only`, `--json`) prints them; each match carries the commit it was
  played on (`build`, from `RAILWAY_GIT_COMMIT_SHA`), so a balance change can be judged by the matches since.

## Achievements

- **The list** is `shared/achievements.js`: each achievement has an `id` (its name in storage), an `n` (its number
  on the wire, a u8), a group, a tier (bronze / silver / gold / platinum), an icon and maybe `secret`. Neither id
  nor number is ever changed or reused. A **counter** has a `stat` and a `goal` and unlocks once the player's lifetime
  count of that stat (`ACH_STATS`: kills, nights, escapes, headshots, revives, crafted, salvaged, trees, distance,
  days) reaches it; a **feat** has none and unlocks when the server sees it happen. The pure rules are there too:
  `applyAchievements` (counts and feats in, what newly unlocked out), `sanitizeProgress`, `mergeProgress`.
- **In a game** (`server/achievements.js`, `Game.ach`) hooks sit beside the match tracker's (game.js, combat.js,
  zombies.js, fixtures.js): they only add to the player's counts (`p.ach`) or note a feat. Once a second each
  survivor's position is looked at (distance, the mine, every place in the valley, a swim, a handcar's whole line,
  the Ferris wheel); nothing else is scanned. What a player earned goes out every 3 s, at once for a feat or at
  sunrise. A new achievement is a hook calling `feat(p, id)` or `bump(p, stat)`, and a line in the list.
- **A guest** gets `EVT.ACHIEVE` (a private event in the snapshot: the counts to add and the feats). The browser keeps
  the record in `localStorage['stn.achievements']` (`client/net/achievements.js`), decides the counters, and counts
  the calendar days it joins a game on. The server knows nothing of what it holds, so a feat goes once per connection.
- **An account** is the server's: the worker posts what it earned to the network thread (`{ t: 'ach' }`,
  `Room` -> `AchievementStore` in `server/userachievements.js`), which writes every account's in one transaction
  every 2 s (a feat within 120 ms): the counts added and their totals back, the friendships asked about (a revive of
  someone not on your list; a friend in the same game, from `Lobby.userIn`), and the unlocks, `ON CONFLICT DO NOTHING
  RETURNING` saying which are new. Those go back to the room's worker (`{ t: 'achieved' }`), which tells the player
  (`EVT.ACHIEVE` with `ACHF.ACCOUNT`) and the game, in the chat. Joining a game marks the day for the `days` count.
- **Signing in** merges what the browser earned as a guest since its last merge into the account (`POST
  /api/achievements/merge`: the greater of each count, every unlock of either, `source = 'guest'`). It is taken on
  trust - a browser can say anything - so it only reaches the two achievement tables, never `player_stats`.
  `GET /api/achievements` is your own record, `GET /api/achievements/:id` a friend's.
- **On screen** (`client/ui/achievements.js`): the unlock banner (top right, where the killfeed steps down for it;
  the tier's colour, a shine, confetti for gold, platinum and secrets; queued, ~4 s each; Settings turn banners and
  the chime off; reduced motion takes the movement out), and the profile page from the splash, the pause menu, the
  account panel and a friend's row: counts, the latest, and every achievement by group with its date or progress.
  `/sandbox/ui-test.html?screen=achievements` and `?screen=hud&ach=kills_1000,kill_pistol` show them with made-up data.
- `scripts/test-achievements.js` holds the rules, the hooks in a running game (decoded off the wire), the browser's
  record, the store and the merge on PGlite, and the API on a real server.

## The bestiary

A book of every kind of the dead, opened with J (`bestiary` in shared/binds.js) or from the pause menu. A kind the player
has never seen is a blurred smudge, "???" and a vague line; once seen, its portrait, name and a tip on how to fight it.

- **The book** is `shared/bestiary.js`: every `ZTYPE` once, in the order shown, each with a group, a `vague` line and a
  `tip` (a boss's and the Tank's is its `ZOMBIE_DEFS` tip). A player's record is a bitmask of `ZTYPE`s (u16 on the wire).
- **Seeing one** (`server/bestiary.js`, `Game.bestiary`): one of that kind, alive, within `SEEN_RANGE` (35 m) of the
  survivor's eye with a clear line to its head (`Zombies.clearLine`: walls, trees, the terrain and the mine's rock
  block it; the dark and the fog do not). Each survivor is looked round four times a second through the zombies'
  spatial hash (`forNear`), only for kinds not on their record, at most `LOOK_RAYS` lines of sight a look; a player with
  every kind costs nothing. The record is on the player (`p.bst`), so the handoff carries it.
- **On the wire**: `EVT.BESTIARY` (private): `BESTF.ALL` with the whole record as a player joins and again on a rejoin,
  then each kind as it is first seen; `BESTF.ACCOUNT` says the record is the account's. Held back from a client whose
  socket is backed up (its snapshots, and their events, would be dropped) and sent once it clears.
- **An account's** record is `user_bestiary` (010: a row per account and kind, with when it was first seen), kept on the
  network thread (`server/userbestiary.js`, `BestiaryStore`). It is read once, when the player's record enters a room
  (`Room.record` -> `{ t: 'bestiary', tok, mask }` -> `Game.onBestiary`); until it comes nothing is looked for on their
  behalf. A kind first seen is posted (`{ t: 'seen', user, mask }`) and written within 150 ms, `ON CONFLICT DO
  NOTHING`, retried 5 s later if the write fails. Nothing is read during play.
- **A guest's** is their browser's: `localStorage['stn.bestiary']` (`client/net/bestiary.js`). The server starts each
  connection knowing nothing of it, so a kind the browser has may be told again; the browser only toasts what is new to
  it. Signing in does not move a guest's bestiary onto the account.
- **On screen** (`client/ui/bestiary.js`): the portraits are the game's own models, drawn the first time the book opens by
  a short-lived WebGL renderer of its own, kept as images; a locked card only ever gets the smudge. A toast says when a
  kind is added. `/sandbox/ui-test.html?screen=bestiary` (`&seen=0,1,10`, `&scroll=`, `&toast=1`) shows it with a
  made-up record. `scripts/test-bestiary.js` holds the book, the tracker in a running game, the browser's record, the
  store on PGlite, and an account's record surviving a restart of a real server.

## Experience, levels and perks

A player earns XP over every game they play, and perk points with it to spend on a perk tree. The rules are
`shared/progress.js` (both ends): the XP table (`XP`), the curve (`xpToNext(L) = 200 + 120 L` to `LEVEL_CAP` 30), the
levels a point comes at (`PICK_LEVELS`: `PERK_POINTS`, 10, the last at 30), the tree (`PERKS`) and what a set of perks
does (`perkMods(mask)`: one frozen object per mask; no ordinary stat past `PERK_CAP`, 25%).

- **The tree**: 31 perks, so a survivor at the top level has a third of them. Five branches (Survivor, Gunner,
  Scavenger, Support, Movement), each two perks wide and three tiers deep, where every perk below the first tier needs
  the one above it (`req`); three combinations, each needing a tier 2 perk from two branches; three keystones, one per
  survivor, each needing any tier 3 perk (`reqAny`). A tier opens at its level (`TIER_LEVELS`: 2, 6, 12, combinations
  14, keystones 20), and the points to reach it are earned by then. `perkLock(owned, id, level)` says why a perk cannot
  be taken (`level`, `needs`, `keystone`, `points`, `owned`), `perkDependents` which owned perks need one, `perksValid`
  whether a set could be had (order not looked at). An `id` is a bit of the mask: never reuse or renumber one, none past 30.
- **XP is stored, the level is worked out** (`levelOf`), so the curve can be retuned without touching a record. It is
  awarded on the server only, where the board's stats are bumped (`Game.award`, times Quick Study's `xp`): kills by kind
  (`killXp`: half past `XP.killsFull` in one night or day, nothing for one of the dead that has been after a survivor
  for `WEDGED_FOR` without getting anywhere or striking anything, `z.wedgeT`; nothing for a turned player), bosses,
  revives (`XP.revivesFull` a night), being alive at dawn, a dawn past the furthest day on the record (`p.best`), and the
  escape (more in the car than left behind). Dying keeps what was earned. `/xp <n>` (admin) adds to the record outside
  the run's tally.
- **Where it is kept**: `player_stats.xp` / `perks` / `respecs` (007) or the stats file's `xp` / `perks` / `respecs` /
  `best`, written with the board's stats (`records.bump(rec, 'xp')`, `records.best`). Stored picks are fitted to the
  level and the tree when read (`cleanPerks`, `fitPerks`: what could not be had now is left out, the rest kept, so a
  change to the tree costs nobody all their picks). A guest's progress moves onto their account with the rest
  (`claimGuest`: XP adds up, the account keeps its picks if it has any).
- **Into a game**: a game in a worker hears a joining player's `{ xp, perks, best }` from the network thread
  (`Room.record` asks `stats.progress(rec)`, posts `{ t: 'progress' }`; `Game.setProgress`); a file-kept store answers at
  once. The perks in force are `p.perks`, and `s.perks` carries them into the player simulation: sprint speed, stamina,
  swimming, reload and recoil are predicted, so the field is in `copyPlayerState` / `samePlayerState` /
  `hashPlayerState` and the `SELF.RIDE` chunk like any other. The rest are the server's rules (max health, damage taken,
  item use, search and revive holds, extra finds, gathering, drops, headshots, melee, noticing, knockdown stun, health
  back on a kill or a revive, bleeding, Second Chance).
- **Spending points** is the API's (`server/progress.js`: `POST /api/progress`, `/pick`, `/unpick`, `/respec`; a guest
  posts their browser id): a point on any perk `perkLock` allows, a point back from one nothing else they have needs,
  or every point back (free). A change reaches every game the record is being played in (`Lobby.progressChanged`); one
  made during a night (or the final stand) waits for dawn (`p.perksNext`).
- **On the wire**: `S2C.PROGRESS` (XP on record with this run's in it, `PROGF`, this run's XP by `XP_SRC`) when it
  changed, once a second at most, in the same write as the tick's snapshot; a level byte per player in `S2C.PLAYERS`
  and per row in `S2C.BOARD`, and after the player list's characters a u32 per player of the perks in force. The
  client shows a level-up as it happens, the level in the Tab list and on the board, a level block in the inventory,
  the Perks panel (`client/ui/progress.js` with the tree, `client/ui/perktree.js`: every perk at once, the locked ones
  greyed with a padlock, a tooltip on hover with what it does and what opens it, a click to pick one out and spend a
  point on it; from the splash, the pause menu and the inventory) and the run's XP by source on the end screen.
  `/sandbox/ui-test.html?screen=perks` (`&level=`, `&perks=`, `&sel=`) shows the panel with made-up progress.
  `scripts/test-progress.js` holds all of it, end to end through a real server's worker.
- **A player's profile** (`client/ui/profile.js`): a click while the Tab list is held pins it with the pointer free
  (`Game.pinRoster`; Tab, Esc or its cross let go), and a click on a player opens their profile: their level, this
  game's kills and state, their perks in force (from the player list), an account's lifetime record
  (`GET /api/players/:name`, `DbStats.profile`: what the board shows and the perks, nothing more) and a friend request
  to send, or theirs to accept or turn down (`client/net/friends.js`). `?screen=players&pin=1` / `&profile=<id>` show it.

## Deploys: handing the games to the next server

A deploy does not end the games (`server/handoff.js`, `server/gamestate.js`). Railway starts the new deployment,
sends new connections to it once its health check passes, then sends the old one SIGTERM (`drainingSeconds` in
`railway.json` is how long it has before SIGKILL). On that signal the old server saves every game with players in
it, and the new one carries each on under the same code; its players are away for a second or two. The signal goes to
npm (`npm start`), which forwards it to the `sh -c` running the script: the script `exec`s node so that shell is
node, else the shell dies of it and the container stops with node never told (`scripts/test-start-signal.js`).

- **The old server** (`shutdown` in `index.js` -> `Lobby.handoffAll` -> `Room.handoff`): new sockets are turned away;
  each room's worker is sent `save`, stops its tick loop, ends the match as `handoff` and posts the game saved
  (`envelope(game)`: gzipped JSON). The network thread puts it into the store with the room's meta (name, host,
  invite only, seats, when it was made, the match id) and only then closes every socket of the room with
  `MOVED_CODE` (4002) - a client that came back before the save was in would find nothing. A room that does not
  answer within 8 s, or whose save fails, ends as before (`interrupted`). All of it within a 20 s hard exit.
- **The store.** Postgres in production (`PgStore`: a row per game in `game_handoff`, then `pg_notify('game_handoff',
  code)`); files without it (`FileStore`: `HANDOFF_DIR`, which `npm run dev` sets so a restart on a change keeps
  the games). A save is only ever claimed (`DELETE ... RETURNING` / a rename): one server gets it. Saves nobody
  claims are swept after `HANDOFF_MAX_AGE_SECONDS`.
- **The new server** restores a game (`Lobby.restore`: claim, then a `Room` under the same code with the save in
  its `workerData`) as soon as the store says one is there (`listen`), for any already waiting when it starts, and
  for a socket or an invite card asking for a code it does not have yet (the upgrade waits for it). The worker
  makes its `Game` from the save; a save it cannot use throws in the constructor and the room closes (its players
  get `NO_GAME`, as every deploy used to end).
- **What is saved** (`saveGame` / `loadGame`): the clock, phase, waves and the boss, the car's supplies, the
  schematics, who left with what kit and who left dead, the trees felled and what is used up of the trees and
  wrecks, the loot points' timers, the registry, the players, what was built (colliders and nav put back), the
  containers, the items on the ground (car parts for good), the crates and planes, the zombies with their herds,
  the mounted gun, the fair, the handcars, the bell and the cemetery, the achievements' progress (each player's
  `p.ach`, the run's own in `AchievementTracker.save`) and each player's experience and perks (`xpBase`, `xpRun`: their
  record's XP, looked up again when they come back, already holds this run's, so `setProgress` keeps what was saved).
  Not saved, started again: bullets and rockets
  in flight, burning ground, the deer and the cat, every random stream (reseeded from the seed and the tick), and
  everything derived (nav fields, the zombies' spatial hash, the history buffers, the clients' views).
- **Entities keep their ids.** Everything refers to everything else by id (a zombie's target, a structure's owner, an
  item's dropper, the boss), so the registry - generations, free ids, quarantine - is saved, and each entity takes its
  own id back (`Game.spawnEntityAt`). Ids of what is not brought back are freed.
- **An entity is its plain fields** (`plain`: numbers, strings, booleans, arrays, Sets, Maps and plain objects of
  them; not entities held by reference, typed arrays, class instances or getters). It is loaded by making a fresh one the way its kind is
  made (`Zombies.make` for a zombie, `createPlayer` for a player) and copying the saved fields over it. So a field a
  later build adds is saved without anyone writing code for it, and keeps its default when loading a save made
  without it. A field that holds another object needs a line of its own (an index or an id, linked again on load).
- **The players come back held** (`Game.hold` with `handoff`): their body waits where it was, nothing hurts it, the
  dead pass it by, a leaper or roper on it lets go. The client's JOIN with the same account or browser id gets it
  back (`handleJoin` -> `resume`): the same id, spot, health and backpack. A guest is known by the SHA-256 of their
  browser id (`rejoinKey`), never the id: it is saved. Whoever has not come back within `HANDOFF_RESERVE_SECONDS`
  (180) has left, as after any drop (`parkKit`, `dropAll`). Held places count towards the seats (`Room.noRoom`, the
  worker's `held`), so a quick join does not fill them.
- **Would the save mean the same here?** (`checkEnvelope`, the `worldHash` check in the `Game` constructor.)
  `STATE_VERSION` (handoff.js) must match: bump it when a saved field is renamed or removed or changes meaning or
  units, not when one is added. Every name -> number pair of the enums the save was made with (`ITEM`, `ZTYPE`,
  `STRUCT`, ...) must hold: an entry appended since is fine, one renumbered is not. And the valley must be the one
  this build makes of the seed (`worldHash`: colliders, loot spots, containers, places): positions and indices point
  into it. Any of these failing drops the save; that game ends as before.
- **The client** (`connection.js`, `Game.onMoving`, `moveBack` in `main.js`): a socket closed with `MOVED_CODE`
  keeps the game on screen, input off and the pointer kept, under "Server updating" (`ui.setConnectionStatus`), and
  joins the same code again at once, then every 0.5-2 s for 45 s (`join(..., { resume: true })` keeps the places
  found, the waypoint and the run being recorded, and plays no intro). First it asks `GET /api/version`: when the
  client build (a hash of `dist/index.html`, which names the bundles by content) or the protocol differs from what
  the page was loaded from, it reloads, and the reloaded page goes back in as a reopened one does (`stn.playing`).
  `index.html` is served `no-cache` so the reload gets the new build.
- **Tests:** `test-handoff-state` (the round trip in-process, and the unsaved-field check: both games are walked
  whole, and a field that came back different and is not on its `TRANSIENT` list fails it - a field added and not
  saved fails `npm test` instead of resetting on every deploy), `test-handoff` (two server processes and a third
  that cannot read the save), `test-handoff-store` (both stores, `continues`), `npm run test:e2e:handoff` (headless
  Chrome behind a stand-in for Railway's edge).

## Several game servers: the cluster and the proxy

Off unless `CLUSTER=1` with Postgres; docs/scaling.md has the design, the settings and how to run it.

- **`server/cluster.js`** (one `Cluster` per server, `lobby.cluster`; null when off, and every call site is
  `cluster?.`): the server's row in `cluster_servers` and its games' in `cluster_games` every 2 s (a game made is
  written at once: `room.up`, which `POST /api/games` waits for), per account presence in `cluster_presence`, and a
  bus on the `stn_cluster` notification channel. `pickTarget` is where `Lobby.handoffAll` sends each game on
  SIGTERM; `PgStore.claim(code, me)` (handoff.js) lets only that server take it.
- **`server/social.js`** asks `cluster.statusOf` for friends who are not on this server, and pushes (requests,
  messages, presence) and sign-outs go over the bus as well as to the sockets here.
- **`server/proxy/`**: `router.js` (the servers and games, read every second; where a code, a quick join or a new
  game goes), `tunnel.js` (a WebSocket passed through as bytes, ended between two frames with `MOVED_CODE` when the
  proxy goes down), `index.js` (the HTTP routes, the lobby and `/status` merged from every server).
- **Tests:** `npm run test:cluster` (local Postgres), `scripts/verify-cluster.js` (a cluster that is up).

## The two acts: the island, the bridge, the mainland

A run is two maps (issue #111, `shared/acts.js`). Act 1 is the island: fix the car, survive its final stand, drive
off. That is no longer the victory: the car crosses a broken bridge (`PHASE.CROSSING`, a cutscene) to the mainland,
act 2, where the same loop is played with a plane and flying out wins.

- **A world has its own size.** `world.kind` (`WORLD.ISLAND` / `WORLD.MAINLAND`, which is also the act's number),
  `world.size` / `half` / `gridN`, `world.start` (where a run on it begins) and `world.posScale`. Nothing that
  walks, draws or maps a world reads `MAP_SIZE` any more (that constant is the island's 640 m): the nav grid, the
  zombies' spatial hash, the deer, the herd, the player simulation's edge, the terrain, the field map and the
  minimap follow the world. `worldFor(seed, act)` (`shared/worlds.js`) makes either from the run's one seed.
  The one reader left is `ZombieManager.spread`, the world's ground against the island's (1, or 4 on the mainland):
  the day's roaming dead, the dog packs and their top-ups come that many times over, and the herds (`Herds.want`)
  its square root, so the mainland is not a thinner island. A city (`world.city`) has its streets stocked on top of
  its guards (`CITY_STREET_DEAD`, `spawnStreet`), and a share of the day's top-ups go back there.
- **The mainland** (`shared/mainland.js`) is 1280 m across, built with the island's kit (`shared/worldkit.js`: the
  Builder, the collider grids, the lists a world hands on): the Bridgehead, Port Calder, Kessler Ironworks,
  Eastgate, a truck stop, Calder Field, and twenty-eight places out on the plain (`shared/mainland-places.js`: one
  entry each in `OUTLYING` - how much ground it levels, what road it gets, and a `build`; its loot table is its
  zone's in defs.js; `MAINLAND_ZONES` is the first and the last of them). `world.car` is the plane there (`plane: true`), so everything that asks for "the car" - the reach, the
  supplies, the final stand - asks for it. What the island has and it lacks (mine, railway, fair, clinic,
  cemetery) is `null`.
  - *The plan.* The bridge, the city, the airfield and what hangs off them are set first; the lake is dug where
    there is most room, the marina put on its shore; the rest are put down one at a time on the roomiest of a
    handful of spots (`room()`: `PLACE_GAP` of open country from every other, clear of the city, the airfield,
    Route 9, the lake and the farms' tracks), each weighted by what it wants (the mast high ground, the loggers the
    rim). A farm that no straight track reaches the highway from is left to the county roads. The third pass's
    places go in last, where there is room between those, and a place that finds none takes less open country.
  - *The river.* A line through a few points the seed moves: down out of the rim's hills on the bay's side, along
    the city's edge there and into the bay, which is its mouth (`riverPts`, and `riverD`: how far every vertex of
    the heightfield is from it). The terrain lets a valley down to the water and cuts a bed `RIVER_DEPTH` under it
    (deep water: swum, or crossed). Two of the city's streets run on over it (`Ferry Street`, `Eastgate Road`), and
    a county road may cross it squarely; a road's stretch over it is a `span`: level, `BRIDGE_UP` over the water,
    not written into the heightfield, and carried on a thin deck (thin: server/nav.js walks the dead over a deck)
    with girders and what is left of its railings. `world.river` is `{ pts, hw, bridges }`.
  - *The roads.* Route 9 runs bridge - checkpoint - Main Street - truck stop - airfield. Every other place is joined
    to the nearest road already there by a line that crosses no place and no water (round a corner if no straight
    one does), nearest place first, and turns its front to that road a quarter turn at a time (so its walls lie
    along the nav grid). A road that ends on another comes to that road's height over its last 30 m. A road's
    spline holds each leg's tangents to the leg's own length (no doubling back after a long leg).
  - *Port Calder* is `GRID` x `GRID` blocks of lots. What the run needs and the landmarks (hospital, church,
    cinema, station, filling station, police, bus depot, a collapsed block, three towers) are dealt onto lots
    first; the seed deals the rest. No lot is empty. The upper floors of a walk-in building are solid and shut
    (`block`: a box for every run of storeys on one footprint; `stairBlock`: the stairs under rubble). The streets
    are dressed every few metres (traffic, kerb furniture, rubbish, the dead, heaved slabs, weeds; whatever is solid
    goes through `fits`, which keeps it clear of walls, props, doorways and what is searched), and a few stretches
    get more (`ROADBLOCKS`: a last stand of the army's; `JAMS`; `SINKHOLES`; and the shaft of the first tower lying
    in three lengths across the street beside it and the block beyond - `fall` - broken apart over the roadway,
    where the rubble is the way through; the lots under it are `crushed`). `world.landmarks` names what the field
    map labels inside the city; `world.lights` of kind `smoke` and `fire` are the columns over it (`SMOKES`,
    `FIRES`: drawn by effects.js as `column` and `blaze`).
  - *What the city is drawn from.* The world does not build what is seen of a building out of boxes: it says what
    stands there, and the client's kit builds it (`client/render/citykit.js`). `world.city` carries `buildings`
    (a block of storeys: footprint, storeys, a style - walkup, shopflat, slab, office, glass, warehouse, stone - a
    wall material, and `cut`: what is left of each storey that is not whole), `rooms` (a room that is walked into:
    its openings as the Builder cut them, its partitions, the `zones` those make of it - each painted its own
    colour - the `patches` of tile on its floor, how high its ceiling hangs and of what, so the kit can line it,
    ceil it, floor it, frame its windows, hang its doors and its sign),
    `shells` (walls with the sky behind them: lengths, each broken at its own height), `heaps` (rubble: solid in
    steps a survivor climbs), `fallen`, `pancakes`, and `signs` (a board or a mark from the city's atlas, anywhere).
    Their solids are parts flagged `hidden`: there for collision, the nav grid, the field map and the tests, drawn
    by nobody as boxes. The same helpers (`K.block`, `K.groundRoom`, `K.signAt`, `K.extra`, `K.heap`) build the
    airfield's terminal and tower and the third pass's places.
  - *Its rooms.* A ground floor is not one hall. A block of flats' is its common hall, the stairs up (under what
    came down them) and a flat either side (`flatUnit`: a passage, a living room, a kitchen, a bedroom, a bathroom
    and a small room, at a home's size under a plaster ceiling at `FLAT_CEIL`, each with what was in it); a shop
    has its stock room and an office or a closet behind the floor; the police station its cells' room, its armoury
    and a back office; an office tower's lobby the offices and the post room behind it; Calder General's hall
    triage and a waiting room either side of the desk; the terminal a radio room behind its office. What stands
    against a wall faces the room (a prop's front is its -Z: `ry` 0 against the back wall, PI against the front,
    -PI / 2 against the left, PI / 2 against the right). `drumFire` is the one light in a room that is not the
    day's: a drum somebody keeps burning (a `barrel` and an `embers` light).
  - Props flagged `live` (the car, the plane) are drawn by the client's cutscene code, not the static world;
    `afloat` ones (boats) stand on water; parts flagged `across` are the one thing built in a road.
- **Positions on the wire** stay int16: 1/64 m on the island (+-512 m), 1/32 m on the mainland (+-1024 m).
  `usePos(world)` (protocol.js) sets which; the server calls it as a tick starts, a message comes in or the world
  changes, the client as it loads a world. Nothing on the wire says the scale: both ends know the world.
- **The crossing** (`Game.cross`, `buildMainland`, `arrive`). `driveOff` on the island starts it: the world is
  cleared, the phase is `CROSSING` with `CROSSING.TIME` on its clock, nobody's commands are run. `CROSSING.SWAP`
  seconds in - when the cutscene cuts to black - the server sends `S2C.WORLD_RESET` (seed, act 2), and in the next
  tick builds its own mainland (which holds that game's thread for a moment; the message has left by then),
  populates it and puts the team down at the bridgehead. It can be skipped once everybody connected has asked
  (`ACT.SKIP`) and it is `CROSSING.SKIP_AFTER` seconds old.
- **The checkpoint** (`Game.checkpointAt`): everybody arrives alive - whoever was dead or turned comes back - with
  what they carried, and at the least the bridgehead cache's floor (`Game.bridgehead`, `BRIDGEHEAD` in acts.js: a
  pistol and magazine for whoever has no gun, two magazines in reserve per gun carried, a bandage, a knife, a
  hammer; nothing for whoever has them). What each has then is kept (`game.checkpoint`), and a wipe on the mainland
  starts the mainland again from it (`restartFromBridge`), not the island. A late joiner joins the act being played:
  beside the team, or at the act's start, with `starterKit(day)`.
- **Difficulty** (shared/difficulty.js) is the game's, so it holds on both maps: the mainland's days (`dayLen`: the
  arrival day and the longer days after it, times `diff.day`), its hordes and the runway stand (`hordeSize`), the dead
  themselves, the loot, and the bridgehead's floor, whose rounds and bandages move as the starting kit's do
  (`diff.ammo`, `diff.bandages`: 48 rounds and 2 bandages on Ember, 24 and 1 on Nightfall, 16 and 1 on Blackout).
- **The plane** (`suppliesOf(act)` in defs.js: `PLANE_PARTS` has the shape of `SUPPLIES`, four parts and the fuel by
  threes, so the global state, the rumours and the objective tracker read either). Its parts lie at set places:
  `world.partSpots[k].supply` says which part a spot is for (`placeSupplies`).
- **The runway stand** (`RUNWAY` in acts.js, `updateEscape`): two things to hold in turn - the fuel truck while it
  pumps (`escape.stage` 0), then the plane while its engines warm (1) - then the plane goes only while no more than
  `RUNWAY.CLEAR` of the dead stand on the strip ahead of it (`onRunway`, `NOTIFY.RUNWAY_BLOCKED`). Its groups appear
  round a point `RUNWAY.AHEAD` m down the runway; each stage brings one of the two late bosses.
- **Nights** carry on across the bridge. On the mainland a night is made up as the fourth at the least
  (`nightRank`), and its boss is one of the late ones (`nightBoss(seed, night, act)` in nights.js).
- **The client** loads a world per act (`Game.loadWorld(seed, act)`); `client/game/act.js` holds the act's supply
  list and words, live, for the HUD, the map and the prompts. The terrain is one vertex buffer drawn in culled
  pieces. `client/render/bridge.js` builds the bridge from `shared/bridge.js`'s plan; the car the team came in and
  the plane are `live` props, left out of the static world and drawn by `liveProps` (cutscene.js).
- **The cutscenes** (`client/game/cutscene.js`): `Crossing` and `Takeoff`, sequences of camera shots in the real
  world with the game's own models, off the server's clock (the crossing's is the phase's time left). While one is
  on, `Game.update` takes its camera, hides the HUD, the hands and the players' bodies, and runs no input. The
  survivors in the car are the players as the player list has them - each the character they chose
  (shared/characters.js), seated, this client's own at the wheel - and the dead behind the car and on the runway
  are the game's own models, near or far copy by the shot's camera (`setZombieViewer`).
- **Who a player is** does not change with the map: `p.character` is set once, from the JOIN, and the crossing, the
  checkpoint's revival, a wipe's restart from the bridge, a rejoin into a held body and a deploy's handoff all keep
  the player (sim-act2.js holds each).
- **Saved across a deploy**: `act`, `checkpoint` and `crossing` (gamestate.js `GAME_FIELDS`); the constructor builds
  the save's act.
- **Debug**: `/map2` (or `/mainland`: straight to the mainland's first day from anywhere on the island, the end
  screen too, with no cutscene and no escape XP), `/cross [skip | hold | go]`, `/place <zone>`, `/plane`, `/takeoff [hold | go]`, `/wipe`; on the client
  `game.debugCam`, `debugCycle` and `debugFog` (a free camera, the hour, the haze: the shot scripts).
- **Tests**: `scripts/test-mainland.js` (the map, on any seeds), `scripts/sim-act2.js` (the whole run in simulation,
  a wipe, late joiners, a drop and a deploy across the crossing, the nights, what a tick costs on each map);
  `scripts/clip/act2-shots.js`, `act2-look.js` and `act2-perf.js` (pictures, a look at a list of spots while
  building, and frame times, through `launchChrome`). act2-shots builds the same mainland in node and checks every
  camera against it before the shot is taken (`pickCam`: in nothing solid, in no tree's crown, nothing between it
  and its subject); a run of it is one section or two (`--only`), well inside a browser's life.
- **The city's kit** (`client/render/citykit.js`, called by `StaticWorld` for a world with `world.city`). It
  writes triangles straight into the static world's merged buffers, in a building's own frame: a face is cut into
  bays (`STYLE`), every window an opening with reveals and something in it (glass, shards, the dark, boards -
  `windowState`, by a hash of the building's seed, so it is the same on every client), and from near its frame,
  sill, lintel, curtain, an air conditioner; then what runs the height of a face (`trimOf`: cornice, fins, string
  courses, a fire escape, balconies, a drainpipe, ivy, damp, cracks, a ghost sign), the roof (`roofOf`: parapet,
  tank, plant, stair head, hoarding), a storey broken open (`openStorey`: slab edges with their steel, columns,
  rooms papered each its own way) and a slab under the sky (`terrace`). Marks come from one atlas (`GEN.city`,
  `CITY_ATLAS` in textures.js) through two materials: `citysign` (cut out: boards, lettering, ivy, graffiti) and
  `citygrime` (blended: soot, rust, stains). A glass tower is a curtain wall (`curtainWall`): a band of steel at
  each slab, glass from mullion to mullion over it - whole, hanging broken, or gone, and through the gone ones the
  storey behind (its floor, the slab over it, columns, a desk); a burnt-out place is its own brick or concrete
  under soot laid over each opening, its plaster smoked (`burnt`), its rafters down in the ash; a length of fallen
  tower is torn at its ends (`fallen`: the skin of its last storey off bay by bay, the floor behind end on, beams
  and bars out of it), all of it inside the box the world made solid. A room that is walked into is lined by
  `room()`: there are no lamps, so the day through each opening of its outer walls is laid into the lining's vertex
  colours (`LIT`: brightest by a window, falling off into the room and behind each partition), over plaster that
  carries no mark an eye would pick out twice - the damp, stains, cracks and pictures are decals put on each wall
  by a hash of the room's seed. The static world draws the city in **tiers** (`TIER`): what is read
  from across the city always, a street's things out to 150 m, the fine detail of a face out to 90 m, and what is
  inside a room - its lining and whatever stands under a roof - out to 55 m, the last two with no shadow; every
  plain colour is one vertex-coloured material (`flat`), and its chunks are 128 m (the island's: 80 m, one tier,
  unchanged).

## Rendering pipeline

- **Frame:** world -> `ScreenPasses` (`render/post.js`: SSAO, sun shafts, flashlight beam, applied in place into
  the MSAA scene target with one blended quad) -> eye-adaptation metering -> viewmodel -> bloom -> final pass
  (ACES, horror grade, grain, damage/infected vision) in `render/renderer.js`.
- **Quality presets** (`QUALITY` in `render/renderer.js`: low / medium / high / ultra) own every cost knob:
  pixel-ratio cap, MSAA, sun shadows (map size per cascade, range), which objects cast (foliage, characters,
  flashlight), SSAO, sun shafts, grass density, tree distance. Everything applies live on a settings change
  (`main.js applySettings` -> renderer, Environment.setShadows, Foliage.setQuality, Game.setShadowQuality).
  The render-scale setting multiplies the preset's pixel ratio.
- **Shader warm-up** (`Game.prewarm`): three.js builds a material's program the first time it is drawn and
  waits for it on the main thread, so nothing may be drawn for the first time during play. Behind the splash, and
  again for a new map or another quality, `GameRenderer.compilePrograms` starts every program of the world
  scene, the viewmodel scene and the post passes (`renderer.compile`: the driver builds them in the background)
  and `compileDepth` the shadow passes' depth programs; the frame loop draws nothing until the scene's are
  built; `Game.warmViews` meanwhile builds one of every view that only exists on demand (which also bakes the
  zombie rigs and the weapon and pickup meshes), and `Game.warmFrame` ends it with one frame nobody sees that
  draws one of everything. A player who joins sooner gets the rest in one go on the first frame, as before.
  The rule this buys: `renderer.info.programs.length` does not grow while playing. Anything new that is created
  on demand with a material of its own (an entity view, a lazily built effect) goes into `warmViews`; what is
  already in a scene, hidden or not, is covered.
- **Shared shader state:** `render/globals.js` must be imported first (main.js does). Its `G` uniforms (mist,
  key-light direction, fog sun colour, wind) are injected into every built-in material and every ShaderMaterial
  that merges `UniformsLib.fog` / `.lights`, BY REFERENCE (values survive three's per-material uniform clone).
  Update `.value` fields, never reassign them.
- **Fog:** globals.js replaces three's fog chunks: `scene.fog` (FogExp2) is still the distance haze and still
  bounds what must be drawn (`Environment.fogVisibility`); on top it adds a valley mist layer (analytic
  exponential height integral) and forward in-scattering towards the sun/moon. Custom ShaderMaterials only need
  `fog: true`, `UniformsLib.fog` merged and the fog chunks included. The sky shader inlines `FOG_FUNCS` so the
  horizon matches the fog.
- **Sun/moon:** three's cascaded `SunLight` (`three/addons/lights/SunLight.js`, 2 cascades in one atlas,
  texel-snapped, Vogel PCF) - it lights every built-in material like a DirectionalLight. Casters: terrain,
  static world, trees (+ bushes/rocks and characters on high/ultra), built structures. The static world's
  meshes do not cast themselves: each chunk has one shadow-only mesh per shadow side (`StaticWorld.casters`,
  reading the chunk's own vertex buffer) that the shadow passes draw instead; only materials whose texture cuts
  holes in the shadow (chain link, weeds, stencils) cast from their own mesh. (Since the performance pass a
  material is one `MultiMesh` for the whole world and a caster one per page of positions and shadow side, each
  drawing the runs of the chunks in the frustum being drawn: `render/multimesh.js`, `StaticWorld`.) The shadow
  maps are drawn at most 160 times a second (`render/rates.js`): every frame at ordinary frame rates. The viewmodel scene has
  its own lights; `Game.updateViewmodelLight` rotates the key light into camera space and dims it by a
  ray/crown probe towards the light so hands are dark in shade. Those lights are about a quarter of the
  world's (no factor PI), so the weapon in the hands has its own material, the one Phong material
  (`getViewWeaponMaterial` in `render/models/skinning.js`): per weapon-atlas cell (`VM_SURFACE`) it lifts the
  dark gunmetal and polymer paint and sets the highlight strength, so metal shows its form while wood, tape
  and cloth stay matte. The arms and every world weapon (held by others, lying as pickups) stay Lambert on
  the paint as authored.
- **Sky flares** (the flare gun: `client/game/skyflares.js`, the flight in `shared/skyflare.js`): one more light in
  the pool, a downward `SpotLight` with decay 1 (`Lights.setSky`) that `SkyFlares` gives each frame to the flare
  that lights the ground round the eye most. On the presets with sun shadows it casts one: its near plane follows
  it down (a near plane at 1 m with the flare 80 m up turns any usable bias into metres of depth, and a roof lets
  the light through), and its map is drawn only while one burns, every other frame. What it adds to the ambient,
  the haze and the sky (`Environment.flare` -> `G.uFlareFog` / `uFlareDirW` in `stnFogColor` and the sky shader)
  is kept low, because none of that is shadowed. The shooter's own flare is flown client-side from the shot and the
  server's copy of it is not drawn; the server sends every flare to every client wherever it is (`e.everywhere`,
  past the area of interest), with its age and chute time in the create so a late joiner draws it where it is in
  its burn.
- **Time of day** is one palette table (`KEYS` in `render/environment.js`): colours, light levels, fog, mist,
  haze scatter, shaft strength and base exposure per sun height. Eye adaptation only compensates relative to
  `Environment.adaptRef` (the log-average luminance an open scene has at that light level), clamped 0.7-1.6x.
- **Weathered surfaces** (`SURF` + `surfacePatch` in `render/materials.js`): building surfaces and painted /
  galvanised props are a Lambert tile plus a normal map baked from the generator's height field
  (`getNormalMap`), and the weathering is NOT in the tile. The tile holds the bare material in RGB and a
  tileable wear field in alpha; the shader lays the coat (paint, rust or moss) over it where that field plus
  slow world-space noise crosses a threshold, then adds tonal drift, run-off streaks, damp stains, dust on
  upward faces, a sky sheen on gloss, and (static world) mud splash from `aGround`. So no wall or car repeats
  its damage. The static world lays wall UVs out in world space (courses line up across the pieces of a
  wall) and gives each painted building (`clapboard`, `barn`) one colour through `aTint`. Anything that moves
  uses the same materials without the world noise. `/sandbox/surfaces-test.html?set=walls|roofs|floors|cars`
  shows every surface through the real `StaticWorld`.
- **Look-dev:** `node scripts/lookdev.js --url <vite url> name:x,z,yaw,pitch,cycle[,flash] ...` screenshots the
  real game (non-production server with `GODMODE=1 DEV_ADMIN=1`) and prints uncapped fps, draw calls, triangles and the
  adapted exposure; `--debug 1|2` shows only the sun shafts / only the SSAO.

## Audio

- **Two layers.** Every sound has a procedural bank (`audio/synth*.js`, rendered in workers at start-up) and most
  now have a CC0 recording over it (`audio/samples/*.ogg`, table `REC` in `samples.js`: decode rate, `lazy`, and
  the `[start, dur, ...]` slice table of a multi-take sprite). A recording is used once it has decoded; until then,
  or for good if it fails to load, the procedural bank plays. `R_*` defs in `audio.js` bind a recording to a sound
  (`vol` is relative to the sound's own, calibrated against the procedural bank it replaces; `layer` keeps the bank
  underneath; `far` crossfades to a distant-perspective recording). To add one: drop the Ogg in `samples/`, add
  its `REC` entry and CREDITS.md row (CC0 only), point an `R_*` def at it.
- **Score** (`audio/music.js`): recorded stems crossfaded by game state over the generative score - menu theme,
  sparse daytime tones, night drone, a "dread" layer that follows the nearest zombie, the horde's taiko (muffled
  until something is close) and the boss theme, all in or around D minor. Each generative layer gives way to its
  stem once loaded. Stingers (`STINGERS` in `audio.js`) are recorded cues too, with the procedural ones behind them.
- **Zombie voices** are chosen on the client (`entities.js`): shambling zombies moan (`SOUND.ZOMBIE_MOAN`),
  hunting ones growl, each at its own stable pitch (`e.voice`, passed as `rate`); each carries a breathing loop
  (the engine only plays the nearest few); a kill is followed by the body hitting the ground (`SOUND.BODY_FALL`,
  `delay`). Special infected, dogs and bosses have their own recorded sets. Voices of the `zombie` category
  turn each other down as they pile up (`crowd` in `CATS`): a swarm must not out-shout gunfire or the music.
- **Master bus** (`_buildGraph`): 2:1 glue compressor -> limiter -> soft clipper -> master volume. Kept light on
  purpose: the quiet forest sits ~10 dB under automatic fire and nothing leaves above full scale.
- **Voice chat in the mix** (`VoiceSource`). WebRTC delivers a microphone at about -21 LUFS after Chrome's own gain
  control, some 9 dB under the game, so each voice goes through a leveller (a compressor: an 8 dB spread between
  microphones comes out as 2.5 dB) and the voice bus lifts it to about -12 LUFS within `VOICE_REF` (4 m), level with
  a pistol shot. It thins out gently past that (-7.5 dB at 15 m, -11 dB at `TALK_CLEAR`). While a voice is audible,
  `_duckTick` turns the music down 8 dB and effects + ambience 5 dB, scaled by how loud the voice reaches you; the
  "Lower game for voices" setting turns that off. Measured with a voice 2 m away (voice over the rest of the mix):
  day +14 dB, night +10, horde +7, under automatic fire -1 (it was +3, 0, -7 and -12.5 before).
- **Start-up.** The browser only allows audio after a user gesture, so `main.js` starts the engine on the first key
  or pointer press on the splash (the click on Join at the latest) and nothing waits for it: the join opens the
  socket straight away. Until `audio.ready` (about a second of bank rendering) a one-shot asked for is dropped and
  a loop is only queued, so the game can be in play before there is sound; ambience and music then come in from
  the state of that moment, and `main.js` plays the join stinger it could not play earlier.
- **Checking it without ears.** `/sandbox/audio-test.html` plays everything by hand (`?procedural` for the
  fallback); `?autotest` runs the engine's self-test (every recording decodes, loops are seamless, beds follow
  the state) and ends with `AUDIO_TEST_OK`. `node client/audio/selftest.js` checks the procedural banks.

## The mine: a second level under the heightfield

The valley is a heightfield, so everything about the ground is a function of (x, z). The workings under Blackrock
Mine (`shared/mine.js`, planned by `world.js` once every place stands) are a second level under it, and the rule
that keeps the two apart is in three functions of the world, so nothing that walks, falls, shoots or looks has to
know the mine is there:

- **`world.floorAt(x, z, y)`** is the ground under feet at height y: the terrain, or the floor of the drift they
  are down in. `groundAt` (collision.js) starts from it instead of `heightAt`, so the player simulation, zombies,
  cats, dropped items and thrown things land on the right level. `heightAt` stays the terrain alone: what grows,
  what is built on the surface and what the map shows use that. **Code that puts something on the ground at a
  known height must ask `floorAt(x, z, y)` or `groundAt(world, x, z, y)`; `heightAt` there puts it on the hillside
  above the drift.** (`groundAt(world, x, z, 200)` still means "the highest thing here": the surface.)
- **`world.rayTerrain`** treats the air of a drift as air and the rock round it as the hillside it is, so
  bullets, lines of sight, the flashlight test of the Shade and reach checks stop at the walls, the roof and the
  ground above without any colliders for the rock.
- **`resolveBody`** ends with `mine.confine`: a body below the ground beside a drift is pushed back off the rock
  (the planned distance field, `mine.sdf`: negative inside a drift). Players and zombies never get into the rock,
  so prediction needs nothing new.

The plan (`planMine`): the adit is at the back of the mine yard; the far portal goes to the best of a handful
of spots round every other place (dry, off the roads, clear of what is built there and of the roadside sites).
The main drift runs from one to the other by a dog-leg, the junction; its floor goes down each decline at
`DECLINE`, then as near under the ground as `COVER` allows, and deeper round the junction. Galleries leave the
level stretches and end in rooms. Two grids at 0.5 m are baked over all of it (distance to the rock, height of
the floor) and every query is a bilinear read of them. The terrain is only changed at the portals: a levelled
apron, a mound behind, and `COVER_MIN` of ground over every roof. Inside a portal (the first `PORTAL.HOLE`
metres of the decline, under its stone) the terrain is not drawn (the terrain shader discards it) and the
valley's nav grid is blocked.

- **The dead** (`server/minenav.js`): the valley's flow fields are one flat level, so the workings have a 1 m grid
  of their own with a distance field to whatever cell something is headed for. `Zombies.steerLevels` joins the
  two: a zombie on the surface after a survivor down there walks to the nearer mouth by the valley's field to the
  spot outside it, straight through, and on down the drift, and the other way round. Targeting and noise measure
  the walk round by a portal, not the few metres of rock between the levels (`MineNav.between`; `Zombies.noise`
  takes the height the noise was made at). The dwellers (`z.den`, one to a den of `world.mine.dens`, restocked at
  sunrise by `stockMine`) keep to the workings and go home when led out. No daylight gets down there: `isLit`
  never pins a Shade by day in the mine, and the horde that is down there at sunrise is `spared` until it comes up.
- **Drawing it** (`client/render/mine.js`): the rock is one mesh from the baked grids (floor and roof on the
  grid, walls on the zero contour, roughened into the rock only), with the timber sets and the track
  (`world.mine.frames`) drawn the same way and not as static-world parts. Their materials take the sun, the sky's
  light and the haze's glow by a per-vertex `aSky` (1 in a mouth, 0 well down a drift), so the adit shows black
  from the yard at noon. Everything else down there (zombies, props, items) is lit by the scene's lights, and
  those follow the eye: `Game.under` (0..1, how far down the eye is) fades the hemisphere light, the sun, the
  haze and the rain out in `Environment.update`. The water sheet only covers heightfield cells that dip below the
  water line, since a drift runs down through that level.
- **The strongbox** (`CONT.STRONGBOX`, one to a map, in the deepest room) is what makes the trip worth it. It is an
  ordinary container whose `CONT_DEFS` entry says more than a table: `also` (what is always in it), `loaded` (a
  weapon rolled from it comes with that many magazines, `loadedAmmo`), `once` (not refilled at sunrise) and
  `guide` (what the item tooltips call it). `Game.searchCache` and the item guide both read those, so another
  container can use them too.
- `scripts/test-mine.js` holds all of this on a dozen valleys and in a running game.

## Dark interiors: the wards of Mercy Clinic

The mine's rule, cut down to what a building needs: a place on the surface where it is dark at noon. The ward
wing of Mercy Clinic (`shared/clinic.js`, a place of the random pool) is the only one so far.

- **The rule** is a list on the world, `world.darks`: boxes (in a builder's frame, with a floor and a top), each
  with the mouth the day comes in by. `world.darkAt(x, y, z)` is 0 outside every box and, inside one, rises from 0
  `near` metres from the mouth to 1 at `far` (measured on the flat, a smoothstep): 1 m and 6.5 m, the length of the
  passage from reception, so the wards are wholly dark and the passage goes dark along its length. Server and
  client both ask it; nothing is on the wire.
- **The server** counts a point as in the dark from 0.5 (`WARD_DARK`, `Zombies.inDark`). `Zombies.isLit` gives no
  daylight to a Shade there (its one clause next to the mine's: torches, flares, fires and flashlights pin it as
  anywhere), and `Game.startDay` spares what of the horde stands there at sunrise (`z.spared`, as down the mine:
  it burns when it walks out into the day). The dwellers (`server/clinic.js`, `Wards`, owned by `Zombies`): one
  to a den of `world.clinic.dens` - three walkers by day, one crawling, and a Shade from the second day - restocked
  at sunrise unless a survivor is in the dark, spawned on their own random stream (it is swapped in for the
  game's while they are made). `z.ward` keeps them out of the day's wanderers and, with no one to chase, shuffles
  them between standing spots they have a clear walk to (`clinic.roam`), or takes them back to the hall by a flow
  field of their own when they were led out and left.
- **The client** does what it does down the mine. `Game.under` is the greater of how far down the mine the eye
  is and `darkAt` at the eye, so the sky's light, the sun and the haze go out as a survivor walks down the
  passage, smoothly (`Environment.update`). What is seen from inside is the lining (`clinic.lining`): floor,
  ceiling, the inner face of every wall and the partitions, boxes that world generation takes back out of
  `world.parts` and `client/render/clinic.js` draws with the material of the mine's rock (`material` / `mesh`,
  exported from `render/mine.js`), each vertex taking as much of the day as `darkAt` leaves there. So from
  reception the passage falls away into black, while reception keeps its daylight. The shell of the wing (outer
  walls, boarded windows, roof) is static world as usual: it is lit like any building from outside.
- **What it costs in layout.** No doorway in the wards is in line with the passage, so nothing in them is seen
  from the daylight (zombies and props there are lit by the scene's lights, which follow the eye: from the mouth
  of the passage a walker coming down it is lit as in reception - the mine's rough edge, and here only along the
  passage). Looking back from deep in the passage, reception is as dim as the eye's light makes it. Every doorway
  of the clinic is 1.6 m wide: the place is turned to face its road, and a 1.2-1.3 m doorway in a wall that runs
  askew to the nav grid's 1 m cells has, one map in ten, no cell-to-cell step through it, which closed the wards
  to the horde. `scripts/test-clinic.js` holds the rule, the dead and the drug locker on five valleys and in a
  running game.

## St. Agnes Cemetery: the dead come up out of the ground

- **The place** (`shared/cemetery.js`, `buildCemetery`) is part of the chapel's: the chapel's builder calls it, so
  it is on every map, and `PLACES` gives the chapel a 40 m yard for it (its back gate moved to the right-hand side).
  It has its own random stream. Its railings are parts with no collider of their own plus one `COL.STATIC |
  COL.NOBULLET` box per panel: a body does not pass them, a bullet and a line of sight do, and the nav grid cuts the
  steps across them like any thin wall (the gateway and the two panels that are down stay open). Headstones are
  the `gravestone` / `grave_cross` props, thin enough not to block a nav cell; mounds, pits and the gravel path have
  no colliders. Everything stands on the terrain where it is (the far corners lie past the levelled yard).
  Loot and the casket (`CONT.CASKET`, table `crypt`) are `ZONE.CEMETERY`; the crypt's supply spot is the chapel's.
  `world.cemetery` holds the graves (`{ x, y, z, yaw }`: where one of the dead stands up, and which way it faces),
  `inside(x, z)` for the fenced ground, and what the field map draws.
- **The rule** (`server/cemetery.js`, `Game.cemetery`) is called from five places in `server/game.js` (a new run,
  sunrise, the start of each wave, the tick, `/cemetery`) and one in `Zombies.updateOne`. A wave that starts with a
  survivor within `CEMETERY.NEAR` takes `CEMETERY.SHARE` of its walkers and runners out of its queue into
  `Cemetery.pending`; until they are up they wait in a wave of their own that never starts by the clock
  (`Cemetery.share`, pushed onto `Game.waves`), so the horde the HUD counts does not change. Each is given a grave
  when its turn comes (`pick`: weighted to the graves nearest the survivors, `1 / (1 + d/6)^3`, none within
  `KEEP_OFF` of one, none that gave up its dead in the last `STIR + RISE + REST`). By day `RESTLESS` graves drawn
  at sunrise each wake for the first survivor within `WAKE`.
- **A rise** is `stir` (`EVT.GRAVE`, the grave's index: the warning) and `CEMETERY.STIR` later `rise`: an ordinary
  `Zombies.spawn` whose feet are put a body's height under the grass, `z.riseT = CEMETERY.RISE`. While `riseT > 0`
  `Zombies.updateOne` hands it to `Cemetery.climb`, which only raises it (`riseDepth`: two heaves) and holds
  `ZANIM.RISE`. Nothing else knows: the hitbox goes with `z.y`, so `raycastWorld` stops a shot at the terrain before
  it reaches what is still under it, and the client draws the zombie where it is replicated, the terrain covering
  the rest. `poseRise` (`characters.js`) is the body meanwhile: arms overhead, then hands on the grass, then a knee
  over the lip.
- **On the client** (`client/render/cemetery.js`, `Game.graves`): the broken earth of every grave is one
  `InstancedMesh`, in the scene from the moment the valley loads (warm-up), an instance scaled to nothing until its
  grave stirs. `EVT.GRAVE` plays `SOUND.GRAVE_STIR`, heaves that instance and spits dirt for `CEMETERY.STIR` (and
  shakes the camera through `Game.quake` within 12 m), then `SOUND.GRAVE_BURST`, a spray, and the grave stays
  broken for the run. Walking in through the railings is "Discovered · St. Agnes Cemetery"; the field map draws the
  railings and a cross for every grave, and names the cemetery once the chapel is known.
- `scripts/test-cemetery.js` holds the place on six valleys and the rule in a running game, including a scripted
  night inside a ring of walls built round the chapel.

## Deer: wildlife that can be hunted

The deer (`server/deer.js`, shared numbers in `shared/deer.js`, the view in `client/game/deer.js` and
`client/render/models/deer.js`) are an entity kind of their own, `ENT.DEER` (fields: position, yaw, a `DANIM` state,
the coat in the create), kept in `game.deer` - not a zombie type with a flag. That was the choice between two kinds of
work: a zombie type would have had every system that walks `game.zombies` skip it (the horde's size and waves and
what is left of it, the night summary, kill counts and the leaderboard, the killfeed, the dawn sun, what a noise draws,
the night themes, `/spawn`, the Shade's light test, the leg shots, the cat's fear, the client's dread music and voices),
now and in everything added later; an entity kind needs its own hit registration, history and death, which come down to
a few hooks into code that already exists:

- **Shots and blows.** `Combat.forTargets` hands a survivor's shots and swings the live deer along with the dead, so a
  deer is judged by the same lag-compensated trace: its position is in the 32-tick history (`Game.recordHistory`), and
  `Combat.hitbox` gives it `deerHitbox` - a body cylinder and a head sphere ahead of it, up on the neck or (`DANIM.GRAZE`)
  down in the grass, where the model carries it (`/sandbox/models-test.html?deer=grid&hit=1` prints the skull against
  it). `Combat.damageZombie` passes a hit on a deer to `Deer.damage` before anything zombie-only runs; `legZone` is
  for zombies only. Blasts (`Combat.explode`) and burning ground (`updateAreas`) call `Deer.blast` / `scorch`. The
  client's own-shot prediction (`Game.predictPellet`) tests the same shapes where the deer are drawn, and the view
  follows the zombie's sample ring and fading offset, so the picture the shooter aims at is the one the server rewinds to.
- **Death.** `Deer.kill` drops `DEER_LOOT` through `Game.dropItem` and leaves the body on the wire as `DANIM.DEAD` for
  `DEER.corpse` s; nothing is credited to anyone (no `zkills`, `credit`, `killfeed` or `nightStats`). The hit marker still
  shows the kill. On the client a removed dead deer joins the corpse list (`DANIM.DEAD` is `ZANIM.DEAD`'s number).
- **What they fear.** Every group looks round four times a second (`Deer.threat`): a survivor nearer than `DEER.notice`
  (the multipliers for crouching, lying downed and sprinting are the dead's from `Zombies.chooseTarget`; a survivor down
  the mine is not seen), one of the dead or a player-zombie nearer than `DEER.dread`. `Zombies.noise` hands every noise
  to `Deer.hear`. A bolt (`Deer.refuge`) looks for open woods `DEER.flee` m straight away from it, then at headings
  further round, and the group runs there by a flow field of its own (`nav.computeField('deer' + id, ...)`, one solve
  per bolt or drift) where the straight line is not clear. A group already running ignores what is behind it.
- **Getting about.** The body moves by the collision the dead use (`resolveBody` with `human = false`), never takes a
  step into deep water or a mine portal (`world.mine.inHole`), and a deer that is held up for 0.6 s stops pushing: a
  grazing one gives up that tuft, a running one takes a few strides to the side and then the field again, and after
  three of those it stops where it is. `scripts/test-deer.js` chases groups round the valley for half an hour of game
  time and counts the ticks spent pushing at something (under 0.1%).
- **Its own randomness.** Everything random in `deer.js` comes off `mulberry32(seed ^ 0xdee4)`, the scatter of the drops
  too (`game.rng` is swapped for the deer's stream around `dropItem`), so the game's stream - and `sim-smoke` - is the
  same with deer in the valley as without; the test counts the draws.
- **Numbers and traffic.** Groups: `DEER.groups` of `groupMin`-`groupMax`, `DEER.cap` in all; `Deer.dawn` (from
  `Game.startDay`) walks new groups in from the rim to replace what was hunted. A standing deer costs nothing on the wire
  and grazing deer stand most of the time; one that moves costs about 4-5 B an update at the half rate of anything
  past `LOD_NEAR`. `npm run bench:net` (seed 4242, 4 players): +81 B/s of payload per client in the half-minute standing at
  the car, where two groups in range were being moved about by the dead (+5% on the wire), +37 B/s roaming, +4 B/s
  in the night's fight; no new messages or packets. The server spends about 0.01 ms a tick on them.

## The fair: a ride in the player simulation

The Tri-County Fair (`ZONE.FAIR`, core) is built by `buildFair` in `shared/fair.js`, called from world.js like any
place, and returns `world.fair`: its frame, the generator and its fuel drum, the lamps (light for the Shade) and the
strings of bulbs. The rides' frames, platform and deck are ordinary static parts; what turns is drawn by the client.

- **One clock, in commands.** Both rides turn on one ride clock that only moves while the generator runs, counted in
  commands (`CMD_RATE` to a second), and `seatPos(fair, seat, t)` is where a rider's feet are in a seat (0-7 the
  wheel's gondolas, 8-15 the carousel's horses) when it reads t. A survivor in a seat carries their own reading of it
  in the simulated state: `ride` (seat + 1), `rideT`, `rideGo`. `simulatePlayer` asks `rideStep` at the start of a
  command (moves `rideT` on by one, or decides the rider is out: Space, any speed or air under them that something
  else gave them - a knock, a rope - or having turned) and while it holds them treats them like a pinned player, then
  `rideCarry` puts the body in the seat (crouched height and eye, still, on the ground). That is all prediction needs:
  client and server run the same commands over the same numbers. The server only changes the three fields when the
  client cannot know: boarding (`ACT.RIDE`, `Fair.board`), the generator starting or stopping under riders
  (`Fair.turn`), and a rider whose reading has drifted more than half a second off the wheel's (`DRIFT`: their
  commands stopped coming, or the server dropped some). They travel as the self state's `SELF.RIDE` chunk.
- **The server** (`server/fair.js`, `Game.fair`) owns the wheel's clock (3 commands a tick while it runs), the fuel
  (in ticks) and the generator's rules: `HOLD.FAIR_START` / `FAIR_STOP` on `FAIR_GEN_ID` (a portion of
  the fuel the player carries, `state.ammo[AMMO.FUEL]`, if the tank is dry), `ACT.INTERACT` on `FAIR_TANK_ID` (a portion more), the
  standing noise (`NOISE.FAIR`, every `GEN.noiseEvery` s) and `Fair.lit`, the one call `Zombies.isLit` makes for it.
  The dead in a seat stay in it and go round with it until they rise. Everything a client draws comes from one entity,
  `ENT.FAIR`, in everyone's area of interest: running or not, and the clock and the fuel as server ticks they read zero
  at (`FRF`), so a running fair sends nothing. Which seat a player sits in rides in the top five bits of their
  entity's flags (`PRIDE_SHIFT`).
- **The client** (`client/game/fair.js`, `Game.fair`; meshes in `client/render/fair.js`) draws the whole fair at one
  reading of the clock per frame: a rider's own prediction (their seat must be under them), or for a player on foot
  the server's clock at the interpolation time moved on by the lead their own commands have on it, so that a seat
  being boarded is already where it will be. Every rider - other players too - is drawn in their seat at that reading
  (`Entities`: a player whose flags name a seat slides into it over a fifth of a second), so the ride and its riders
  can never come apart, whatever the link does. A step in that reading (the generator starting or stopping under a
  rider, a correction after a stall) fades out as an offset (`FADE`) instead of jumping. While seated the camera is
  the seat as drawn (`FairClient.carry`), `Prediction.viewLag` leaves rides alone, and [E] on "Get off" is the
  simulation's own jump, pressed for one command (`FairClient.press`).
- `scripts/test-fair.js` holds the rules against the server, and a rider's prediction against it on a laggy link.

## The railway

A single track across the valley from a tunnel in one rim to a tunnel in the other.

- **The course** is planned in `planLayout` (`shared/layout.js`) on a stream of its own (`seed ^ 0x7a11`), after
  Route 9 and the lake and before any place: it crosses Route 9 between the breakdown and the first stop of one
  arm, and each arm runs out to the rim drifting sideways by its own belly. The depot's spot and the stalled
  train's are picked with it; the line is then laid by its turn per metre, with no turn at all along the
  platform and the train (eased in and out), so it is dead straight there and never bends tighter than the
  curve it came from. Of the courses that pass (off the lake, clear of the breakdown, away from the highway for
  good, out through the rim at a fair angle) the one with the least digging is taken. Every other place keeps
  `RAIL_GAP` of woods between its levelled ground and the line, and the ponds keep off it. The depot is `core`
  and sited first (`site: 'rail'`).
- **The heights** (`planRail` in `shared/rail.js`): the raw ground along the line, less the rise of the rim,
  smoothed over a train's length and held to `RAIL.GRADE`; level at `RAIL.DROP` below the depot's yard through
  the depot, and level under the train. Every road meets it at the height of its bed (`pinRoad` in
  `buildRoad`), and the road router pays to run along it (`cost`), so roads cross it rather than follow it. It is
  never a wall to them.
- **The ground** (`grade`, after the roads are flattened in): every vertex within `RAIL.BED` of the centre line
  is set to the bed, and beyond that the ground is clamped to a slope of `RAIL.SLOPE` up or down from it -
  cuttings and embankments. In a bore the bed is wider and the sides steep, under the portal's stone. The bed is
  entered in the road grids as `ROAD.RAIL`, so nothing grows or is built on it and its ground is drawn as a dirt
  road. The heightfield has a point every 2 m, so only about the middle 3 m of the bed is level to the
  centimetre (under the sleepers); the ballast is drawn over the edges. The mine is planned after this, and its
  portals' aprons and the ground it heaps over a thin roof may move the edge of the bed; `settle` puts the bed
  back unless a roof under it needs that ground, and then the track rides over the hump at its ruling grade
  (`rail.humps` counts the vertices kept up: none in 300 valleys tested).
- **Standing on it.** Rails and sleepers are drawn by `client/render/railway.js` and have no collider: the line
  is open ground to bodies and to the nav grid. What stands above the ground to be walked on - the depot's
  platform, the loading dock beside the train, the floors of the two open boxcars - are thin slabs, which the
  nav grid takes as decks (as it takes the pier). They lie level with each other at `RAIL.FLOOR` over the bed,
  and the ground beside them (the depot's yard, the loading bank) is `RAIL.DROP` over it, a step below, so the
  dead walk up onto them; the drop to the bed is a deck's edge. `rail.decks` puts them in `world.floorAt` where
  they stand more than a step over the ground, so what is built, dropped or burnt in a boxcar is on its floor.
  `nav.js` keeps a deck's cut edges in the steps it tests against the real walls (`_deckStep`): beside the car
  the dead would otherwise be sent up the side of the dock. A doorway's jamb can still hold one up for a while:
  the field cuts the corner a body cannot, and it sidesteps until free.
- **The train and the depot** are static-world parts and props (`build`, on its own stream `seed ^ 0x7a12`):
  each car stands on the chord between its ends. A moving train would need none of this changed: the track is
  a polyline with heights a metre apart (`rail.main`), and the stalled train and the cave-ins are what would be
  in its way.
- `scripts/test-rail.js` holds the plan on any number of seeds (`--sweep`), and the bed, the tunnels, the
  boxcars, the dead and a running game on six.

- **Handcars** (`shared/handcar.js`): a flat car with a see-saw pump lever, one or two to a valley
  (`handcars(world)`): beside the depot's platform and 9 m off the Route 9 crossing, or at the end of the train,
  on stretches of open line of `HANDCAR.minRun` or more. The train cuts the main line in two and a car never
  passes it, or the cave-in of a tunnel; two cars on one stretch run into each other. A survivor on a car carries
  it in the simulated state as a rider at the fair carries a seat: `cart` (car + 1), `cartS` (its point of
  `rail.main`, fractional) and `cartV` (m/s along the line). `cartStep` at the start of a command works the lever
  (W / S drive it towards or away from where the rider looks along the line, Shift harder on stamina, `rollCar`)
  or takes them off (Space - [E] is sent as Space, `HandcarClient.press` - with the car's speed, over the side
  they look to; any speed or air that something else gave them, going down, turning); while the lever is worked
  `LEVER_HANDS` (fire, sights, reload) are masked out of the command. `cartCarry` stands the body on the deck behind
  the lever. The fields travel in the self state's `SELF.RIDE` chunk with the fair's.
- **The server** (`server/handcar.js`, `Game.handcars`) keeps one `ENT.HANDCAR` a car (`HCF`: its point of the line
  in 1/32 m, who rides it; the car index in its create record), in everyone's area of interest. A ridden car follows
  its rider's state; an empty one rolls on by itself (`rollCar` with nobody on the lever) until it stops. What the
  rider's prediction cannot know is settled there and written into their state (a rebase, as a knockback is): two
  cars meeting (`meet`: they part at two half-lengths and share the speed they met at, giving a little back) and
  the dead on the line (`strike`: from 3 m/s up knocked aside for 9 damage per m/s, the car a little slower; a Tank
  or a boss stops it dead). `ACT.HANDCAR` gets on a free car in reach; `/handcar [n]` puts you on one.
- **The client** (`client/game/handcar.js`, `Game.handcar`; the model in `client/render/models/handcar.js`, its
  rattle `loop_handcar` in `client/audio/synth-handcar.js`) draws the car we ride where our prediction has it and
  every other at the interpolation time (its point of the line rides in the sample's pitch slot), with the lever
  geared to the distance rolled (`leverAngle`: a stroke every `HANDCAR.stroke` m) and the wheels turning; a player
  riding one is drawn on its deck. While we work the lever our hands on its bar replace the weapon in the view.
- `scripts/test-handcar.js` holds the placement on ten valleys, the rules against the server, and a rider's
  prediction on a laggy link.

## Blows on the world: marks, bullet holes, wrecks taken apart

Anything that strikes the world leaves something there: a knife a slash in a plank wall, a bat a dent in a car door,
a bullet a hole that fits what it went into, a grenade a scorch. Light things rock, windows that are shot enough
fall out, and a wreck that is hit for scrap comes apart blow by blow. Almost all of it is the client's own and
nobody's state; the one thing the server keeps is each wreck's short record of the blows it took.

- **What was struck** (`shared/surfaces.js`). World generation tags every collider it makes with what it is a solid
  of (`col.tag`, set in `shared/worldkit.js`: the material name of a wall's part, or the prop itself), and
  `surfaceOf` turns that - or a tree, a built structure's type, the ground's kind - into one of seven `SURF`s. A
  prop is judged finer than its box: the ray is cast again at the triangles of its model (`Wrecks.ray`), and the
  material of the triangle it strikes is the surface (a car's glass, its tyre, its paint). `'dark'`, the black of
  an opening, and the grass cards round a wreck are passed through (`NO_STRIKE`). The weapon gives the `BLOW`
  (slash, chop, blunt, hammer; a bullet and a blast are blows too). One table each, `[surface][blow]`: the mark
  (`markFor`), what flies off (`bitsFor`), the sound (`soundFor`); a bullet's hole by the gun (`shotMark`: its
  size, the ragged one for the anti-tank rifle, a graze drawn out along an oblique shot). A new material or prop
  type wants a row in `MAT_SURF` / `PROP_SURF`; `scripts/test-wrecks.js` holds the tables.
- **Where the client learns of it** (`client/game/impacts.js`, `Game.impacts`):
  - a melee swing that hit no body is `EVT.STRIKE` from the server (who, the blow, where, which way: 12 bytes, to
    whoever is within 90 m). It replaces the `EVT.IMPACT` and the `SOUND.CHOP` / `SOUND.SALVAGE` a swing used to
    send; the client finds what it struck in its own copy of the world;
  - a bullet is judged where it is fired (`Game.predictPellet`: ours as the trigger is pulled, anyone else's from
    their `EVT.SHOT`, the mounted gun's too) - every pellet of a shotgun leaves its hole, nothing new is on the wire,
    and the server's own `EVT.IMPACT` for the same round is dropped (`sameAsOwn`);
  - a blast is `EVT.EXPLOSION`: rays out from it scorch and pit what stands round it.
- **Marks** (`client/render/marks.js`). Every mark is a quad of one atlas (painted in code, a cell per kind) in one
  mesh: one draw call, lit like the wall it lies on, no draw call at all while there are none. `MarkPool` (no
  three.js in it) is a ring of `MARK_RING` (400) that the newest overwrite - a hundred rounds into one wall cost
  what one does - each fading out after `MARK_LIFE`, plus `MARK_KEPT` slots that stay until given back (a wreck's
  dents). At rest `update()` is one comparison. A mark has an owner - the collider of a structure or a tree, a prop,
  a window pane - and goes with it (`removeOwner`: a wall torn down in `Entities.destroyView`, a tree felled) or
  moves with it (`moveOwner`: a car rocking). A mark is made no bigger than the face has room for (`Impacts.mark`,
  `roomAt` on a model), so it does not hang off an edge. Windows have no collider, so a shot or a swing is asked
  against the panes themselves (`Impacts.paneAt`): `PANE_SHOTS` and one falls out (lifted out of the static world,
  back at dawn).
- **What flies off** (`client/render/strikefx.js`): sparks and dust through the particle pools Effects already
  draws, and `Chips`, one instanced mesh of small solid bits (splinters, grit, flakes, clods, shards, the scrap a
  wreck gives up, which flies to the hand of whoever earned it). Nothing is updated or drawn while nothing is in
  the air.
- **Props that react** (`client/render/wrecks.js`, `liftbatch.js`, `wreckgeo.js`). The static world is merged and
  its vertices live on the card, so a prop that is to change is *lifted*: `StaticWorld.lift` cuts its stretch out
  of every material's runs (and the shadow casters'; `MultiMesh.cut`), `StaticWorld.pieces` builds its triangles
  again, and the `LiftBatch` draws them - one mesh per material for every lifted prop there is, culled prop by
  prop by the rule its stretch of the static world had. Whoever owns a prop writes its run when its shape changes
  and at no other time: a valley of wrecks at rest costs those few draw calls and no work. Only liftable props are
  recorded when the world is built (`liftable`: what gives scrap, and `LIGHT_PROPS`). A light prop (a barrel, a
  crate, a chair) rocks on its base from a blow and is put back the moment it settles.
- **Wrecks** (`shared/wrecks.js`, `Game.wreckHit`, `Wreck` in `client/render/wrecks.js`). A blow on a wreck is put
  on its record beside the salvage left in it (`Game.gather`: `hits`, up to `WRECK_HITS_MAX`, each where it landed,
  which way and with what) and sent to everybody (`EVT.WRECK`); who joins or comes back is sent every record whole
  (`WRECKF.REPLAY`, with `EVT.STRIPPED` as before); a save keeps them; dawn forgets them (`EVT.REGROWN`), and every
  wreck is whole again as every tree stands again. A blast is a blow that takes no salvage (`Game.blastWrecks`).
  **The server does not know what a blow did**: each client works the same wreck out of the same record. Its
  triangles are sorted into the solid pieces the model was built from (`islands`), and those into parts by where
  they are and what they are made of - panes and lamps, wheels, lids and tailgates on their hinges, a door that
  stands ajar, and trim (whatever is small and on the outside). Each blow dents the panel it lands on (the panels
  are cut finer for it, `refine`), leaves a kept mark, and moves the part it struck or is beside one step; a blow
  that took salvage also strips the nearest part still on; at nothing left the wreck is picked clean. What comes
  off is thrown, bounces and lies beside the wreck, clear of every collider - its whole flight worked out when it
  leaves, so a client that was not watching puts it where the others saw it land, and a blow is always judged on
  the wreck as it will stand once everything has come to rest (`Wreck.apply`). `scripts/test-wrecks.js` holds
  watched and replayed wrecks equal to the vertex. The rocking on the springs, the sparks and the sounds are not on
  record: each client's own, from `EVT.STRIKE`. A wreck on record is not built until the eye is within `BUILD_NEAR`.
  A new vehicle needs nothing: the parts are found in its model (a new *kind* of part wants a rule in `Wreck.sort`).
- **The alarm** (`WRECK_ALARM` in `shared/wrecks.js`: every number in one place; `alarmStep` is the whole rule).
  About a fifth of the cars and vans still have a live battery (drawn at a wreck's first hard blow of the day).
  That blow makes it chirp and blink (`EVT.WRECK_ALARM`), which is the warning: from then on a hard blow sets it
  off 45% of the time. A knife never does either. Ringing, it calls the dead every 3 s with the noise any sound
  makes (`Zombies.noise`, 85 m; it spawns nothing, unlike a trunk's alarm) for 18 s, or until a blow on the bonnet
  end kills it. One alarm a wreck a day. The salvage a hit gives is untouched by any of this.
- **Sounds** (`client/audio/synth-strike.js`, `STRIKE_MAP` in `audio.js`, `Audio.strike(name)`): a struck thing is
  an exciter into a bank of modes, with the recorded impact laid over it where there is one, pitched by weapon.

## Gameplay systems (iteration 2)

- **No base.** Structures can be built anywhere (within 7 m of the builder). `STRUCT.DOOR` snaps into the
  doorways recorded by world generation (`world.openings`); campfires and workbenches are crafting stations
  (`STRUCT_DEFS[t].station`), recipes name the station they need (`RECIPES[i].station`) and optionally a
  schematic (`schem`, team-wide unlock bitmask in the global state).
- **Crafting in bulk** (the crafting panel's quantity and Craft ×N, or Shift / Ctrl+click a recipe) is not in the
  protocol: it is `ACT.CRAFT` sent n times. The
  server refuses each craft it cannot do with a toast, so the client counts first: `craftRun` in
  `client/game/bulkcraft.js` repeats the checks of `Game.craft` and the slot rules of `server/inventory.js` on a
  copy of the inventory (and, stricter than the server, only counts ammunition while a whole batch fits the
  reserve). `sim-smoke` holds it against the server, so change the two together. The inventory screen replays
  the crafts still on their way before it counts again (`Crafting._model`), the repeats leave through a bucket
  in `Game.sendCrafts` (the server drops what a client sends past 200 messages a second), and a listener plays
  one craft sound per 0.1 s however many `SOUND.CRAFT` events a tick brings.
- **Auto-crafting** (`shared/autocraft.js`). A build, a craft or a repair short of a material a recipe makes
  (Planks from Sticks, Nails from Scrap Metal, Rope from Cloth, a Torch...) makes it from what that recipe takes,
  when the recipe itself could be crafted there: its station in reach, its schematic found. `planCost(counts, cost,
  ctx)` uses what is carried first and returns what is taken and what the batches made past the need (`give`: ten
  Nails for a wall's four), or null. The server plans with `Game.planFor` (ctx from `Game.craftCtx`) in `build`,
  `craft` and `repair`, pays `take`, and `Game.madeExtra` adds `give` with `addItem` (the overflow at the feet);
  the client plans the same way with `Game.craftContext` in `craftRun`, the crafting panel, the build menu and
  ghost, the build key hint and the tracked recipe. `test-autocraft` holds the two together.
- **Salvage** (`ACT.SALVAGE`: u8 from, u16 count) tears something down for the materials `SALVAGE` in defs lists:
  `from` is a backpack index, `SALVAGE_FROM.WEAPON` + a weapon slot, or `SALVAGE_FROM.ARMOR` (`Game.salvage`). A
  gun's magazine goes back into the reserve as rounds; what does not fit is dropped at the survivor's feet. The table
  gives back less than any recipe takes, so crafting and salvaging never loop into a gain (`test-salvage` holds it).
  Because the starting pistol, knife and hammer are worth something torn down, a leaver's parked kit records which
  of them they still had (`parkKit`'s `tools`), and a rejoin brings back only those.
- **Unequip** (`ACT.UNEQUIP`: u8 weapon slot, u8 backpack index, 255 = the first free one) puts a weapon from its slot
  into the backpack with its magazine (`Game.unequip`): F or a double-click on it in the Loadout, or a drag onto the grid.
  Onto a weapon for the same slot it is `useItem`'s swap; a full backpack leaves it where it is. `test-unequip`.
- **Ammunition** is not in the backpack: `state.ammo` (a reserve per `AMMO` calibre, up to `AMMO_MAX`) is the
  server's record, the simulation reloads from it and the client predicts it. `Game.giveItem` puts a cat `ammo` item
  there and returns what fit, so a full reserve leaves the rest lying; nothing ever puts one into `p.inv`. The
  mounted gun's belt and both generators draw from it too. `ACT.DROP_AMMO` (u8 calibre, u16 count, 0 = all) puts
  rounds on the ground from the inventory's ammo pouch (its popover or right-click menu, any amount); the client hears
  of the smaller reserve in its next snapshot, as it does of a pickup.
- **Undoing a drop** (`ACT.UNDO_DROP`, no arguments). Every drop from the inventory (a stack, rounds, a weapon out of
  its slot, worn gear) records the item entity it made in `p.lastDrop`; the inventory's toast offers to take it back
  for 5 s (Z), and `Game.undoDrop` gives it back as a pickup would, within `UNDO_DROP_TIME` of the drop, while it
  still lies there and its dropper is within `UNDO_DROP_REACH`. Only the last drop, only the dropper's; what finds no
  room stays down, and a refusal is `NOTIFY.UNDO_GONE` (`UNDO_NO`: gone, too late, too far). `lastDrop` is not carried
  across a deploy (`PLAYER_SKIP`). `test-undodrop`.
- **The backpack grid** is always `INVENTORY_MAX` (34) slots long, on the server, on the wire (`S2C.INVENTORY`,
  which ends with the worn backpack's byte) and in the inventory screen; only the first `invCap(p)` are open:
  `INVENTORY_SIZE` (24), and `BACKPACK_SLOTS` (10) more while a Backpack is worn (`p.backpackItem`, beside
  `p.armorItem`). Everything in `server/inventory.js` that puts something in a slot takes that cap (it defaults to
  24, so a call that forgets it cannot fill a locked slot), as do the swap / split bounds and `craftRun`'s copy.
  The backpack does not come off (`ACT.WORN`) while a slot past 24 holds anything, so the locked slots stay empty.
  Worn, it sets `PFLAG.BACKPACK`, and the third-person survivor carries the item's own model on its back.
  The backpack sorts itself (`sortInventory`): each item's stacks merged and the open slots ordered by `BAG_TIER`
  (defs.js), then item id and size: deterministic, and the locked slots are never touched. It runs whenever
  something is picked up (`giveItem`: the ground, searches, harvesting, salvage's yield; not a craft, whose result
  the client predicts in place) or dropped (`ACT.DROP_SLOT`): `p.invSort`, applied once in `sendTick` before the
  inventory goes out. A split (`p.splitKeep`) is left apart. There is no Sort button.
- **The escape.** `SUPPLIES`/`SUPPLY_NEED` in defs; the server hides each supply at one of the candidate
  places' `world.partSpots` every game and replicates the rumoured zones (`global.hints`). A supply that has left
  its hiding place and lies loose (dropped, or `dropAll` where its carrier died; it never despawns) goes out as an
  item and position in `global.parts`, so the field map, the minimap's rim and the objective tracker can say where
  it is wherever the team is: items themselves only replicate inside `AOI_ITEM_RADIUS`. The schematics go
  the same way (`placeSchematics`): each into a locker, ammo crate or toolbox (`CONT_DEFS[t].schem`) of its own
  random place far from the car, the place replicated as `global.schemHints` and drawn on the minimap and the
  field map (`schematicRumours`) until the team unlocks it; which container holds it is not told. (Each act's map
  is stocked the same way, `Game.populate`: the mainland hides the ones the team still lacks in its own places, far
  from the bridgehead, and one the team has is rumoured nowhere - 255.) Installing all
  of them enables the engine hold-interaction, which starts the final stand (`game.escape`). The stand is
  sized from the night of the same number (`hordeSize()` × `FINAL_STAND_SIZE`, the `FINAL_STAND_*` constants
  in `server/game.js`) and re-read from the survivors still alive whenever a group is due; wanderers near a
  survivor join it and count, the rest are removed as at nightfall, and the day's upkeep stops for its length.
  The warm-up (`Game.updateEscape`) only counts down while a survivor on their feet is within `ESCAPE_RADIUS`
  of the car; otherwise it stalls where it is, and the stand keeps coming on its own clock. A warm engine ends
  nothing: a survivor at the car holds [E] (`HOLD.DRIVE`, `ESCAPE_DRIVE_TIME`, the same path and reach as the
  engine-start hold) and `driveOff()` is the victory, for everyone; until then groups keep coming at
  `ESCAPE_LINGER_PACE` of the stand's pace. Two bits of the global state's flags byte carry "stalled" and
  "somebody is getting in" to the HUD, and the client holds its own countdown on a stall. The end screen
  tells each player whether they were within `ESCAPE_RADIUS` when the car left (client side).
  A supply cannot be lost on the way to the car: whatever drops an item (a death, [G], a full backpack, a
  disconnect, loot) calls `Game.dropItem`, which only lets it come to rest where a survivor can pick it up
  again - never on the lake bed off the pier, inside a wall or beyond the edge of the map.
- **Night waves.** `startNight()` builds `NIGHT_WAVES` queues; groups spawn 58-84 m around a random
  survivor (`Zombies.pickSpawnAround`). The horde never targets structures or a fixed point - only people.
  The picker passes over a spot a survivor would watch them appear at (`spawnExposure`: a clear ray from a
  survivor's eyes to head height at the spot, or 4 m to either side of it since a group is scattered that far),
  out to `sightRange()`: the distance the client's haze hides things at for the hour on the phase clock (about
  200 m at noon, 58 m in the dark, so a dark night's spawn band is all cover; the fog keyframes are copied from
  `client/render/environment.js`, the weather is client-only and left out). After 18 candidates it settles for
  one with only its middle hidden, then for the farthest one nobody is facing (`spawnsScreened`, `spawnsInView`
  count those). Rays stop at trunks, walls and terrain; foliage is not modelled. Used by the night waves, the
  final stand, the car-alarm fallback and the straggler teleport.
  Every night's boss (`bossPending`, drawn by `nightBoss(seed, night)` in `shared/nights.js` from `BOSS_POOL`; night 1
  is always The Brute) comes in with wave `BOSS_WAVE`; `Game.spawnBosses` scales its health by `BOSS_HP_PER_PLAYER`
  and `BOSS_HP_PER_NIGHT` (a Tank by `TANK_BOSS_HP` as well). The client draws the same boss from the seed
  (`nightBossText` in `client/ui/hud2.js`) and names it, with the def's `tip`, on the dawn card and at the dusk horn;
  `NOTIFY.BOSS` says when it arrives. A day's length is `dayLength(day)` in `shared/constants.js` (`Game.dayLen`):
  long on days 1 and 2, then `DAY_SHRINK` shorter each day down to `DAY_LENGTH`. A boss drops its loot (`bossLoot`, default 8 rolls) only if it dies before
  the dawn sun sets it alight (`z.onFire`, `Combat.killZombie`); the sun's kill goes to the killfeed as `KILLER.WORLD`.
  The horde takes one new kind a night: `startNight` zeroes the weight of every kind whose `ZOMBIE_DEFS[t].minNight`
  is still to come, and puts the night's new one in the second wave if the draw left it out. By day the kinds are not
  gated by night but by distance from the car (`Zombies.daySpecial`, `DAY_SPECIAL_*`).
- **Noise.** `Zombies.noise(x, z, loud)` is the one entry point: `loud` is the radius (m) the noise carries
  (`NOISE` in constants.js; gunshots use `WEAPONS[w].noise`). Every zombie inside it with no target heads for
  the spot (`alertX/Z`, `alertT`), at a speed set by how loud it was where the zombie stood (`alertRush`,
  `NOISE_RUSH`); a much fainter noise does not replace the one it is heading for (`alertLvl`). Anything that
  should draw the dead (a new weapon, explosive or loud interaction) calls it next to its `game.sound`.
- **Light and the Shade.** `ZTYPE.SHADE` (`ZOMBIE_DEFS[t].shade`) only moves in darkness. Every tick
  `Zombies.isLit` asks whether light reaches it: it is day, it stands within the `light` radius of a burning
  torch / campfire (`STRUCT_DEFS`), a road flare (`THROWABLES`) or a molotov fire, or it is inside a survivor's
  flashlight cone (`FLASHLIGHT_RANGE`, `FLASHLIGHT_CONE`) - each with a clear ray to its head, chest or shins,
  so walls, trees and terrain cast shadows. While lit (`z.lit`) it holds still with `ZANIM.FROZEN`, takes
  `litResist` x damage and no knockback (`Combat.damageZombie`); the client keeps the pose it was caught in
  (`ZombieInstance.hold`) and plays the freeze / release sounds from the replicated anim, with no extra traffic.
- **Power: the generator and its floodlights** (`STRUCT.GENERATOR` 11, `STRUCT.FLOODLIGHT` 12; numbers and the cone in
  `shared/power.js`, the rule in `server/power.js`, the client in `client/game/power.js`). Both are ordinary structures
  (they block, the dead break them, they count to `MAX_STRUCTURES`); everything else hangs off three hooks in
  `server/game.js`: `Power.update` at the top of `updateStructures`, `Power.interact` in `interact` and
  `ACT.GEN_SWITCH` (u16 entity id) in `handleAction`. A generator's tank is `e.burnLeft` (seconds) and its switch
  `e.off`; it runs while the switch is on and there is fuel. Each tick `Power.update` burns the fuel of the running ones,
  raises their hum through `Zombies.noise` every `GEN_HUM_EVERY` (with `game.rng` swapped for the module's own stream
  for the call: the noise scatters where each zombie heads, and a generator must not shift what the rest of a seeded
  run rolls), powers every floodlight within `GEN_RANGE` of a running one and lists the powered cones (lens and axis
  from `floodAim`). `Zombies.isLit` asks `Power.floodLit` (one line, between the point lights and the flashlights): the
  zombie's head, chest or shins inside a cone (`inFloodCone`, allowing for the body's width, like the flashlight)
  with a clear line from the lens (`Zombies.clearLine`, so walls, trees and terrain cast shadows). The lens sits ahead
  of the stand's own collider so that line never starts inside it. On the wire nothing is new: the state byte
  (`SF.STATE`) of a generator is the switch in bit 0 and the fuel in 5 s steps above it (`genState`), of a floodlight 1
  while powered. The client draws from that byte alone (`PowerViews`): the drone loop, the shake and the exhaust of a
  running generator; a floodlight's lens, glare (shrinking off-axis and in haze) and a beam (an additive cone whose
  silhouette fades out, dimmed by the haze instead of tinted, since fog would paint an additive cone the haze's
  colour). The light itself is a pool of `FLOOD_SPOTS` (3) shadowless spot lights created with the game, like
  `render/lights.js`, given each frame to the nearest lit floodlights within `SPOT_REACH`: a fourth lit lamp further
  off keeps its lens, glare and beam and lights nothing. The spot is shaped to the rule (a little wider than
  `FLOOD_HALF`, a soft edge, a slightly negative decay so the ground the lamp grazes 20 m out still shows the cone).
  `[E]` on a generator is decided on the client: a press under `GEN_HOLD` is a tap (`ACT.INTERACT`: pour), held past it
  `ACT.GEN_SWITCH` goes; the item guide counts `STRUCT_DEFS[t].fuel` as a use of that fuel.
  `scripts/test-power.js` holds the rule on any seed.
- **Bats and walls.** Bats fly (`Zombies.updateBat`), and what stops the dead on foot stops them in the air:
  after each tick's flight `flyCollide` puts a bat back outside whatever solid thing it overlaps (static
  colliders, player structures, and `roofBoxes`: every `world.roofs` entry as a block from eaves to ridge,
  because gable roofs and shelter tops are drawn without a collider), on the side it came in from, so it slides
  along a wall or over a roof. They do not use the flow fields. A bat held up on its way to a survivor is shut
  out (`BAT_SHUT_OUT`): it wheels round them, a tight pass over the roofs and then a wider one at window height,
  looks for a clear line every third tick (`batSees`) and comes straight down the first one it gets - a doorway,
  a window, the top of a wall with no roof over it, or the survivor stepping outside.
- **Fire and burning.** `Combat.ignite(z, attacker, weapon, time)` gives a zombie the burn status (`BURN` in
  defs.js; `z.burnT` seconds left, `z.burnBy` / `z.burnWeapon` for the kill). `Zombies.updateOne` ticks it
  through `damageZombie` with `{ fire, dot }` (`fire`: burnt corpse, no loot; `dot`: one small tick of a
  continuous hurt, so it rarely cries out). More fire tops the time back up, it never stacks. It is replicated as
  `ZSTATUS.BURNING` in the zombie's `ZF.STATUS` field (also set while the dawn sun burns the horde), which is all
  the client needs for the flames, the light and the crackle (`Entities.updateBurning`). Anything new that
  should set the dead alight calls `ignite`; the flamethrower and molotov fires do.
  The flamethrower (`WEAPONS[w].flame`) is an ordinary predicted auto weapon, its magazine the fuel tank.
  `Combat.fire` hands its shots to `Combat.flame`: a lag-compensated cone test with a wall check per target
  instead of a ray. Clients draw every `EVT.SHOT` of it as one puff of the stream (`Game.flamePuff` ->
  `Effects.flameJet`) and keep one roar loop per shooter alive while the puffs keep coming.
  `WEAPONS[w].bossMul` (the anti-tank rifle) multiplies a round's damage in `Combat.fire` when what it strikes is a
  boss or a Tank, after the head multiplier; the rounds after the first in a pierce lose 30% each as any gun's do.
- **The RPG** (`WEAPONS[ITEM.RPG].rocket`) is a predicted single-shot weapon like the crossbow (`autoReload`), but
  its shot is no ray: `Combat.fire` hands it to `Combat.launch`, which spawns a `PROJ.ROCKET` projectile from the
  eye along the shot's direction at `rocket.speed`, falling at `rocket.grav`. It is put as far along its flight at
  once as the shooter's own has flown by then: the age of the picture it was aimed at (`rewindTime`) less
  `INTERP_DELAY`, at most `ROCKET_AHEAD`. Its blast is an event, shown on arrival and not drawn behind, so it then
  reaches the shooter about when their grenade gets there. `updateProjectiles` tests each step against the world
  and the ground (`rocketStrikesWorld` in shared/rocket.js, which the client uses too) and the hitboxes of what the
  shooter can damage (`forTargets`, where they are now), and on the first of them, or `range` metres out,
  calls `Combat.explode` with `{ zombies: damage, mark }`: the pipe bomb's blast, plus a hit marker for the shooter.
  Others see the replicated projectile (`Entities`: nose along its flight, `Effects.rocketTrail`, the `rocket`
  loop) and the backblast from `EVT.SHOT`. The shooter's own is not drawn from the wire: `client/game/rockets.js`
  flies it from the moment of the shot with the same numbers, drawn off the muzzle and closing onto the line of
  flight, and ends it where it strikes the world or the dead as drawn, or at a server `EVT.EXPLOSION` on its line of
  flight (its trail drawn on to the blast).
  `scripts/test-rpg.js` holds it against the server.
- **Legs.** `ZOMBIE_DEFS[t].legs` marks what walks on two; the numbers are `LEG_*`, `STUMBLE_*`, `HOBBLE_SPEED`
  and `CRAWL_*` in constants.js. `Combat.fire` calls a hit on the body cylinder below `LEG_ZONE` of the zombie's
  height a leg hit (`legZone`; the left or right leg by which side of the body it struck) and hands it to
  `Combat.hitLeg`: the leg's own health (`z.legHp`, `LEG_HP` of the zombie's) takes all of it, the body
  `LEG_BODY_DAMAGE` of it, and the zombie trips (`z.stumbleT`, `ZANIM.STUMBLE`: slowed, its swing cancelled). A
  leg worn through sets its bit in `z.legs`, replicated as the `ZF.LEGS` field, and sends `EVT.ZOMBIE_LEG` once for
  the piece that flies off. `Zombies.updateOne` hobbles on one leg (`HOBBLE_SPEED`) and crawls on none
  (`crawlSpeed`): a crawler starts no special, turns slowly, reaches and sees from `CRAWL_HEIGHT`, and
  `Combat.hitbox` gives it a low cylinder with the head `CRAWL_HEAD_FWD` ahead, as for a quadruped. Only bullets do
  this: blades, fire and blasts hurt the body as before. On the client the field drives the model
  (`ZombieInstance.setLegs`: the shin bone is scaled away and the stump bone under the thigh shown, the way a shot-off
  head is) and the pose: `poseStumble`, `poseHobble` (one hop per cycle of the phase, the ankle placed and the leg
  fitted to it so the planted foot stays put), `poseCrawl` (prone, every animation state played from the ground; it
  puts the head where the server's hitbox has it, and bends each elbow until the hand is on the ground). The event
  only throws the gib (`Effects.gibLeg`, a piece from the limb pool the overkill gibs use), so a client that was
  not there still sees the right model. `scripts/e2e-legs.js` runs it in the real client; the sandbox's
  `?film=0&legs=3` prints where the head ends up, which is what `CRAWL_HEAD_Y` / `CRAWL_HEAD_FWD` are set from.
- **The mounted gun** (`shared/mountedgun.js`, `server/mountedgun.js`, `client/game/mountedgun.js`, the models in
  `client/render/models/mountedgun.js`). The nest is a prop of the Army Checkpoint (`mg_tripod`, found by
  `gunNest`: only the ammo cans and brass are static); the gun and its tripod are one entity, `ENT.GUN` (belt,
  gunner or carrier, where it was left pointing, the way its tripod faces, and `GUN_STANDS` / `GUN_CARRIED` /
  `GUN_LYING`), made by `startGame`, seen from anywhere. Where it stands is the entity's: every nest goes through
  `snapNest` (the wire's 1/64 m and 1/65536 turn) so the client reads back exactly what the server judges by. Manning it is `ACT.GUN_MAN`, feeding the belt `ACT.GUN_FEED`; neither touches the player simulation,
  so the gunner walks as ever, and letting go is stepping away (`atGrips`, checked by the server every tick and by
  the gunner's own client). It is fired by commands like a gun in the hands, but not by the simulation: while
  manning, the client puts the fire button into its commands as `BTN.GUN` instead of `BTN.ATTACK` (so the weapon
  in the hands stays quiet), and both ends run `stepGun` over the gunner's commands - the server in
  `processInputs` after each one is simulated, the client over the commands each frame's prediction step issued -
  so the client draws a round on the command the server fires it on. A round is `gunShot`: from the gunner's eye
  along their view held inside the arc, through `Combat.fire` with the gun's own row (`ev.def`, `GUN`), so it is
  rewound, pierces and scores like any other. Remote clients draw it from the muzzle (`EVT.SHOT` with
  `MOUNTED_GUN`, id 16, which no item has); the gun turns with the gunner's replicated view, so it costs no
  traffic while it swivels. The gunner's client keeps its own count of the belt while its rounds are in flight
  and takes the server's once they have all landed. Carrying it is in the player simulation, because it changes
  how the carrier moves: `s.hmg` halves every pace (`GUN_CARRY_SPEED`), stops them where the water would float them
  (`waterFloor`: nobody swims with it), skips the weapon block, and a slot request
  clears it with a `gun_drop` event (the switch goes ahead), which the server turns into a gun on its side where
  they stand. Lifting is a server hold (`HOLD.GUN_LIFT` on the gun's entity), setting it up or dropping it
  `ACT.GUN_PUT` (`setUpSpot` finds where, the same on both ends for the prompt); both change `s.hmg` outside the
  commands, so the carrier's client gets a rebase (it rides in the `SELF.RIDE` chunk). `MountedGun.update` drops
  it for a carrier who is down, dead, turned, pinned, roped, away or gone, and clears a stray `s.hmg` on anyone
  else.
- **Reach.** Nothing at arm's length goes through a wall. A survivor's hands (search, revive, pick up) and blade
  (`Combat.meleeClear`) use `canReach` in collision.js: over cover no taller than eye height (barricades, sills,
  fences), through what survivors walk through (gates, door boards). The AI dead (`Zombies.canReach`) and a
  player-zombie's claws need a clear chest-to-chest line, so a barricade stops them too. Melee tests its
  candidates nearest first and stops at the first it can hit: a ray or two per swing, not one per zombie in reach.
- **Containers** are `ENT.CACHE` entities (position + searched state) created from `world.containers`;
  searching is a server-side hold interaction (`ACT.HOLD_BEGIN/END`, progress in the self state).
- **Interaction reach.** The `[E]` prompt comes from `Entities.pick`: the view ray, `INTERACT_REACH` long, has to
  pass within a pick radius of the target (`PICK_RADIUS`, `structPickRadius`). The server takes its distance limits
  from the same constants (`Game.reachOf`) plus `INTERACT_SLACK`, because it handles an action on arrival while
  the commands that moved the player there are still queued; a hold under way is broken off `HOLD_SLACK` further
  out. A refusal is silent, so the server must never be stricter than the prompt: something new to interact with
  needs its radius in both `pick` and `reachOf`. sim-smoke takes each action from the edge of its prompt.
  The target already picked keeps `PICK_STICK` (x1.15) of its radius, so a crosshair on its edge does not flick
  the prompt on and off; that is far inside `INTERACT_SLACK`.
- **Interaction highlight** (`client/game/highlight.js`, `Game.highlight`, the "Interaction highlight" setting:
  off / subtle / strong). A faint outline on `Game.lookTarget` while the prompt offers `[E]` or `[X]`, nothing
  else: info-only prompts get none, and the glints stay the long-range cue (the outlined thing's glint goes out).
  It is an inverted hull: every solid mesh of the target gets a back-face shell pushed out a fixed number of
  pixels along normals smoothed by position, drawn depth-only and then in colour with `EqualDepth` so overlapping
  shells blend once. Two draws per mesh while something is outlined and none otherwise; no stencil, depth
  texture or extra pass, so Low and PS1 mode get it too (it snaps to the PS1 grid). Brightness is divided by the
  exposure, so it reads the same by day and night. Containers, the radio, the car, the fair's generator and
  drum are merged into the static world, so their shells come from a stand-in built from the same prop
  (`createProp`) where world gen put it; a wreck's trunk outlines the wreck; the bell rope is rebuilt from its
  world-gen cylinders. A new kind of [E] target needs a case in `Highlight.targetObject`.
- **Harvesting** is a melee swing that hits nobody: `Combat.melee` then traces the world to the weapon's range
  + 0.3 m and hands a tree (`COL.TREE`) or a wreck (`COL.SALVAGE`: props marked `salvage`) to `Game.gatherHit`
  (6 / 5 hits each, refilled at dawn). What the swing does to what it struck - the mark, the sound, a wreck coming apart -
  is "Blows on the world" below. The sixth hit fells a tree (`Game.fellTree`, `shared/felling.js`): its
  collider leaves the static grid on the server and, by `EVT.FELL` (and `EVT.STRIPPED` for a late joiner), on
  every client, until `EVT.REGROWN` puts them all back; the client hides its instance and `render/fallingtrees.js`
  tips a copy over to land at `FALL_T`, where `SOUND.TREE_FALL`'s crash sits, then dithers it out. The client
  knows none of the hit counts; `client/game/harvest.js` repeats the
  trace and the yields for the interaction prompt ("[LMB] Chop for Sticks and Planks") and for the "Need 2 more
  Planks" lines of a refused build or craft (the server only sends `NOTIFY.NOT_ENOUGH`). `sim-smoke` holds that
  file against the server's swing and yields, so change the two together.
- **Supply drops** (`spawnSupplyDrop`): the server picks a supply spot and a random heading, emits one
  `EVT.FLYOVER` (plane origin at release, heading, eta; constants `PLANE_*` / `CRATE_*`) and PLANE_LEAD / PLANE_SPEED
  seconds later spawns the crate at the cargo ramp with the plane's speed: state 3 free fall, 0 under the canopy
  (it sheds the forward speed and lands exactly on the spot), 1 landed, 2 opened. The client (`render/flyover.js`)
  flies the plane model (`models/plane.js`), trails GPU-animated smoke puffs that linger ~2.5 min and drift with
  the wind, and plays the engine drone as a positional loop (speed-of-sound delay, doppler, air absorption).
  `/airdrop` (debug commands) calls one in. `flySupplyDrop(x, z, heading, y)` is the plane on its own, for a drop
  aimed at a spot (the Relay Station's radio, below); `y` is the height of the ground meant there.
- **Fixtures: the chapel bell and the Relay Station's radio** (`shared/fixtures.js`, `server/fixtures.js`,
  `client/game/fixtures.js`). Things in the world a survivor works with a hold [E] that are neither entities nor
  the car. Their interaction targets are `BELL_ID` / `RADIO_ID` (protocol.js, next to `CAR_ID`), sent with
  `ACT.HOLD_BEGIN` like any hold; `Game.holdBegin` / `updateHold` hand a hold on one of them to `Fixtures`
  (`owns`, `holdBegin`, `holdOk`, `holdDone`), and the kinds `HOLD.BELL` / `HOLD.RADIO` drive the progress ring.
  Where they are is a spot in their place's own frame (`BELL_ROPE`, `BELL_AT`, `RADIO_AT`; `fixtureSpots(world)`
  turns them into world positions); world.js builds the rope (a part of the chapel), the bell (prop
  `church_bell`, in an open belfry) and the radio (prop `radio_set`, under open sky beside the mast) at the same
  numbers, and `scripts/test-fixtures.js` holds the two together. Reach is an entity's: the client offers [E] when
  its view ray passes within `FIXTURE_PICK` of the spot inside `INTERACT_REACH` with nothing in the way
  (`canReach`), the server allows `FIXTURE_REACH`. A pull (`Fixtures.ringBell`) sends `NOTIFY.BELL` and the
  tolls follow from `Fixtures.update`: each is a `SOUND.BELL_TOLL` with no radius (everyone hears it; the `bell`
  category in audio.js carries it across the map) and a `Zombies.noise` of `NOISE.BELL`. A call
  (`Fixtures.callPlane`) spends `RADIO_BATTERIES`, aims `flySupplyDrop` at the caller (pushed a crate's width
  clear of whatever stands beside them, the heading off a stream of its own: the game's is not drawn from) and
  makes a `NOISE.RADIO`; `calledDay` keeps it to one a day, and `phase` to the day. The client keeps what it knows
  of both (the rope's wait, the day's call) from the notices, so its prompt can be out of date for a client that
  joined since; it sends the hold anyway, and the server answers a refusal with `NOTIFY.BELL_WAIT` /
  `NOTIFY.RADIO_NO` (reason in `RADIO_NO`). The item guide lists what a fixture costs (`FIXTURE_USES`) with the
  recipes. `/bell` and `/radio` (debug commands) ring it and go to it.
- **Waypoint and compass.** A click on the field map sets `Game.waypoint` (`MapScreen._pick`: a place's name or
  yard snaps to the place; the map frees the pointer while it is open, the way the inventory does),
  `Game.buildMarkers` shows it as a compass marker and a world marker, and it clears on arrival, with a new game
  and with the world. The team sees it: `Game.shareWaypoint` sends every change (set, moved, cleared, arrived) as
  `ACT.WAYPOINT`, the server keeps it as `p.waypoint` (taken whatever state the player is in, clamped to the map,
  an unknown place id dropped; `startGame` clears them all) and puts it in the player list behind `PLF.WAYPOINT`,
  so a late joiner gets everyone's with the list and a burst of clicks costs one list a tick. `Game.teamWaypoints`
  picks the ones to show - survivors see survivors' (downed too), turned players the turned - one per spot
  (`sameSpot`: a place, or bare spots within `WAYPOINT_REACH`); one on your own spot adds no flag but names its
  owners under yours (`mine`). They are `teamway` markers (teal, `--teamway`; ranked after teammates on the
  compass, not pinned to its ends), flags on the map named for their owners, and a toast when a teammate sets
  one. `Compass.update` (`ui/hud2.js`) lays the markers out in rank order (`RANK`, then the nearer one),
  each taking the room it needs: an icon that would touch one already placed stands aside by an icon's width
  without its text, or becomes a tick on the tape; a label that would touch another is pushed a little
  sideways or dropped; the marker you face (and always the waypoint) spells out its `name`. Label widths come
  from a canvas `measureText` cache, so the pass never reads layout, and the DOM is only written on change.
- **The people: who you play as, and how they are built.** Ten survivors to choose from (`shared/characters.js`:
  ids on the wire, names, roles, one-liners). The splash's card and picker (`client/ui/picker.js`, under "Playing as")
  keep the choice in `localStorage['stn.character']` (an id, or `random`: drawn afresh at each join) and draw the
  portraits and a turntable with a small WebGL renderer of their own, let go of when the game starts. The choice is
  a trailing u8 on `C2S.JOIN`; `Game.handleJoin` keeps it as `p.character` (`characterFor`: an older client that
  sends none, or a value out of range, gets `defaultCharacter(id)`, the look its id picked before the roster), and
  `S2C.PLAYERS` ends with a u8 character per player, after the list, where a client from before the roster stops
  reading. A held player who comes back keeps theirs (resume never reads the new byte), and a turned one is the same
  player, so the same character, dead. `Entities.survivorView` builds the body from the player list's character and
  builds it again if the list says another (the list can arrive after the entity's create).
  The models are procedural (`client/render/models/humans.js`: the head and the body's lofted surfaces;
  `people.js`: a whole person from a look - clothes, hair, hats, kit, the dead's injuries; `looks.js`: the roster's
  looks and `deadLook`, what turns one; `deadlooks.js`: the walkers' variants and the specials' bodies). A head is
  one surface by azimuth and elevation with a painted face in the same layout (`CR.FACE` / `CR.FACE_Z`, 2 x 2 cells
  of the now 4 x 8 character atlas); the torso, arms and legs are each one lofted surface weighted across the spine,
  elbows and knees, and clothing is the visible surface of those lofts cut where a garment ends. Every survivor is
  the same rig (bone names and order) at their own proportions: `SurvivorInstance` takes its `P` from the rig, and
  moves the worn backpack by `packDZ`, how far that body's back is from the default one's.
  `/sandbox/models-test.html?turn=s:3,z:0:1,zv:0:5` draws turnaround sheets (front, side, back, the face) of
  survivors, the turned and zombie variants, and `scripts/test-characters.js` holds the wire rule and the models'
  budgets.
- **Talking.** Chat and voice reach `TALK_RANGE` (clear to `TALK_CLEAR`); beyond it the walkie-talkie carries
  them. Every survivor has one in weapon slot 6 (`SLOT_RADIO`), which holds no item of its own: `state.weapons`
  stays five long, `currentWeapon` answers `ITEM.WALKIE` for it (the viewmodel, the snapshot's held item), and
  `canSelectSlot` allows it even when down. Text is gated on the server: `handleChat` sends each recipient its
  own `S2C.CHAT` flags (`CHATF`: radio / faint / unheard), radio when the speaker had it in hand
  (`radioInHand`). Voice is a peer-to-peer WebRTC mesh the server cannot gate, so the receiving client does it:
  fire held with it in hand keys it (`radioKeyed` in playersim.js, on the simulated `lastBtn`), the server's
  `checkOnAir` puts the change in the player list the same tick (`PLF.ON_AIR`), and `game/radio.js` on each
  client routes that peer through the radio (`Voice.setRadio`, held open 400 ms past the key coming up), plays
  the squelch and keeps the static loop up (`AudioEngine.radioStatic`) while anybody is on the air. Keying it
  opens the microphone as push-to-talk does. Each `VoiceSource` in `audio.js` mixes a positional path with a
  band-limited radio path that takes over as the speaker leaves earshot (or the area of interest).
- **Death lasts until dawn** (`DAWN_RETURN` in constants.js). A survivor who dies becomes a player-zombie
  (`killPlayer`, then `spawnPlayerZombie`). `startDay` calls `returnFallen`: every player who is dead or a zombie
  is a survivor again (`spawnHuman(p, RETURN_KIT, true)`), on the spot `pickJoinSpawn` picks beside the team as
  for a late joiner, and `NOTIFY.RETURNED` tells everyone who. It does nothing with nobody alive: `checkAllDead`
  ends the run on the death that leaves nobody standing, before the clock gets to dawn. The final stand stops the
  clock, so there is no dawn in it. `fallen` holds the names of players who left dead since the last sunrise: a
  rejoin under one of them is a player-zombie again (`handleJoin`), since a JOIN carries no identity but the name.
  At sunrise their parked kit in `leftKits` (empty: the dead dropped theirs) becomes `RETURN_KIT`, so a rejoin
  after it is a survivor with what the dead who stayed woke with.
- **Items on the ground.** Everything that puts an item down goes through `Game.dropItem`, which marks it a
  loose drop (`e.drop`). At most `MAX_DROPS` of them lie around: one more and the oldest despawns (`spawnItem`).
  Car supplies and schematics are permanent and not counted, loot points and hidden supplies are
  not drops. A survivor who dies drops all they carry (`dropAll`); one who leaves the game takes along what they
  were handed at the start (`p.kit`, recorded by `spawnHuman`) and drops only the rest (`parkKit`, see Joining a
  run in progress below), so a reconnect neither litters nor doubles the kit.
- **Coming and going.** `Game.admitJoin` gives each address (`conn.ip`, from `clientAddress` in `index.js`:
  behind a proxy it is the forwarded one) two lobbies' worth of joins at once and one more every `JOIN_EVERY`
  seconds; past that a join is refused as "server full". The "joined" / "left" chat lines have one allowance for
  everybody (`GREET_EVERY`): once it is used up players come and go unannounced, the player list still shows them.
- **Downed/revive** is part of the deterministic player state (`s.downed`: crawl speed, pistol only).
  What the rest of the team sees of a survivor needs no traffic of its own: their health is field 7 of the
  player entity (0..255, always in the area of interest), down / dead / turned is `PFLAG` and the status byte of
  `S2C.PLAYERS`. Nameplates, the compass and the survivors list read those (`Game.buildMarkers`,
  `Game.pushRoster`; the colour marks are `healthTier` in `ui/hud2.js`).
- **Joining a run in progress** (`Game.handleJoin`). `spawnHuman(p, kit, beside)` puts the newcomer down where
  `pickJoinSpawn` says: 2.5-9 m from the survivor with the most company, on a spot that is open on the nav grid, level
  with that teammate, dry, clear of every collider (`resolveBody`) and with a clear knee-high line to them
  (`Zombies.clearLine`) - the one furthest from the dead, out to 22 m if they are all over the nearer ground. It
  returns null (the car spawn) when nobody is alive or the team is within `TALK_CLEAR` of the car. The kit is
  `starterKit(day)`. A leaver's starting kit is not dropped: `parkKit` keeps what is left of it (never more than was
  issued) in `leftKits` by name, and a rejoin during the same run gets exactly that back, so reconnecting creates no
  supplies. Anything that brings a survivor back mid-run should call `spawnHuman` the same way.
- **The personal record** is client-side only: no server state, no traffic. `Game.trackRun` follows the replicated
  phase (not the NEW_GAME / VICTORY / GAME_OVER notifications: a client skipped for a tick loses its events) and
  records a run when it ends, if this client was in it from its first minute (`RUN_JOIN_GRACE`): outcome, nights,
  length in server ticks, the player's own kills since the run began, team size, seed. `client/ui/records.js`
  keeps the last 20 runs plus running totals and bests under `localStorage['stn.runs']` (format at the top of the
  file). Every read goes through `sanitizeRecord` - the stored value is never trusted - and a write that fails
  is kept in memory for as long as the page lives. `scripts/test-records.js` checks it.
- **Weather** is client-side only and adds no network traffic. `client/game/weather.js` derives a seeded
  schedule (fog banks, gales, rain, thunderstorms; weighted toward dusk and night, and the first evening always
  brings fog) from the world seed and the replicated phase clock (`phase`, `day`, `timeLeft`, `phaseLen`), so
  every client sees the same weather. Lightning strikes come from hashed 0.5 s slots of that clock, so they land
  at the same time and place for everyone; each listener hears the thunder after its own distance delay. The
  renderer reads `weather.state` for fog density (and the valley mist), the overcast deck (no sun shafts),
  lightning light, wind (`Foliage.update` drives `G.uWind`: trees bend trunk and crown together, grass and bushes
  lean; the ambience plays the same wind), ground mist, the flashlight beam's haze (post.js, denser in rain), and
  rain streaks and splashes (`render/weatherfx.js`, kept out from under `world.roofs`).
- **The inventory screen** (`client/ui/inventory.js`, the crafting column in `client/ui/crafting.js`). The game does
  not pause under it, so every action is one click or one key: a click selects (the item card under the backpack
  says what it is, with a button and key for each action), a double-click does the main thing, a right click opens a
  menu of drop amounts, and F use · S split · G drop one (Shift+G all) · X salvage · Z undo act on what is under the
  pointer, else what is selected. The keys are the screen's own listener: the game's input is off while it is open,
  and a key bound to opening a screen (`MENU_KEYS`) is left to the game. The backpack is grouped into sections in
  the order the server's Sort leaves it (`SECTIONS`, `BAG_TIER`), and a drag only swaps within one. Recipes are
  grouped by what stops them (ready, needs a station, missing materials, locked); the one selected has a quantity
  that `craftRun` caps.
- **The tracked recipe** (`client/game/tracked.js`): one recipe at a time in `localStorage['stn.tracked']`, client
  only. The HUD checklist under the objective tracker (`Tracked` in `ui/hud2.js`), the "needed for" line on pickup
  prompts and the "may hold" line on containers whose table can roll a missing ingredient (`mayHold` in
  `itemguide.js`) read it; the backpack marks the stacks it would use. Crafting it untracks it.
- **Item guide** (`client/game/itemguide.js`): the "Used in" and "Found in" lines of the inventory's item card are
  derived at load from `RECIPES`, `STRUCT_DEFS`, the loot tables (`CONT_TABLES`, `LOOT_TABLES`, `ZOMBIE_LOOT`,
  `SPECIAL_LOOT`) and `PLACES`, so a new recipe, item or table needs no text written for it. The one thing it
  repeats by hand is `GATHER`, what a hit on a tree or a wreck gives (`Game.gatherHit`): change the two together.
  `scripts/test-itemguide.js` holds every line against the tables, generated worlds (which place tables are
  rolled at all) and the server's gathering. Supply-drop loot (`CRATE_TABLE`, private to the server) is not in it.
## Nunchucks: a moveset, and a chain that is simulated

Every other melee weapon is one swing that lands on the command that makes it. `ITEM.NUNCHAKU` is a moveset, and
half of what is on screen is not animated at all.

- **The rules** (`shared/nunchaku.js`: `NK_MOVES`, `simNunchaku`, called from `simulatePlayer`'s melee branch for
  a weapon with `nunchaku: true`). A move is started by a command (`nk_swing`, with the move) and its blows land a
  set time into it (`melee`, with the move and which of its hits: `Combat.melee` reads that move's damage, reach,
  shove and how many it may strike). A press within `NK.window` of a move's end goes on to the move after it
  (whip, backhand, figure-eight, smash, and round again); otherwise the opener, chosen by how the survivor is
  moving (sprinting: lunge; crouched: sweep; backing away: retreat). The secondary button winds the heavy attack
  up for as long as it is held and strikes when it is let go, at one of three tiers. Every move costs stamina; out
  of breath it is the opener only, at `NK.tired` of its damage.
- **No new state, nothing new on the wire.** Three fields of the simulated state that a melee weapon never used carry
  it: `recoil` is the move under way or last made, + 1; `cooldown` runs on below zero after a move as the combo
  window's clock; `reloadT` counts the heavy wind-up up. So `copyPlayerState`, the fingerprint, `writeSelf` and
  the snapshot are untouched, and `PFLAG.RELOADING` (set from `reloadT > 0`) on a survivor holding nunchucks
  means "winding up", which is how others see the whirl. A move counts once in `fireCount`; which move it was is
  not sent - a watching client works it out the way the rules would (`NunchakuTP.swing`). `scripts/test-nunchucks.js`
  holds all of it, a client predicting it over a laggy link included.
- **The chain** (`ChainSim`). One handle is in a hand: its end of the chain goes where the hand takes it. The other
  is a rigid rod on the chain: two point masses at its radius of gyration (so it turns like a stick, not a
  dumbbell), a rope constraint from the chain's far eye to the hand's (never longer than the chain; slack when it
  is nearer), capsules for the arms, the head and the trunk, the other handle. The links between are drawn, not simulated: an arc
  from eye to eye, every link a chord of one circle (so every link is its length exactly, whatever the slack),
  bowing the way gravity and its own lag take it. A heavy mass on a chain of light particles is what
  position-based dynamics stretch on, and a chain solved link by link crumples and shakes itself straight when it
  is thrown slack and snatched taut inside three frames. Fixed steps of 1/960 s whatever the frame, the hand and
  the colliders moved across them. It decides nothing: a blow lands by the rules above, from the aim.
- **The moves** (`client/render/models/nunchaku.js`: `NunchakuCore`, one for the first-person hands and one on
  each survivor seen). A clip is where the driving hand goes and which way its handle points, where the other hand
  goes, and when the free handle is let go and caught (by the other hand, under the arm, folded against the
  first). The free handle is the simulation's until a catch draws it in. A hand's arm is worked out from its key:
  the elbow swings out as far as brings the forearm square to the handle, and the wrist is not allowed to cock
  further than a wrist does. Clips start from wherever the hands are, so a combo flows; with no clip the hands
  settle to the stance's rest pose and the catch closes. A pass ends a clip with both hands on it and swaps which
  hand drives; clips are written right-handed and played mirrored for the left. The heavy wind-up is no clip: the
  hand leads the handle round (a phase lock on where the simulated handle is), which is the only way a whirl gets
  up to speed. The rig works in pieces of at most 1/120 s of a frame, so a strike is the same at 30 fps as at 144.
- **Nothing is put anywhere; everything follows.** A track's value is where a hand is going, and the hand follows
  it critically damped (the clips are read that much ahead, so a blow stays on its beat): a clip begun in the
  middle of another, a key where a track changes pace, a stance changing are all a target that moved, never a hand
  that jumped. The elbow follows where it should be the same way, and which way it bends is carried from frame to
  frame (a hand passing behind the back has no "toward the pole"); the fist is turned by where the forearm has
  been heading, so wrist and forearm never chase each other; the wrist's limit is a soft one, and which side of
  the forearm a handle leans to rolls round it instead of flipping across. A catch draws the handle into the hand
  (the hand does not go after it) and closes the last of the gap before it counts as held; the give two hands on
  one chain make for each other comes on with the catch and eases off after the release; a handle just let go is
  eased out of the hand it is still inside rather than thrown out of it. `scripts/clip/nunchaku-jitter.js`
  measures all of it - every move and every hand-off between two, both views, 30 to 240 frames a second and uneven
  frames with hitches - and `scripts/test-nunchucks.js` fails on a shake, a pop or a snap.
- **Third person** uses the first person's own hand tracks, carried from the eye's space to the chest's
  (`tpBody`), plus what only an outside view needs: the trunk's twist and lean, the knees, a step (`TP_BODY`).
- **What it looks and sounds like on the client only**: what a blow met (`nkStrike` in `client/game/nunchaku.js`,
  the server's reach and arc on what this client has drawn) takes the free handle off it at once, with a hit-stop
  and a jolt of the view; the sounds (`client/audio/synth-nunchaku.js`) are played off the chain's own motion - a
  whoosh pitched by the free handle's speed, the chain's rattle when it is pulled taut, wood on wood, the slap of
  a catch, and what was struck. Others' are heard from where they stand, off their own simulated chains.
- **Filming it** (`scripts/clip/nunchaku-film.js`, `nunchaku-reel.js`): the page's clock and the game's (`/step`,
  an admin command: the room worker runs a tick only when asked while it is held) are both stepped, a frame at a
  time, and `Game.debugCam` with `body: true` draws our own survivor for a camera outside the eye.
