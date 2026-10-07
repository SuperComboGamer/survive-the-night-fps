# Deploys: what happens to the games being played

A deploy must not end a game, hurt a player, or interrupt play for longer than it takes to change servers - and four
deploys in three minutes must be as safe as one. This is how that is done, what it needs from the host, what it costs
a player (measured), and where it still falls short. The code is described in [ARCHITECTURE.md](ARCHITECTURE.md),
"Deploys: handing the games to the next server".

## What a deploy does

1. **The new server starts beside the old one** and passes its health check (`/status`). Once it listens it puts its
   own build in the handoff store (`server/builds.js`: its code and its client, signed - see below), when pinning is
   on; a server told to stop before that is done finishes it first, while the next server builds the valleys.
2. **The old server is told to stop** (SIGTERM). It takes no new sockets, and says which games it is about to hand over
   (seed, act, the valley's fingerprint: `Lobby.announce`). The new server builds each of those valleys in the worker
   that will run the game (`Lobby.prepare`, `prepareWorld`) and says when each is ready. **The games go on being played
   meanwhile**; the old server waits at most `HANDOFF_PREPARE_MS` (3000) for that word.
3. The old server saves every game with anybody in it into the store (Postgres table `game_handoff`, or files in
   `HANDOFF_DIR`), and only then closes that game's sockets with close code 4002.
4. The new server takes each save and loads it into the worker that built its valley (a few ms), or makes the game
   from scratch if there is none. Three things can happen:
   - **Its own code reads the save** (the usual case): the game goes on, on the new code.
   - **Its own code cannot** - the state version or an enum changed, or the build makes another map of the game's
     seed (`worldPrint`: its shape, or the lie of its land). Then the game's worker is started from **the build that
     saved it**, fetched from the store (`Lobby.afterFailed`). The game goes on exactly as it was, old simulation and
     old map, inside the new server. Its players keep that build's client: the page for the game's code
     (`/?game=CODE`) is that build's, so is `/api/version?game=CODE`, and its files are served by their names. The game
     is kept out of the lobby's list and quick joins (the new client cannot play it); its invite link still works, and
     a page of the new client that tries to join it in the page is sent to that game's page instead. At the next
     deploy it is handed on the same way, still naming its build (a later build that can read the save again - the
     change was reverted - simply carries it on with its own code). It closes when its run is over (after the end
     screen), or at the first dawn once it has been on the old build for `HANDOFF_PIN_MAX_HOURS` (12): its players are
     told why, and their next game is on the new build.
   - **Neither can be done** (see "What can still end a game"): the game is over. Its code is remembered for half an
     hour, and anyone who comes for it is told, once, that an update ended it (`REJECT_REASON.ENDED_MAP` /
     `ENDED_UPDATE`).
5. **Each page comes back by itself** (`client/net/moveback.js`). It asks `/api/version?game=CODE` and compares it with
   what the page was built as (written into the page by the server: `<meta name="stn-build">`):
   - the same protocol and the same **compat** (`server/compat.js`: a hash of `shared/`, the protocol, and the wire codec
     that lives outside `shared/` - `server/snapshot.js`, `client/net/decode.js`, `client/net/connection.js`: the code
     both ends run, the valley, the movement, the rules, and how they talk): it goes back in place, with the world it
     already has. **No reload.** A deploy that changed `server/` alone (but not `snapshot.js`) is this.
   - the same compat but another client build (`client/` changed, and neither `shared/` nor the codec): back in place as
     well, and the player is told the new version loads the next time they leave the game. (A page on the splash, not in
     a game, loads the new client before it joins one: the server may not have its files any more. The one file a page
     in a game asks for long after it loaded and cannot do without - the picture behind the crossing's loading card - is
     fetched into the browser's cache once the page is idle; sounds and the synth worker fall back to the procedural ones.)
   - another compat or protocol: the page is loaded again first (the "Game updated" card stays up through it), and goes
     back in as a reopened page does. A page is loaded again for one game at most 3 times in two minutes; after that it
     says the game could not be loaded, rather than reloading for ever.
   A server that is going down answers `/api/version` - and its pages - with 503 (the page asks again by itself), so a
   page never decides on, or is loaded from, the old server's word while its socket goes to the new one. Retries come every 150 ms for 5 s, then every second; "no such game" is believed only
   after three answers over 20 s (the newest server may be asked while the game is still on the one before).
6. **Until a player is really playing again they cannot be hurt, and a game with nobody playing yet does not run:**
   - a game brought over stands still (no clock, nothing moves) until one of its players has sent a quarter of a second
     of commands or somebody new joins, for `HANDOFF_FREEZE_SECONDS` (45) at most;
   - a player who has their body back but whose page is still loading (a reload builds the valley and its shaders before
     it sends a command) is as safe as a held one, for `ARRIVE_SECONDS` (45) at most;
   - a player who has not come back yet is held, safe, for `HANDOFF_RESERVE_SECONDS` (180) of the game's clock.
7. **A deploy on top of a deploy** starts all of this again from wherever each player had got to. A server told to stop
   while it is still bringing a game back puts that save back into the store as it came; a page still reloading for the
   last deploy simply arrives at the newest server.

## What it costs a player (measured)

`node scripts/deploy-gap.js` (real servers behind a stand-in for the edge, bots that play and come back the way the page
does; Linux, in Docker on the development PC; "the game runs again" from the server's log):

| | before (main, ee173eb) | after |
| --- | --- | --- |
| socket closed to back in control (WELCOME), median / worst of 12 | 965 / 1090 ms | 79 / 85 ms |
| socket closed to the first snapshot, median / worst | 1011 / 1133 ms | 83 / 88 ms |
| the game stands still after the first player is back | 1051 ms | 301-351 ms |
| reloads, a deploy of `server/` alone | 0 (the client build is a hash of the page) | 0 |
| reloads, a deploy of `client/` alone | every playing page | 0 (loaded when the player leaves) |
| reloads, a deploy that changes `shared/` or the protocol | every playing page | every playing page, once |
| reloads, a game the new build cannot read | the game ended | 0 (carried on by its build, with its client) |

Of the 40 merges to main before this change, 6 changed neither `client/` nor `shared/` and 21 did not change `shared/`:
the share of deploys that reload a playing page goes from 34 in 40 to 19 in 40.

In a real page (headless Chrome, software rendering, through `scripts/clip/lib.js`: `scripts/e2e-handoff.js`, 7 Oct
2026): a deploy of the server alone had the page back in the game 41 ms after it started moving, a deploy of the client
alone 36 ms, neither reloading and neither showing the banner. A deploy that changed `shared/` took 14.9 s from the old
server being told to stop to the game drawn again: 2.5 s before the page reloaded (the next server building the valley
while the game played on, the save, the "Game updated" card's 250 ms - it was 1.5 s before this change - and letting go
of the mouse and the screen), then the new page's valley (2.3 s) and shaders (4.9 s, and a 1.2 s first frame) in
software rendering.
What the reload costs is mostly the page building the valley and its shaders, which a player's own GPU does in a few
seconds (players' logs: from a few seconds to about 27 s); the bundle now goes out compressed as the build wrote it (3.0 MB to 0.8 MB with brotli, 1.0 MB
gzipped) and the files that did not change come from the browser's cache (named by content).

What the player sees: in place, the game stays on screen, frozen for the tens of milliseconds it takes, and a line in
the chat says the server was updated; a "Server updating" banner comes up only if it takes longer than 400 ms. On a
reload, the "Game updated" card over the game, the same card on the new page while it loads, then the game.

## What the host must provide

All of it is load-bearing; the server says in its log when something is missing.

- **The new container is up and healthy before the old one is told to stop**, and the old one gets **SIGTERM and at
  least 25 s** before it is killed: up to 3 s for the next server to build the valleys, up to 8 s for a game to save,
  within a 20 s hard exit (`drainingSeconds: 30` in `railway.json`; with Docker, `stop_grace_period: 30s` or
  `docker stop -t 30`). Killed instead, it saves nothing and every game ends. (The new server logs "the valley built
  ahead is let go (no save came for it)" when an old server announced games and never handed them over.)
- **One handoff store both containers can reach**: the Postgres database (`DATABASE_URL`), or one directory mounted into
  both (`HANDOFF_DIR`, or a volume at `RAILWAY_VOLUME_MOUNT_PATH`). Without either, every deploy ends every game, as
  with `HANDOFF=0`.
- **`HANDOFF_BUILD_KEY`: a secret only the deploy has**, the same on every deployment (a long random string; rotating it
  ends the games carried on by builds signed with the old one, at the next deploy). Without it no build is kept or
  started from the store - the server says so as it starts - and a game a later build cannot read ends at that deploy,
  its players told why.
- **Migrations run before the new server starts** (`npm run migrate`, the pre-deploy command, or on start).
  `014_handoff_builds.sql` adds the tables the builds and their client files are kept in.
- **An edge that routes each request on its own** (Railway's, Traefik's): `/api/version` and the game socket may go to
  different containers during a deploy, which is why a stopping server answers 503. Any edge works; one that pins a
  page's connections to the container it first reached is fine too (it is what the tests' stand-in does).
- The server can write to its temp folder (a fetched build is unpacked there, in a folder of its own,
  `stn-builds-<host>-<boot>-<pid>-<start>-XXXXXX`: about 1.5 MB each, taken away when the process exits; one left by a
  process of this host that is gone - crashed, or a restarted container's PID 1 - is swept by the next.)
- The store's size: a build is about 1 MB of code (gzipped) plus its client's files, each kept once by content (the first
  build puts about 24 MB, later ones only what changed: usually the 3 MB bundle). Builds nobody used for 3 days are
  swept - never one a save waiting in the store names. A running server marks its own build as in use twice a day, and
  as it goes down puts it back if another server swept it meanwhile (waiting 2 s for that at most: its games are saved
  regardless).

**Switches** (environment): `HANDOFF=0` no handoff at all; `HANDOFF_PIN=0` no carrying on by older builds (a save the
new build cannot read ends its game, and its players are told); `HANDOFF_PIN=unsigned` builds are started without a
signature (a development server, the tests: the store is then trusted with code); `HANDOFF_BUILD_KEY` above;
`HANDOFF_PIN_MAX_HOURS` (12); `HANDOFF_PREPARE_MS` (3000; 0: the next server is not asked to build ahead);
`HANDOFF_FREEZE_SECONDS`, `ARRIVE_SECONDS`, `HANDOFF_RESERVE_SECONDS`, `HANDOFF_MAX_AGE_SECONDS` (300: a save nobody
claimed in that long is dropped); `CLIENT_BUILD`, `CLIENT_COMPAT` (tests only: another client or compat); `HANDOFF_PACK_AFTER_MS` (tests only: how long
after it listens a server packs its build, 0).

## Who can run code on the server

A server now starts code that came out of the handoff store, and serves client files from it as script on this site.
The boundary is the deploy's key:

- **With `HANDOFF_BUILD_KEY` set**, a build is only started (or its files served) when it carries an HMAC made with
  that key of its whole SHA-256 - the hash of everything in it, of which its name is the first 96 bits - checked on
  every fetch. Writing to the database or the volume is not enough to run code here: it takes the key, which only the
  deploy has. Whoever has the key (and write access to the store) can run code on the servers - as whoever can deploy
  can.
- **On the server's own disk**, a build is unpacked into a folder this process makes for itself in the temp folder
  (`mkdtemp`: a new name nobody else can have made, mode 0700; it is checked to be a folder, not a link, this user's,
  and not group- or world-writable, or nothing is unpacked there). Before a game's worker is started from it, every file
  is checked against the build (`lstat`: no links, but the one `node_modules` link to this server's own packages, for a
  build that imports any; nothing else beside them). What is left is the server's own user: a process running as that
  user could change the files between the check and the worker loading them - and could change the server itself just
  as well. On Windows the temp folder is the user's own.
- **What the network thread writes to the players of a carried-on game itself** (which game they are in, the
  leaderboard, why they are turned away - then, and later if a deploy ends the game - and the close codes) is written
  with that build's own `shared/protocol.js`, loaded from the build in memory - its client reads them. It is only used
  when it has everything the thread writes with and loads within 2 s; otherwise the game is carried on only if its
  protocol is this build's. Should it throw as it is used, this build's is used for that message: never a thread that
  throws. The rest comes from that build's own worker.
- **Without the key**, nothing from the store is started or served (pinning is off), unless `HANDOFF_PIN=unsigned` says
  to trust the store: then anyone who can write to the store can run code on the server.
- `HANDOFF_PIN=0` turns all of it off.
- A carried-on game keeps its build's bugs, a security fix the new build brings included, until it closes (its run's
  end, or the cap). A fix that must reach every game at once bumps `SECURITY_EPOCH` in `server/builds.js`: no build of a
  lower epoch is started, and their games end at that deploy, saying an update ended them.
- An older build's game code runs against this server's `node_modules`. A build records the packages its game worker
  imports (today: none - the worker's 73 files import only `node:` modules) and their versions; one whose packages are
  not the versions installed here is not started.

## What can still end a game at a deploy

- The host misses one of the above: the old container killed instead of stopped (or its grace too short to save), no
  shared store, the store unreachable, a game's worker not answering the save within 8 s.
- A save older than `HANDOFF_MAX_AGE_SECONDS` when a server finds it (no server came up for five minutes).
- A game the new build cannot read, when it cannot be carried on by its build either: no `HANDOFF_BUILD_KEY` on the
  host (today's production); the save names no build (saved by a build from before this change - so the first deploy of
  this change cannot pin, but it does not need to: it reads every save of the build before it); the build is not in the
  store (the old server could not put it there: it is asked for again for 5 s, as the old server's put may still be on
  its way); it is of another `WORKER_API` (the
  contract between the network thread and a game's worker changed), of a lower `SECURITY_EPOCH` (on purpose), or uses
  other package versions. Its players are told an update ended it.
- Nobody comes back: a restored game with nobody in it closes once its players' places are given up
  (`HANDOFF_RESERVE_SECONDS`, 180), as any empty game does after 90 s.
- Behind the proxy with several game servers (`CLUSTER=1`): the build announcement goes to the target server only, but
  a game carried on by an older build is on one server and its page may be served by another, which serves the new
  client. Not handled; that mode is not what production runs.

And what still interrupts play: a deploy that changes `shared/` or the protocol reloads every playing page (protected
throughout, seconds to tens of seconds on a slow machine: the valley and its shaders are built again); every deploy
freezes the game for a few tens of milliseconds and the world for a quarter of a second after the first player is
back.

## Before merging

- `node scripts/test-world.js` and `node scripts/test-mainland.js` fail with "this change makes another map of the same
  seed" when world generation changed (the shape, or the lie of the land: `scripts/worldprints.json`,
  `scripts/groundprints.json`). Games being played on that map then go on by the old build until they end. If that is
  meant, `node scripts/worldprint.js --update`, commit both records, and say so in the pull request's Risk section.
- Bumping `STATE_VERSION`, renumbering or removing an enum entry: say so in the Risk section; those games are carried on
  by their build. Reverting such a change in the next deploy does not bring them back at once: a game carried on by an
  older build stays on it until its run ends, or for up to `HANDOFF_PIN_MAX_HOURS` (12), whichever comes first.
- Changing how a message is written or read: the codec files (`shared/`, `server/snapshot.js`, `client/net/decode.js`,
  `client/net/connection.js`) change the compat, and every playing page reloads once. A message written in
  `server/game.js` and read in `client/game/game.js` (which compat does not hash: most client deploys change it) needs a
  `PROTOCOL_VERSION` bump, as any change to the protocol always has. Changing what the network thread and a worker say to each other (`room-worker.js`'s header): bump
  `WORKER_API`, and say that games on older builds end at that deploy. A change to `shared/`: every playing page reloads
  once (say so); a change that must reach the players' pages at once has to touch `shared/` (or the protocol).

## What was considered instead

- **Keep the old server running until its games end ("drain").** Needs two containers alive at once for as long as a
  game lasts (hours), a router in front that sends each socket to the right one by its game code, and a host that will
  not kill the old container. Four deploys in three minutes would leave four old containers.
- **Put the map in the save.** The map is megabytes, and every client builds it from the seed with its own code: the
  clients would have to be sent the old map as well.
- **Move the game onto the new map.** Possible for small changes, but every system that points into the map needs its
  own repair, a state version or enum change is not helped by it, and the game the players come back to is not the one
  they left.
- **Reload on every client change** (what was done before). Most deploys change the client; the old page can play on a
  server of the same compat, so the reload waits for the player to leave the game.
- **Cache the generated valley in the browser across a reload.** The world is a large graph of typed arrays and
  colliders, and three.js has to build its meshes and shaders again anyway; not done.
