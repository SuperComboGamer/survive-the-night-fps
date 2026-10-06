> [!WARNING]
> **Work in progress.** Survive The Night is built around one person's vision — mine — and it changes fast as I
> iterate on it. Expect breaking changes between releases: controls that move, systems that get reworked, and
> features that come and go without notice. If it is close to the game you want, fork or clone it and bend it into
> what you need it to be.

<div align="center">

*"Whatever you do, work heartily, as for the Lord and not for men."* — Colossians 3:23 (ESV)

# Survive The Night

</div>

A co-op multiplayer horror survival FPS in the browser. Your car broke down on Route 9 in the middle of
a dead valley. By day, scavenge the valley's farms, motels, trailer parks and roadside wrecks for the
supplies the car needs. By night, the horde comes to wherever you are, so you board up on the spot and
hold. Every night there are more of them. Install every supply, start the engine, survive the final
stand and drive away. Die, and you rise as one of them until the sun comes up.

- **Client:** three.js (Vite), procedural art; procedural audio layered with ~16 MB of CC0 recordings
  (the score and stingers, ambience beds, weather, wildlife, footsteps, foley, gunshots, explosions, creature and survivor voices -
  see `client/audio/samples/CREDITS.md`), with a procedural fallback
- **Server:** Node + [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js), authoritative 20 Hz simulation.
  One server runs many games at once, each in a thread of its own: quick join, browse the public games, or
  make one (public or invite-only) and send its link - whoever opens it lands in your game unless it is full
- **Netcode:** custom binary protocol, per-client delta compression, client-side prediction with
  reconciliation, entity interpolation, server-side lag compensation for hitscan and melee

## Running

```bash
npm install
npm run dev        # game server on :3000 + Vite dev server on :5173 -> open http://localhost:5173
```

`npm run dev` gives the server a database of its own: PGlite (Postgres compiled to WebAssembly, run inside the
server process) kept in `data/pglite`, migrated on start - accounts, friends, messages and match records all work
with nothing to install. Point `DATABASE_URL` at a real Postgres to use that instead, or set it empty
(`DATABASE_URL= npm run dev`) for no database at all.

Production:

```bash
npm run build      # builds the client into dist/
npm start          # serves dist/ + the WebSocket on http://localhost:3000
```

Environment variables (server): `PORT` (3000), `MAX_PLAYERS` (8: the seats in a game unless its maker picks, a
quick join's game included), `ROOM_MAX_PLAYERS` (the most seats a game can be made with: `MAX_PLAYERS` unless
set), `MAX_GAMES` (games at once on the box: 4 per core unless set - see Capacity below), `CONN_PER_IP` (24: sockets
one address may have open over all games; `0` for no limit), `SEED` (pins the map of every game: without it every
playthrough is a new random valley), `TRUST_PROXY` (`1` / `0`: whether to take a player's address from the
`X-Forwarded-For` / `X-Real-IP` header; unset, only a proxy on a private network is believed - see
`clientAddress` in `server/index.js`. Joins are rate-limited per address), `DATABASE_URL` (Postgres:
`postgres://...`, or `pglite:<folder>` / `pglite:memory` for one inside the process. With one there are accounts,
friends, direct messages, the leaderboard in the database and every match recorded; without one the server runs
without accounts and keeps the leaderboard in `STATS_FILE`), `MIGRATE_ON_START` (`0`: do not apply pending
migrations when the server starts - `npm run migrate` does it), `DATABASE_POOL_MAX` (10 connections),
`COOKIE_SECURE=1` (mark the sign-in cookie Secure even when the edge does not say the page came over https),
`STATS_FILE` (where the leaderboard is kept when there is no database: `data/stats.json` by default, or
`stats.json` on the Railway volume when the service has one; empty keeps nothing past the process).
Deploys (`server/handoff.js`): `HANDOFF=0` (a deploy ends every game, as it used to), `HANDOFF_DIR` (hand games over
through files in that folder when there is no Postgres: `npm run dev` uses `data/handoff`, so a restart on a change
keeps the games), `HANDOFF_RESERVE_SECONDS` (180: how long a player brought over keeps their place),
`HANDOFF_MAX_AGE_SECONDS` (300: an older save is not restored).
Several servers behind the proxy (`npm run proxy`, docs/scaling.md): `CLUSTER=1` with a Postgres `DATABASE_URL`, and
`CLUSTER_ID`, `CLUSTER_ADDR`, `CLUSTER_DEPLOYMENT`; unset, a server is on its own as always.
Testing only: `HANDOFF_STATE_VERSION` and `CLIENT_BUILD` (a server of another build), `GAME_IDLE_SECONDS` (90: how long an empty game lasts), `JOIN_WAIT_SECONDS` (15: how long a socket
may hold a seat without joining), `LOBBY_LIMITS=0` (no per-address allowance on making games or asking for codes,
and no one-game-each: load tests), `DAY_SECONDS`, `NIGHT_SECONDS`, `START_DAY`, `GODMODE=1` (survivors take no damage), `DEV_ADMIN=1`
(every player may use admin commands when `NODE_ENV` is `development` or `test`; other environments ignore it).

A player (a signed-in account, or a guest's address) may have one game they made going at a time. The most games at
once over every server is a setting in the database, so it changes without a deploy or a restart (the servers read it
every 5 s; unset, each server only has its own `MAX_GAMES`):

```bash
npm run setting                              # every setting
npm run setting -- max_total_games 50        # at most 50 games at once
npm run setting -- max_total_games unset     # no total
```

That is `DATABASE_URL` pointing at the game's Postgres (on Railway: the database's public URL, or `railway connect`
for a psql shell and `UPDATE server_settings ...`). With PGlite (`pglite:...`) only one process may have the database
open, so stop the server first and add `--server-stopped`.

Admin access belongs to signed-in accounts. With `DATABASE_URL` set, grant or remove it by username or email; the
command revokes that account's existing sign-ins, so sign in again and reconnect to the game afterwards:

```bash
npm run admin -- Cody          # grant
npm run admin -- Cody off      # remove
```

In a game an admin presses `` ` `` for the spawn menu: every weapon, item, zombie, boss and a few world events
(supply crate, airdrop, deer, the stray cat). Type a few letters (`ak`, `hq` for The Hive Queen, `walker 5` for five
of them) and Enter spawns the best fit and closes it; Shift+Enter or a click spawns and keeps it open. Tab steps
through the categories, the arrows through the list; how many comes from the count picked beside the search (Auto:
a full stack, a full ammo reserve, one weapon or zombie) or a number typed after the name. It sends the commands below.

Admin chat commands: `/night`, `/day`, `/dusk [s]` / `/dawn [s]` (to 5 s, or that many, before
nightfall / daybreak), `/kill`, `/down`, `/give <item> <n>` (the item by name:
`/give flamethrower`, `/give flamethrower fuel 200`; `/items` lists the names, `/items ammo` the matching ones),
`/spawn <zombie> <n>` (the type by name, up to 20 at once, 12 m ahead: `/spawn tank`, `/spawn dog 3` for a zombie
dog pack, `/spawn hive queen`; `/zombies` lists the names), `/supply`, `/parts`, `/engine`, `/unlock`, `/tp <x> <z> [y]`
(with a height: onto what is under feet at it, down a drift of the mine), `/mine` (to the adit of Blackrock Mine;
`/mine far` to the far portal, `/mine in` down to the junction), `/depot` (to the front of the station house at
Whitlock Depot), `/train` (onto the loading bank beside the stalled freight train), `/clinic` (to the front door of Mercy Clinic;
`/clinic ward` into its dark wards; says so on a map without it), `/gun` (to the grips of the mounted gun, at the
Army Checkpoint until somebody carries it off, or beside it where it lies or whoever carries it; it says so when the
map has no checkpoint: seed 1 has one), `/where`, `/cat` (brings the stray cat over), `/den` (teleports next to the nearest zombie dog pack),
`/herd` (teleports 45 m from the wandering herd, just out of its sight), `/deer` (34 m from the nearest group of deer;
`/deer spawn [m]` puts a group 20 m - or that many - ahead, and lets you stand there ten seconds before it notices you), `/legs [1|2]` (takes one or both legs
off every zombie within 30 m that has legs to lose), `/bell` (the chapel bell tolls, wherever you are), `/radio`
(to the Relay Station's radio with the two batteries a call costs; says so if the map has no Relay Station),
`/cemetery` (to the gate of St. Agnes Cemetery; `/cemetery rise [n]` makes the n graves nearest you give up their
dead now), `/fair` (to the gate of the Tri-County Fair; `/fair on` starts its generator with a full tank, `/fair off`
stops it, `/fair wheel` / `/fair carousel` seats you on a ride, `/fair shed` to the generator shed's door), `/floodlight` (what a generator and two floodlights cost, and a full tank of fuel),
`/handcar [n]` (onto handcar n on the railway, or the first one nobody is on).

### Tests & tools

| Command | What it does |
| --- | --- |
| `npm test` | syntax-checks every module, fuzzes the delta encoder/decoder (all entity kinds) and the command packets, checks that prediction and server stay in step on a laggy link (`test-netsync`), checks the layout of every place (`test-world`), the mine under the valley (`test-mine`), Mercy Clinic's dark wards (`test-clinic`), St. Agnes Cemetery (`test-cemetery`) the deer (`test-deer`) the generator and its floodlights (`test-power`) and the railway (`test-rail`) and runs `sim-smoke` |
| `node scripts/test-flaregun.js [seed]` | the flare gun against the real server in-process and decoded as a client does: its recipes, that it takes the pistol's slot, that a shot straight up climbs to the top of its arc, opens its chute, drifts down at its fall speed where the shared closed-form flight puts it and burns out at its minute still in the air, that its shell re-loads from the backpack by itself, that a shot fired flat comes down and burns on the ground, that a survivor 300 m away has it while the area of interest still holds for everything else, and that at night it pins a Shade 30 m out from under it and not one 55 m out (part of `npm test`) |
| `node scripts/test-power.js [seed]` | the generator and its floodlights against the real server in-process and decoded as a client does, on the flattest open strip of the valley: what they cost, [E] pouring fuel and holding it for the switch, which lamps a generator feeds, the hum and the idle dead it draws (from a random stream of its own), the dead breaking it - and a Shade walking at a survivor that freezes as it enters a powered cone, moves again when the generator runs dry, walks free behind a wall inside the cone and freezes again when it steps out of the wall's shadow (part of `npm test`) |
| `npm run bench:net` | network traffic benchmark: the real server against simulated clients (real encoder, prediction and decoder) through a seeded session - idle, roaming, a night's fight. Reports packets and bytes per client per second in both directions and where the snapshot bytes go (`--players 8`, `--seed n`, `--day n`, `--json out.json`) |
| `node scripts/sim-smoke.js [seed]` | in-process server run with fake clients: the cat, zombie dog packs (forest dens, pack hunting, lunge bites, head hitbox), the wandering herd (slow walk together, roused by sight and by noise, losing a survivor), containers, chopping (and the client's harvest prompt: same reach and yields as the server), stations, schematic locks, door boards, pings, downed/revive, night waves, night themes, dawn summary, supplies, final stand, victory |
| `node scripts/test-accounts.js` | accounts, friends, messages and match records against a real server on a PGlite database of its own: registering (and what it turns down), signing in by email or name, the wrong password, signing out; friend requests by name, accepting, taking back and removing, the `/social` socket hearing each; messages between friends only, unread and read, slowed down when flooded; a signed-in player playing under the account's name and the others told so; a friend's presence and the game to join them in, an invite-only one's code going to friends and nobody else; requests and sockets from another site turned away; a guest's stats moving onto the account; the board from the database; every match written with its players and events, and one cut short by the server going down ended as `interrupted` (part of `npm test`) |
| `node scripts/test-binds.js` | keybinds (`shared/binds.js`, `client/game/binds.js`) and holding the drop key: the defaults, rebinding, a key another action has (swap / use here), resets, an action left without a key, labels, what the browser keeps and anything unreadable there falling back to the defaults; a key rebound while it is held leaving nothing stuck; a tap of the drop key not dropping and a hold dropping. Against a real server on a PGlite database: a guest told to sign in, binds saved to an account and back on another browser, junk refused, the newer copy winning, saves held back when flooded; without a database, no accounts (part of `npm test`) |
| `node scripts/test-feedback.js` | the end screen's "how hard was it?" vote (`server/feedback.js`) on a PGlite database: filed against the run the voter just finished (by account, or a guest's browser id), voting again changes it, what is kept with it, no vote on an abandoned, old or walked-out-of run; then over HTTP on a real server after a `/kill` wipe, a stranger and another site turned away, a server without a database a 503 (part of `npm test`) |
| `npm run migrate` | applies the pending database migrations to `DATABASE_URL` (`-- --status`: lists them); Railway's pre-deploy step |
| `npm run report` | what the match records say, for tuning: the night-by-night funnel, outcomes by team size, bosses, what kills survivors, weapons, pacing of the car supplies, retention, how hard players say it is (the end screen's vote, split by outcome, nights, team size and experience), server health (`-- --days 7`, `--since 2026-10-01`, `--build <commit>`, `--only weapons`, `--json`) |
| `node scripts/test-records.js` | the personal record (`client/ui/records.js`) against a stand-in for `localStorage`: what a run does to the bests, junk in storage, storage that refuses or is not there (part of `npm test`) |
| `node scripts/test-stats.js` | the leaderboard (`server/stats.js`) against the real server in-process: what goes on a player's record (kills, nights, wins, revives) and what does not, the stats file across a restart and with junk in it, the board a client is sent - and that the id a player joins with is in nothing sent to any client, logged or saved |
| `node scripts/test-gun.js [seed]` | the mounted gun at the Army Checkpoint, against the real server in-process: the nest on every valley that has the checkpoint (its grips free, its field of fire clear of its own sandbags), one gunner at a time whose commands fire it and nobody else's, 600 rounds a minute heard 110 m off, a round lag compensated like any gun's (a walker crossing 60 m out, aimed where it was drawn 250 ms before: against the AK-47 through the same path), through one body into the next, the gunner's kills, the belt spent, clicking empty, fed from the gunner's 7.62 and reset by a new game, letting go by [E], stepping away, going down and dying, the dead getting round the sandbags to the gunner, and carrying it: lifted by [E] held (not from under a gunner), half pace walking and sprinting with nothing fired, swung or reloaded, dropped on its side by a weapon key or [G] and lifted again from there, set up a step ahead facing the carrier's view (right behind sandbags, not into a wall) and fired there inside an arc about its new facing, stopped by the lake where they would float, and dropped by going down, dying, a lost connection or leaving (part of `npm test`) |
| `node scripts/test-bosses.js [seed]` | the night bosses and the day's specials, against the real server in-process: The Brute plods and, once badly hurt, roars and comes on at a run, and drops its smaller share of loot; The Alpha howls dogs into its own pack, never more than six, and lunges as a dog does; The Bloater heaves a fan of bile and bursts when it dies, taking the dead and a barricade beside it, but only falls when the dawn sun burns it out; and by day no specials within 90 m of the car, more of them further out, leapers and ropers only well out, never a boss, Tank, bat or shade (part of `npm test`) |
| `node scripts/test-leaper.js` | the leaper's pounce against the real server in-process, on three valleys: a survivor standing still, on rough ground, inside a ring of barricades (it clears them, it does not land on top), sprinting away, strafing and sidestepping as it leaves the ground, each pinned often enough and a well-timed sidestep still beating some of them; and a released survivor is not pinned again on the leaper's way off (part of `npm test`) |
| `node scripts/test-swim.js [seed ...]` | swimming against the real server in-process, in each valley's lake: wading in slows you and lets go of a crouch before the eyes go under, you float at the float height with your eyes out, swim at the swimming speeds with no jumping and no shots, stamina drains at the treading, swimming and sprinting rates, out of it you drown and the killfeed blames the water, you walk back out and get your stamina back, a long fall into the lake does not hurt (onto the shore it does), and a turned survivor stops at the edge of the deep water (part of `npm test`) |
| `node scripts/test-unequip.js [seed]` | a weapon out of its slot into the backpack (`ACT.UNEQUIP`), against the real server in-process: with its magazine, into the cell it was dragged onto or the first free one, trading places with a weapon for the same slot, the pistol, knife and hammer too but not the throwable slot, nothing with the backpack full, and a reload under way ended (part of `npm test`) |
| `node scripts/test-salvage.js [seed]` | tearing things down for materials (`ACT.SALVAGE`), against the real server in-process: from the backpack (part of a stack, a gun with rounds in it, which go back into the reserve), from a weapon slot and from the armor worn; raw materials, car supplies, food and the throwable slot refused; what does not fit lands at the survivor's feet; the `SALVAGE` table never gives back what a recipe takes; and a reconnect does not hand back the starting tools a survivor tore down (part of `npm test`) |
| `node scripts/test-drink.js [seed]` | energy drinks (`ACT.USE_ITEM`, what [B] sends), against the real server in-process: a spent or half-spent survivor is topped up to full and no longer exhausted once the drink is down, one can goes, the crack is heard by the survivors around but not sent back to the drinker, a survivor at full stamina or downed is turned down and keeps the can, and the cans are in several places' loot and in containers (part of `npm test`) |
| `node scripts/test-ammo.js [seed]` | ammunition carried apart from the backpack, against the real server in-process and decoded as a client does: the starting 9mm and every pickup go into the reserve and never a slot, up to the most of a calibre a survivor carries (the rest stays on the ground, without a "backpack full"), a reload takes its rounds out of it (a shotgun shell by shell), Drop half / Drop all (`ACT.DROP_AMMO`) put rounds down for a teammate who walks over them, counts past 255 survive the wire, crafting with a full reserve, dying drops each calibre, and every client is told its reserves after every tick (part of `npm test`) |
| `node scripts/test-backpack.js [seed]` | the craftable Backpack, against the real server in-process and decoded as a client does: crafted at a real workbench for its cost and salvaged for half, worn by a click in the grid (34 slots, and the others see it on your back); a pickup, a craft, a search, a split and a drag never put anything in the 10 locked slots without it and do with it; it does not come off while those slots hold anything; a death drops it with everything in it, a teammate takes it up and has 34 slots, and a dropped connection keeps it on; a pickup or a drop sorts the open slots by kind and merges part stacks, the same way every time; and pickups with reloads between never leave two part-used stacks (part of `npm test`) |
| `node scripts/test-fixtures.js [seed]` | the chapel bell and the Relay Station's radio, against the real server in-process and decoded as a client does: the rope, the bell and the radio are where world generation drew them and can be reached (not through a wall); a pull rings three tolls everyone hears, the idle dead at 60, 150 and 210 m and the herd come and the ones at 240 m do not, and the rope waits 45 s; a call spends two batteries and drops the crate where the caller stood, once a day and by day only; the client's prompts say why not, and the server never refuses a prompt for distance (part of `npm test`) |
| `node scripts/test-deer.js [seed ...]` | the deer against the real server in-process: where the groups are put, what makes them bolt (a survivor standing or crouched, a noise, the dead) and how far and fast, a shot at a running one missing unless the server rewinds to the shooter's picture exactly as for a zombie dog, head shots on a grazing one, what a kill leaves and that it counts for nothing, that nothing that walks the zombie list meets them, the dawn's newcomers, venison, that none of it draws on the game's random stream, and half an hour of being chased about with none in the lake, the mine or a wall and none pushing at a fence (part of `npm test`; `VERBOSE=1` prints the passes) |
| `node scripts/test-fair.js [seed]` | the Tri-County Fair against the real server in-process: the place, its rides and its generator are where a survivor can get at them and the dead can follow one in; the generator takes its fuel from what the survivor carries, the drum fills the tank and no further, it runs dry, it shuts off; it is heard 150 m off and no further and its lights hold a Shade; a seat carries its rider round, Space gets them out with the fall damage of the height, a blow or a rope takes them out, a stopped wheel leaves them where they are, out of the reach of the dead below, the dead stay in their seat; and a rider at 0, 100 and 250 ms each way, whose prediction has to be the server's result to the bit, and is rebased only when they get on, the generator starts or stops under them and they get off (part of `npm test`) |
| `node scripts/worldstats.js [seed]` | world generation stats: places, roads, sites, containers, supply spots, doorways |
| `node scripts/daytime.js [maps] [--floor] [--rows]` | how long a day has to be: walks the real player simulation from the spawn to the nearest place, round its containers, on to the next place and round that one, on 40 random valleys, sprinting and walking. `DAY_LENGTH` was set from it |
| `node scripts/test-mine.js [seed ...]` | the workings under the mine on a dozen valleys: the drift is cut, roofed and dry; feet, rays and bodies take the right one of the two levels (a survivor walks in at the adit and out at the far portal by the real simulation, cannot walk into the rock, and stays on the ground when crossing over it); what the rooms hold can be reached; and in a running game the dead live down there, follow a survivor in and out by the portals, hear noise round by the mouths and are spared by the dawn. `VERBOSE=1` prints the passes too |
| `node scripts/test-clinic.js [seed ...]` | Mercy Clinic on the first five valleys that have it: daylight in reception and outside, the wards wholly dark and the passage between going dark with no step in it, the one drug locker in the dark, the valley's flow fields leading into the deepest ward and out again; and in a running game the dead of the wards keep to them and go back when led out, a Shade moves in there at noon and is pinned in reception, the sunrise spares what stands in the wards, the drug locker's contents come once, and `/clinic` works. `VERBOSE=1` prints the passes too |
| `node scripts/test-cemetery.js [seed ...]` | St. Agnes Cemetery on six valleys (every grave is open ground a body can stand up on, the casket and the crypt's doorway) and in a running game: a restless grave by day (the warning, the climb, a head shot while it climbs and a shot that the ground stops), the dead of the graves getting out through the railings to the chapel's door, a wave's share of the horde, and a scripted night inside a ring of walls round the chapel: the dead come up inside it and reach the survivors, and the horde is no bigger for it (part of `npm test`) |
| `node scripts/test-rail.js [seed ...]` | the railway on six valleys: a line from rim to rim and a depot on it, crossing Route 9 once, off the water and every other place's ground, never steeper than 3% or tighter than a gentle curve; its bed level and open (a survivor walks it from either tunnel to the train, the nav grid has it as open ground); every road over it on planks and on the level; each tunnel shut by its cave-in; the open boxcars walked into from the bank, searched from inside, boarded up, and found by the dead's flow field; and in a running game a zombie comes into a boxcar after a survivor and has to break the door boards down once they are up. `--sweep 300` checks the plan alone on seeds 1..300 |
| `node scripts/test-world.js [seed ...]` | the authored places of four valleys (every place at least once), as a survivor meets them: every doorway can be walked through (the real player simulation), every container, floor-loot point and supply spot can be reached on foot from the place's front gate and is not inside something solid, no road runs into a building. A failure names the place, the spot in the place's own frame and a `/tp` to go and look |
| `npm run test:bots` | headless bots join a running server, play, and report bandwidth + prediction error |
| `npm run test:e2e` | two headless Chrome clients: see each other, search a container, build, pick up, chat, drop weapon |
| `node scripts/test-handoff-state.js` | a game saved for a deploy and restored into a new one (`server/gamestate.js`), in-process: a run played into its first night comes back with its clock, waves, players (where they stood, health, armour, weapons, backpack, kit), what was built, dropped, searched, felled and stripped, the dead where they were, the boss, the gun, the fair and the handcars; then both games are walked whole and any field that came back different and is not listed as transient fails it (a field added without being saved); players come back into their own bodies, one who does not is let go as a leaver, and saves this build cannot read are refused (part of `npm test`) |
| `node scripts/test-handoff.js` | a deploy between two real server processes sharing a `HANDOFF_DIR`: an invite-only game into its first night, SIGTERM, every socket closed with 4002, the old server exiting, the same code, players and night on the new one, seats kept and let go after the reserve, a bot with no browser id a newcomer; and a third server of another `STATE_VERSION` ending the game instead (part of `npm test`) |
| `node scripts/test-start-signal.js` | the server started as Railway starts it (`npm start`, under a script shell that never `exec`s its last command): a SIGTERM sent to npm reaches the server, which hands its games over and exits 0 (part of `npm test`) |
| `node scripts/test-handoff-store.js` | the two stores a game waits in between servers (files, and Postgres on PGlite): heard, listed, claimed once, swept; and the match a deploy splits, ended as `handoff` and carried on by `continues` (part of `npm test`) |
| `npm run test:cluster` | two game servers with `CLUSTER=1` and the proxy on a local Postgres it wipes (`CLUSTER_TEST_DATABASE_URL`): games spread and found by code, quick joins, the lobby of both, friends on two servers, a deploy handing a game to a newer server and a restart of the proxy, the player back in their own body each time (docs/scaling.md) |
| `node scripts/verify-cluster.js <proxy url> [--hold]` | the same against a cluster that is up, through its proxy only; `--hold` keeps a player in while you redeploy |
| `npm run test:e2e:handoff` | a deploy in headless Chrome behind a stand-in for Railway's edge (needs `npm run build`): the game stays on screen with the "Server updating" banner and is back as the same player where they were within a few seconds; with another client build the page reloads and goes back in by itself |
| `node scripts/test-itemguide.js` | holds the "Used in" / "Found in" lines of the inventory tooltips against the recipe and loot tables they are derived from, generated worlds and the server's gathering (runs after `npm test`, as its `posttest`) |
| `node scripts/e2e-weapons.js` | fires + reloads every gun, swings melee weapons, throws a molotov and a pipe bomb |
| `node scripts/e2e-showcase.js` | spawns every zombie type + boss, screenshots, death -> zombie mode, voice peers |
| `node scripts/e2e-stress.js` | ~120 zombies around the player, reports frame CPU time |
| `node scripts/e2e-motion.js [url] [s] [jitterMs] [latencyMs]` | a zombie pack chases the player; reports motion jitter (stalls, velocity kinks, wobble, planted-foot slip, hip pops), optionally over a simulated bumpy connection |
| `node scripts/e2e-night.js` | night shelter scene (torches, walls, traps) + proximity voice between two clients |
| `node scripts/e2e-legs.js [url] [outdir]` | shoots a walker in the shins with the pistol until it has no legs left: the stumble, each leg coming off, the hobble, the crawl, a head shot where it lies, with a screenshot of each |
| `node scripts/shot.js <url> <out.png>` | headless Chrome screenshot |

Browser tests use the system Google Chrome via `puppeteer-core`. Showcase/stress/motion/night/legs need a
non-production server started with `GODMODE=1 DEV_ADMIN=1`. Art/audio/UI modules also have standalone sandbox pages
under `client/sandbox/` (e.g. `/sandbox/map-test.html?debug=1` renders the valley map with every site,
container, supply spot and doorway, `/sandbox/props-test.html?new=1`, `/sandbox/icons-test.html`,
`/sandbox/audio-test.html`, `/sandbox/ui-test.html` on the Vite dev server;
`/sandbox/models-test.html?film=0` renders a walker's gait as a film strip and reports foot skating (`&anim=0` idle,
`&hurt=1` a hit flinch, `&vox=0` a growl, `&legs=1` hopping on one leg, `&legs=3&speed=0.8&dist=2.8&ty=0.3` crawling,
`&legs=3&fall=1` going down, `&anim=10` tripped by a shot in the leg);
`/sandbox/models-test.html?cats=grid` shows the cat's poses, `?deer=grid&hit=1` the deer's with the hitbox over each (and where its skull is), `?deer=film&anim=2` a bound in sixths; `?grid=10`, `?variants=10` and `?film=10` show the
zombie dog's poses, coats and gait).

`sim-smoke` is one long run on one map, and `npm test` runs it on seed 4242 only, so a check that leans on what the
checks before it happened to leave behind (a survivor's health, where the dead have wandered to, what was looted on
the way, the time of day) passes by luck and breaks when something unrelated shifts the timing. Each check sets up
what it depends on, and the run is meant to pass on any seed: after adding one, sweep a few,
`for s in $(seq 1 20); do echo "$s $(node scripts/sim-smoke.js $s | tail -1)"; done`.

Measured on a laptop: the server ticks in ~2-3 ms with a 120+ zombie horde (50 ms budget); the client
spends ~0.8 ms updating and ~2.5 ms submitting a frame with 120 zombies on screen. `npm run bench:net`
(4 players fighting night 3) measures ~1.3 KB/s down and ~0.4 KB/s up of payload per client in 40 packets/s
(~0.3 / 0.14 KB/s in 30 packets/s while standing around by day) and no prediction error.

## Deploying (Railway)

Production runs on [Railway](https://railway.com) as one service (project "Survive the Night FPS") that
auto-deploys every push to `main` and is served at https://survivethenightgame.com and
https://www.survivethenightgame.com.

- `railway.json` (config-as-code): Railpack builder, `npm run build`, `npm start`, health check
  `GET /status`, restart on failure, exactly **1 replica** and no app sleeping. Every game lives in the
  memory of that one process, so never scale it past one replica (a second would not know the first one's game
  codes). More than one server takes the proxy in front and `CLUSTER=1`: docs/scaling.md, set up by
  `scripts/railway-cluster.sh`. More games means a bigger box for the one replica: see Capacity
  below. The service variable `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30` gives the old deployment that long between
  SIGTERM and SIGKILL to hand its games over (below); its own hard exit is 20 s. (`drainingSeconds: 30` in
  `railway.json` says the same, but Railway left it out of the deploy config.)
  The signal only reaches the server because `npm start` `exec`s node: npm forwards it to the `sh -c` it runs the
  script in, and a shell with node as its child dies of it, node never told and no game handed over.
- **Postgres** is a second service in the project ("Postgres", Railway's template, on a volume of its own). The
  game service's `DATABASE_URL` is the reference `${{Postgres.DATABASE_URL}}`, which reaches it over Railway's
  private network (`postgres.railway.internal`); the database has no public address.
- **Migrations run on every deploy,** by the new server as it starts (`server/index.js`, under an advisory lock, so
  never twice): a migration that fails makes a production server exit, so the deploy fails its health check and
  the running one stays up on the schema it knows. `railway.json` also asks for `npm run migrate`
  (`scripts/migrate.js`) as the pre-deploy command, but Railway left it out of this service's deploys (2 Oct 2026:
  the deploy manifest has `preDeployCommand: null`, and `railway environment edit` cannot set it); setting it in
  the dashboard (Settings -> Deploy -> Pre-deploy command) would run them one step earlier. `MIGRATE_ON_START=0`
  turns the start-up migration off. A new migration is a new
  file in `server/db/migrations` (`003_...sql`); one that has been applied is never edited. `npm run migrate --
  --status` lists what is pending.
- The leaderboard, accounts and match records live in that database. (Without `DATABASE_URL` the server falls back
  to the leaderboard in a JSON file, `server/stats.js`, which needs a volume to outlive a deploy.)
- **A deploy does not end the games** (`server/handoff.js`, see "Deploys" in docs/ARCHITECTURE.md). On SIGTERM the
  old server saves every game with players in it to the `game_handoff` table, closes their sockets with close code
  4002, and the new one (up by then) restores each under the same code; the players' clients keep the game on screen
  under a "Server updating" banner and are back in their own bodies a second or two later (a page whose client build
  changed reloads first and goes back in by itself). Its match ends as `handoff` and the new server's next match
  names it in `continues`. A game that cannot be brought over - a save the new build cannot read (another
  `STATE_VERSION`, renumbered items, a valley world generation now makes differently), or one that took too long -
  ends as every deploy used to: its match `interrupted`, its players back on the splash. A match whose server died
  without any of that is closed as `interrupted` once nothing has been heard from it for 5 minutes. The first deploy
  of this still ends every game: the server going down then does not know how to hand over.
- Looking at the match records: `railway ssh` into the game service and `npm run report` there (it reads its
  `DATABASE_URL`), or `railway connect Postgres` for a psql shell (needs `psql` installed locally).
- Node 24 is pinned with `engines.node` in `package.json`. uWebSockets.js only ships prebuilt binaries
  for Node 20/22/23/24 on glibc Linux, so don't move to an Alpine/musl image.
- One process serves the client, the WebSocket (`/ws`) and `/status` on `PORT` (set to `3000` on the
  service) on all interfaces, so a single domain is enough.
- Railway's edge proxy is the peer of every socket, so the per-address join limit goes by the address the
  edge forwards (`X-Forwarded-For`, see `clientAddress` in `server/index.js`). A `join refused` line in the
  log names the address it counted: if that is ever the proxy's rather than a player's, set `TRUST_PROXY=1`.
- The custom domains are attached to the service in Railway (Settings -> Networking). Their DNS
  records (a CNAME to the Railway target plus a `_railway-verify` TXT record per host) are managed
  at the domain's DNS host.
- Is it keeping up? Every game with players on logs a `[game CODE] [stats]` line every 10 s with the tick time
  over those 10 s (`tick` mean, `p99`, `max`), `over a/b` (ticks past the 50 ms budget: everyone in that game
  rubber-bands), `late` / `latemax` (how late its loop woke: the host was busy, not the tick itself) and `cpu`
  (ms of CPU its thread used per second). A tick over budget also logs `slow tick` at once (at most one line per
  5 s) with the ms per section (`phase=`, `zombies=`, `snapshots=`, ...) and the player, zombie and entity counts.
  `GET /status` has the same per game under `list[].tick` and `list[].load`, the network thread's load under
  `net`, and the process's memory (`rssMb`).
- Games come and go in the log too: `game CODE made`, `game CODE closed: empty for 90 s`, and `game CODE crashed`
  / `stopped` if a game's thread died (its players are disconnected; every other game carries on).

### Capacity

Measured with `npm run stress -- game` and `npm run stress -- box` (`scripts/stress.js`: bots at night 3, a
server of its own on port 3931) on 2 Oct 2026:

| | per game of 8 at night | notes |
| --- | --- | --- |
| CPU | ~17 ms a second (45 at worst) | plan on 50: ~14 games per core with 30% to spare |
| memory | ~62 MB (+70 MB for the process) | plan on 80 MB |
| bandwidth | ~2-2.6 KB/s down per player | |
| network thread | ~0.4 ms a second per player | one thread: half a core at ~150 games |

One game took 48 players at 7% of a core (its zombies cap at 120 from ~24 players, so it levels off), and 64 games
of 8 ran without a tick past 2 ms. Memory runs out first, so `MAX_GAMES` defaults to what fits in 75% of the
memory the container may use, at most 150: about 18 games (144 players) on 2 GB, 73 (580) on 8 GB, 150 (1,200)
on 32 GB / 32 vCPU, where the network thread becomes the limit. A game's maker may give it up to 16 seats
(`ROOM_MAX_PLAYERS`); the game is balanced for 8.

## Controls

These are the defaults: every key can be rebound in Settings -> Keybinds (two keys an action, keyboard or mouse
buttons, Mouse 4 / 5 included; Esc stays the menu). Binds are kept in the browser, and on your account when you
are signed in, so they follow you to any browser you sign in on (the copy changed last wins). The prompts, key
hints and controls lists name whatever the keys are now.

| Key | Action |
| --- | --- |
| WASD | Move |
| Shift | Sprint (stamina) |
| Space | Jump (vault barricades and windows) |
| Ctrl / C | Crouch (quieter - zombies notice you less) |
| Mouse | Look · LMB fire / attack · RMB aim / heavy melee |
| Left Alt (Option on a Mac) | Held, the same as RMB held: aim, heavy melee, a zombie's leap. For a trackpad, where right click can't be held while you click to fire |
| 1 2 3 4 5 6 | Primary · Pistol · Melee · Throwable (press again to cycle) · Build (hammer) · Walkie-talkie |
| Q / wheel | Last weapon / cycle weapons (build mode: Q / E cycle structure) |
| R | Reload |
| E | Interact: pick up, install supplies, feed a campfire, pour fuel into a generator, repair, man the mounted gun. **Hold** to search containers, revive a downed teammate, start the engine, drive away once it is warm, switch a generator off or on, lift the mounted gun. Carrying the mounted gun: set it up where you face |
| Melee | Hit trees for sticks & planks, wrecks for scrap |
| Z / middle mouse | Ping: go here / danger (aim at a zombie) / loot (aim at an item or container) |
| L | Leaderboard: every player's kills, nights survived, wins and revives over all their games, and yours. Click a column to sort by it |
| M | Field map. Click to set your own waypoint (on a place's name or yard: that place); click it again, right-click or X to clear it. It shows on the compass and in the world with its distance until you get there, and your team sees it too: everyone's waypoint is a teal flag with their name on the compass, in the world and on the map |
| F | Flashlight (battery drains, recharges when off; a beam held on a Shade keeps it frozen) |
| G (hold) | Drop current weapon: held a moment, so a stray press in a fight keeps your gun (Settings -> Hold to drop weapon off: a press drops it) |
| H | Quick heal (bandage / canned tuna / cooked venison / painkillers / medkit; a medkit gets you up when downed). Nothing fires while an item is in your hands: a click (or a weapon key) puts it away unused and brings the weapon back out |
| B | Quick drink: an energy drink from the backpack refills your stamina in 0.8 s, on the run (not at full stamina) |
| I | Inventory + crafting (Q / E switch crafting tabs while it is open; Shift+click a recipe crafts 5, Ctrl+click - Cmd on a Mac - as many as the materials allow, up to 20). In the backpack: right-click drops a stack, Shift+right-click one of it, and Shift+click a stack to pick how much of it to split off into a slot of its own or drop - or to salvage. In Equipment: click a weapon (or drag it onto the backpack) to put it in the backpack, right-click to drop it; drag a weapon, vest or throwable from the backpack onto Equipment to equip it, and drag anything out of the screen to drop it. Shift+click anything that can be torn down (a weapon, in the backpack or in its slot, armor, medicine, throwables) to salvage it for materials. On the armor and backpack you wear: click takes it off, right-click drops it, Shift+click salvages it. The backpack sorts itself by kind, merging part stacks, whenever something is picked up or dropped |
| Tab (hold) | Player list: who is in the game, with their health, kills and ping, and who is down, dead or turned |
| Y / Enter | Chat (heard by survivors within 35 m - or by every survivor, with the walkie-talkie [6] in hand) |
| V | Push-to-talk proximity voice (same reach as chat) |
| LMB with the walkie-talkie | Held: talk over the radio to every survivor, however far (it opens the mic as V does) |
| Build mode | LMB place · RMB rotate · Q / E or wheel cycle structure · E repair (when aiming at a damaged structure) · X demolish |
| Zombie form | LMB claw · RMB (or Left Alt) leap |

The HUD names a key at the moment it answers something: the flashlight when night falls and the light is off,
quick heal when you are under half health with something that heals in the pack, a quick drink when you
run yourself out of stamina with an energy drink in the pack, the build slot at the dusk
warning if you carry enough to build, and the map and the inventory once each in the first minute. Each hint
stops for good once you have done the thing twice (remembered in the browser); Settings -> Key hints turns
them off.

## The game

- **The escape (objective):** your car died on Route 9. It needs a battery, a spare tire, spark plugs,
  a fan belt and three jerry cans of fuel. Every game the seven of them are hidden at random, each in a
  different place of that game's map, guarded by the dead; the HUD tells you where each one is *rumoured* to be.
  Carry them back and install them [E]. When all are in, hold [E] at the car to start the engine: it
  needs 90 seconds to warm up and every corpse in the valley hears it - the **final stand**. The engine
  only warms up while a survivor on their feet is within 14 m of the car: with nobody there it stalls
  (the count stops where it is, it does not start over) and the HUD says so. Once it is warm, nothing
  ends by itself: a survivor at the car holds [E] for 3 seconds to get in and drive, and that wins the
  run for the team. Until then the dead keep coming, so it is the team's call when to go: survivors
  within 14 m of the car leave with it, anyone further off is left behind (the end screen says which).
  The day/night clock stops during the final stand, so the team chooses when to start it - fortify the
  car first. The stand is sized to the survivors still alive, the way a night's horde is: more of you,
  more of them.
- **Day: scavenge & rebuild.** A clock shows the time until nightfall. The first day is long - 6:00, to find
  your feet and stock up before the first boss - and the second 4:30, to find somewhere to hold. After that each
  day is 15 s shorter than the last, down to 3:00 from day 8: a dash to one place or two, a look round each, and
  the horn. Every place has searchable
  containers (lockers, ammo crates, toolboxes, cabinets, fridges, shelves, duffel bags, car trunks,
  log piles; hold [E]) plus loot on the floor, and ~90 roadside and woodland sites (wrecks, abandoned
  camps, sheds, hunter stands, military stashes, burnt homesteads, roadblocks, graves) sit along the
  roads and in the woods between them, so every walk passes something worth searching. Melee a tree for
  sticks and planks (the sixth hit fells it: it crashes down away from you and fades, and stands again at dawn),
  or a wreck for scrap and nails. Materials, ammo and consumables are picked up
  automatically when you walk over them - except a stack you dropped yourself (right-click it in the
  backpack), which stays down until you have walked a few steps away, so you can clear a slot or leave
  it for a teammate. A full backpack tells you what it left lying. **Ammunition** is not kept in the
  backpack: it is carried apart, up to a limit per calibre (150 rounds of 9mm, 240 of 7.62, ...), and shown in
  the Ammunition panel at the bottom left of the inventory [I]. What a full calibre has no room for stays where
  it lies. To share it, click **Half** or **All** on a calibre's row there: that many rounds go on the ground
  in front of you for a teammate.
  Searched containers partly restock at dawn. Supply planes
  drop crates marked by red smoke (often carrying a schematic). **Canned tuna** cannot be crafted, only
  found (fridges, cabinets, the dock, trailers, the campground): eating a tin heals 30 HP and restores
  your stamina.
  **Energy drinks** cannot be crafted either (gas station, motel, drive-in, the fair, fridges, car trunks,
  ...): one refills your stamina in 0.8 s, and you can keep running while you drink it. [B] downs one from
  the backpack; the count beside the stamina line on the HUD says how many you have left.
- **Talking carries only so far.** Voice and text chat reach the survivors around you: clear out to 25 m,
  fading to nothing by 35 m (a chat line from the edge of earshot shows up faint, and your own line tells you
  when nobody was close enough to hear it). The **walkie-talkie** bridges the rest: every survivor carries
  one in weapon slot 6, and has to take it out to use it. With it in hand it hisses quietly, and chat typed
  then reaches every survivor anywhere in the valley; hold fire to key it, and your voice does too (the
  microphone opens as with V). Everyone else hears the squelch as you key up, the static while you are on the
  air and your voice crackling through the handset's speaker, and sees you raise it to your mouth. A radio
  line is marked with a handset. A survivor who is down can still reach theirs to call for help; the dead and
  the turned have none.
- **Night: board up where you stand.** A minute before dark the horn sounds. There is no base: the
  horde spawns around wherever the survivors are and comes in three waves (wave 1/3, 2/3, 3/3), so the
  team throws up a temporary shelter on the spot - door boards that snap into any doorway (survivors
  squeeze through, zombies must smash them; windows can still be vaulted), barricades, walls, gates,
  spike traps, barbed wire, torches and a campfire. At dawn the sun burns the horde and a card sums up
  the night (kills, walls lost, downed, revived, lost).
- **Every horde is harder:** more zombies (scaled by night *and* player count), more health and damage,
  and **one new kind of the dead a night**: zombie dog packs (night 2), spitters (3), boomers (4), leapers (5),
  shades (6), bats (7), ropers (8) and tanks (9). The dawn card says what the next night brings and the dusk horn
  repeats it. (Out in the valley by day you meet most of them sooner: see below.)
- **Every night has a boss**, and it comes in with the second wave, with most of the night still ahead: bring it
  down before sunrise and it drops what it carries (ammunition, medkits, gun parts). One that is still standing at
  dawn burns in the sun with the rest of the horde and leaves nothing. Night 1's is always **The Brute**, a hulking
  walker that plods - until it is badly hurt, when it stops to roar and comes on at a run. From night 2 the boss is
  drawn from the map's seed, never the same one two nights running and more likely one the run has not met:
  **The Alpha** (from night 2) - a dog the size of a pony that hunts as the packs do and howls more dogs into its
  pack, six at most; a **Tank** (from night 2) - you hear its
  footfalls thump long before you see it, and inside 30 m each one shakes the camera (a charge is a rumble); it
  charges, smacks survivors off their feet, breaks a wood barricade with one blow and ploughs straight through
  whatever its charge breaks; **The Bloater** (from night 3) - a boomer three times over that heaves a fan of bile
  at whoever is in front of it, and bursts when it dies, taking the dead and whatever was built beside it along:
  bring it down far from your walls (burnt out by the dawn sun, it only falls); **The Abomination** (from night 4) -
  ground slams and thrown boulders; **The Hive Queen** (from night 5) - acid barrages and bat swarms. The table is
  `BOSS_POOL` in `shared/nights.js`. The dawn card names the coming night's boss and how to fight it, and the dusk
  horn says it again (on night 1, the horn is the first word of The Brute), so the day can go on getting ready.
  A boomer cannot claw at what you built: stopped
  by it with a survivor close behind, it swells for a second and bursts against it, taking that piece with it (a
  metal wall is dented). Shoot it before it gets there - or while it swells, and the piece only takes the blast.
  Stragglers far from the team are brought back into the fight.
- **Some nights have a theme.** From night 2 on, about two nights in three draw a theme from the map's seed and
  the night number, never the same one two nights running; night 1 is always plain. A theme changes what the
  horde is made of, not how many come: **The Pack** (about a third of the horde are dogs),
  **Sprinters** (half are runners), **Bile** (spitters and boomers, from night 4), **Lights Out** (from night 6: twice
  the shades the night would allow, six at most), **Wings** (bats and leapers, from night 7) and **The Snare** (ropers,
  from night 8).
  The dawn card names the coming night's theme and what to do about it ("Dog packs: they cannot jump a
  barricade, so close the ring and leave no gap."), the dusk horn repeats it and the night's title carries its name.
  The table is `NIGHT_THEMES` in `shared/nights.js`.
- **Noise brings the dead.** Every zombie with nobody to chase heads for what it hears, and the louder the
  noise the further it carries: an MP5 35 m, a pistol 45 m, rifles 70 m, shotguns and the RPG 80-90 m, the hunting rifle 100 m,
  a car alarm 140 m, the anti-tank rifle 150 m, a pipe bomb, an RPG grenade or a bursting boomer 170 m, the chapel bell 220 m. More carry means more of them coming - and the
  louder it was where a zombie stood, the harder it runs, so a blast empties the whole neighbourhood onto you at
  a sprint while a distant pistol shot brings a few ambling over. They go to where the noise *was*: shoot and
  move, or throw a pipe bomb to pull a crowd off a place you want to search. Chopping, salvaging, hammering, a
  shattering molotov and a supply crate thumping down are quieter (30-60 m) but not silent.
- **Ring the chapel bell.** A rope hangs just inside the door of St. Agnes Chapel (on every map), and the bell it
  rings hangs in the open belfry under the spire. Hold [E] on the rope for a second and a half and the bell tolls
  three times over about six seconds. Every survivor hears it wherever they are, fainter and from the chapel's
  side the further off they are, and is told the bell is ringing. Each toll carries 220 m to the dead: every idle
  one inside that and the wandering herd leave what they are doing and come to the chapel, at a run from 170 m in
  and ambling from further out (like any noise, it holds a zombie for a minute at most, so a walker from the far
  edge stops short). Ring it to empty a place you want to search, or to bring everything onto the chapel. It works by day and by night, and the rope will not pull again for 45 seconds.
- **Call a supply drop on the Relay Station's radio.** Where the map has a Relay Station, a field radio stands
  beside the foot of its mast. Hold [E] on it for 4 seconds with two batteries in your backpack: they are spent and a
  supply plane comes for you, and drops its crate (red smoke, a schematic as often as any drop) where you stood
  when the call went out - half a minute later, give or take. One call a day, by day only (the radio answers again
  after sunrise; no plane flies at night), the team is told who called, and the call is heard by the dead for 90 m.
  The prompt says what is missing: the batteries, the day's call, or the daylight.
- **The further from the car, the nastier the dead.** By day, nothing but walkers, runners and dogs lives within
  90 m of the car; past that a share of the dead in the places and along the roads are specials, whatever the night,
  growing to two in five at 320 m and beyond: spitters and boomers first, leapers from about 170 m, ropers from
  about 240 m. Bosses, tanks, bats and shades only come at night (shades also keep to the dark of the mine and the
  clinic's wards). The numbers are `DAY_SPECIAL_*` in `server/zombies.js`.
- **The wandering herd:** by day a crowd of ten to fifteen walkers and runners shuffles along the valley's roads
  together, from place to place, at a slow walk (it keeps clear of your car). Let one of them notice you - about
  26 m, less if you crouch - or let a noise reach any of them, and the whole herd comes at a run, walkers
  included: faster than you walk, slower than you sprint. Sprint out of their sight and they give up after about
  twenty seconds, search where they last saw you (or where the noise came from), then drift back to the road.
  Kill the herd and another turns up somewhere else a minute and a half later.
- **Deer** graze the valley all game, day and night: five groups of two to four (sixteen deer at most), a buck with
  antlers in some, on the woods and clearings away from the places and the roads, heads down, a few steps now and then,
  drifting on to new ground every few minutes. Come within 22 m of one - 13 m crouched, more if you sprint - let a noise
  reach them or let one of the dead come near, and the whole group bolts with a snort, white tails up, at 9 m/s (you
  sprint at 7.5), runs about sixty metres, stops to watch where it came from and settles. A deer bolting past is a
  warning. Zombies ignore them; nothing eats anything. **Hunting:** any weapon brings one down (70 HP: three pistol rounds
  in the body or one in the head - and the head is down in the grass while it grazes - one crossbow bolt, a heavy knife
  blow from close by), and a kill leaves 1-2 leather and two cuts of **raw venison** where it fell. The crossbow
  is the hunter's weapon: a gunshot sends every group within its carry running and brings the dead, a bolt is heard by
  nothing six metres off. Cook venison at a campfire: **cooked venison** heals 45 HP and restores your stamina, more
  than a tin of tuna; raw, it is eaten for 8. A kill counts for nothing on the scoreboard. Hunted groups are replaced: at
  sunrise new ones walk in from the edge of the map, out of everyone's sight, until the valley has its five again.
- **Zombie dogs:** packs of two to four den in the thickest woods from day one (more of them each day). They
  catch your scent from half again as far off as the dead, and the first to find you howls and
  brings the whole pack. They fan out to come at you from the sides, crouch and lunge for a bite, peel away and
  circle back in. Fast but fragile (a couple of pistol rounds, one to the head); from night 2 packs also run with
  the horde, breaking from the treeline.
- **The Shade only moves in the dark.** A fast, hard-hitting stalker that freezes solid the moment any light
  falls on it - a flashlight beam, the glow of a standing torch or campfire, a burning road flare or molotov
  fire, a flare gun's flare drifting down overhead - and comes for you the moment the light is gone. Frozen, it shrugs off three quarters of all damage
  and cannot be shoved, so someone holds a beam on it while the rest of the team wears it down, or you ring
  the shelter with torches and leave it standing at the edge of the light until dawn. Walls, trees and hills
  cast shadows it can move in. Listen for the whispering in the dark and the shriek when a light lets it go.
- **The dead of St. Agnes do not stay buried.** Behind the chapel lies St. Agnes Cemetery: iron railings with a gate
  and two panels down, rows of headstones either side of a gravel path, sunken graves and open ones, a dead tree,
  and at the head of the path a crypt with a casket in it worth searching (shells, torches, flares, a medkit, now
  and then a double-barrel); the chapel's shed outside the railings is the groundskeeper's, with his toolbox. A few older
  graves lie in the churchyard beside the chapel itself. Spend the night within about 60 m of it and every wave
  gives 30% of its walkers and runners to the graves: they come up over the next 20 s, most of them from the graves
  nearest the survivors, never one a survivor is standing at - inside whatever has been walled off round the
  chapel. The horde is no bigger for it; only where part of it arrives changes, and specials and bosses still come
  from the treeline. By day three graves are restless (drawn at every sunrise), and each gives up one walker to the
  first survivor who comes within 5 m of it. A rise is fair warning: the earth heaves and is heard (and felt
  underfoot) for 1.2 s before anything shows, and the zombie then takes 2.5 s to climb out, doing nothing else:
  what is still under the grass cannot be hit, but a head above it can.
- **The Tri-County Fair** is on every map: a midway of game stalls and food stands to search, a carousel, a Ferris
  wheel 18 m tall over the clearing, and a generator in a shed at the side. Hold [E] on the generator to start it: it
  burns Flamethrower Fuel, 25 of the fuel you carry for two and a half minutes, and the drum beside it takes more [E],
  up to ten minutes in the tank. Hold [E] again to shut it off; what is left stays in the tank. While it runs, the
  bulbs on the midway and on the rides light up - that light holds a Shade frozen the way torchlight does - the
  calliope plays, and every four seconds the fair is a noise that carries 150 m (a car alarm carries 140): every
  corpse with nobody to chase comes to the midway, the wandering herd too. Run it to pull the dead off somewhere you
  want to search, or to bring them to you. And the rides turn: [E] on a gondola at the platform or on a horse sits
  you in it (the wheel goes round once in 40 s, the carousel in 8). From the seat you look round, shoot, reload and
  heal; [E] gets you off at the bottom, Space gets you out anywhere, with the fall that comes with it (from the top
  of the wheel that is half your health). If the generator dies with you at the top, you are stuck up there until
  somebody starts it again or you jump. Nothing on foot reaches the top of the wheel, but spitters, bats and the
  Hive Queen do; near the ground the dead claw at you, a roper's rope pulls you out of the seat, and a blow that
  knocks a survivor down - a tank's, a boomer's - knocks you out of it.
- **A generator and floodlights.** Two more things to build with the hammer. The **generator** (6 scrap metal, gun
  parts, 2 duct tape, barbed wire) burns Flamethrower Fuel: [E] pours 25 units into its tank, a minute of running, and
  the tank holds ten; holding [E] switches it off, and on again, without losing what is in the tank. While it runs it
  powers every **floodlight** (3 scrap metal, batteries, barbed wire) within 16 m: a work lamp on a tripod that throws
  a cold white cone 24 m long and about 70 degrees across, the way it faced when it was placed, and a Shade inside that
  cone is pinned exactly as in torchlight - walls, trees and hills still cast shadows it can move in. The price is the
  noise: a running generator hums, and the hum carries 40 m (a little further than an MP5, less far than a pistol), so
  the idle dead drift over to it, and the dead break it like anything else in their way. A generator that is broken,
  switched off or run dry takes its lights with it; one taken down with the hammer gives back the fuel left in its
  tank. Its prompt says how much fuel is left; a floodlight's, whether it has power. While one of the two is being placed, a fan on the ground shows where the lamp's light will fall and every
  generator shows the 16 m it reaches.
- **Shoot the legs out from under them.** A bullet below the hip of a walker, runner, spitter, roper, boomer or
  shade goes into that leg: the zombie **stumbles** - it trips, slows to a shuffle and loses the swing it had started
  - and takes only 40% of the damage in the body. A leg that has taken 30% of the zombie's health is **shot off**
  at the knee, shin and foot flying. On one leg it hops after you at half speed; with both gone it goes down on
  its front and **crawls**, dragging itself along by its arms at walking pace or less, low in the grass, and still
  bites at whatever it reaches. A crawler cannot spit or throw its rope any more, and its head is on the ground
  ahead of it. A leg shot kills slower than a head shot; it buys time. Dogs, leapers, tanks, bats and bosses have
  no legs to lose, and a Shade held by light is as hard in the leg as anywhere else.
- **Arsenal:** pistol, pump shotgun, double-barrel (two heavier blasts back to back, then a break-open
  reload), MP5 (full-auto 9mm out of the pistol's reserve, the quietest gun that fires a bullet), AK-47,
  M4A1 (full-auto 5.56, accurate) and a scoped bolt-action hunting rifle (no bullet hits harder: one body
  shot drops most of the dead and carries on through the ones behind), plus knife, bats, machete and
  hammer. Knife, bats and machete have a heavy attack (RMB): a harder blow that can drop what a light swing
  only wounds, paid for with a longer recovery, so light swings still do more damage over time.
  Guns turn up where you would expect them: double-barrels on farms and
  in cabins, MP5s at the police station and checkpoint, M4A1s and 5.56 at the army checkpoint and the crash site,
  and the AK-47 in the same ammo crates as its 7.62 (the checkpoint, the crash site, military stashes in the woods).
  The **crossbow** is the quiet one: a single heavy bolt that only the dead within a few metres hear (a
  gunshot carries 35-100 m), paid for with a slow re-cock after every shot. It needs no schematic and no
  gunpowder - rope, sticks and scrap at the workbench, and more sticks and scrap for bolts.
  The **flamethrower** is the one for crowds: a short cone of fire (11 m) that needs no aim and sets whatever
  it touches **alight** - a burning zombie keeps burning for 5 s after the fire that lit it, and a molotov fire
  lights them the same way. Burnt bodies leave nothing to loot. It is built at the workbench once the team has
  the explosives schematic (or found at the crash site, in ammo crates and in supply drops), and drinks fuel
  brewed from alcohol and chemicals.
  The **anti-tank rifle** is the one for the bosses: a single 14.5mm round that goes through five of the dead in a
  line and hits a boss or a Tank three times as hard (1200 off one with a body shot), paid for with a six-second
  reload after every shot - it starts by itself - and the loudest report in the valley. It is built at the
  workbench once the team has the rifle schematic (or found at the army's places, in their ammo crates, in supply
  drops and in the mine's strongbox); its rounds come two at a time from scrap and gunpowder, and off bosses.
  The **RPG** is the one for a crowd you can see coming: a single rocket grenade that flies out fast (it drops a
  little over a long shot) and bursts on the first thing it strikes - one of the dead, a wall, the ground - for 360
  at the heart of the blast, tearing apart everything within 5.5 m of it. Survivors are not hurt by it. It re-arms by
  itself, slowly, after every shot, and the blast carries as far as a pipe bomb's. It is built at the workbench once
  the team has the explosives schematic (or found at the army's places, in their ammo crates, in supply drops and in
  the mine's strongbox); each grenade takes gunpowder, scrap and chemicals.
  The **flare gun** takes the pistol's place: a break-open signal pistol that hurts nothing and fires one parachute
  flare at a time. Fired straight up, the flare climbs about 90 m, bursts alight as its chute opens and drifts back
  down for a minute, lighting the ground for about 40 m round under it - and Shades in that circle cannot move -
  and the sky and the haze round it, which everyone in the valley sees. Fired low, it comes down out in front and
  burns on the ground for the rest of its minute like a big road flare. It is found loaded with one flare at the
  docks, the ranger station, the army checkpoint, in military stashes and supply drops, and both it and its shells
  are made at the workbench with no schematic. The numbers are `SKYFLARE` in `shared/skyflare.js`.
- **Throwables** ([4], press it again to cycle through what you carry): the **molotov** sets an area ablaze; the
  **pipe bomb** beeps for 2.6 s, pulling every zombie within 40 m onto it, then blows a 7 m hole in the crowd it
  gathered; the **frag grenade** is the quick one - thrown further, it bounces, rolls and bursts 2.2 s after it
  leaves your hand (5 m and 260 damage, to the pipe bomb's 7 m and 420), and lures nothing first, so it goes into a
  crowd that is already there; the **noisemaker**, a wound-up alarm clock, does no harm at all - it rings for 15 s
  where it lands and the dead within 45 m leave what they are doing and walk to it (all but those already on a
  survivor), to clear a place to search or buy a moment; the **road flare** burns red for 40 s and pins Shades in
  its light. A thrown bomb never hurts a survivor. The grenade is built at the workbench once the team has the
  explosives schematic (scrap and gunpowder, less than a pipe bomb) and turns up in military stashes; the noisemaker
  is built at the workbench from scrap, barbed wire and a battery, and found in houses, trailers and the motel. The
  numbers are `THROWABLES` in `shared/defs.js`.
- **The mounted gun.** On a map with the Army Checkpoint, a heavy machine gun stands on a tripod in a horseshoe of
  sandbags beside the boom gate, covering the road out. Stand at its grips and press [E] to man it (one gunner at
  a time; the prompt says how much belt is left). Your own weapon goes down, and your fire button
  is its trigger: 600 rounds a minute, each a little harder than an AK-47's and through one body into the next,
  out to 200 m in a tight cone, with no climb. It swivels with your view 70 degrees either side of the road and
  from 15 degrees down to 25 up; look further and it stays at its stop. Step away, press [E] again, go down or die
  and you let go. It is the loudest gun in the valley but for the anti-tank rifle - every shot carries 110 m - so using it brings the
  neighbourhood, and the sandbags only cover the front: the dead walk round into the open back. **One belt:** it
  has 250 rounds when the game starts, shown in place of your ammunition while you man it, and when they are gone
  it clicks. Hold [R] (or [E]) at the grips to feed it 50 rounds a second from the 7.62 you carry - the
  same rounds the AK-47 eats - up to 250. Its belt, who mans it and where it stands start over with every new game;
  its kills are the gunner's.
  **Taking it with you:** hold [E] at it for 1.5 s (at its grips or beside it, and not while somebody mans it) and
  you lift it, tripod and all, belt and all. Carrying it takes both arms: you move at half pace (walking and
  sprinting), and nothing in your hands fires, swings, throws, reloads or aims. Press [E] to set it up again where
  you face: it goes down a step ahead of you, covering the way you look, or nearer if sandbags or a barricade
  stand in front of you, so you can set it up right behind them (not into a wall). Reaching for a weapon (a number
  key, the wheel, [Q]) or pressing [G] drops it on its side where you stand, and your weapon comes out; so does
  going down, dying, being pinned or roped, or losing your connection. A gun lying on its side cannot be manned:
  hold [E] beside it to lift it again. Nobody swims with it: you wade into the lake only as far as your feet keep
  the bottom. While you carry it the HUD shows its belt in place of your ammunition.
- **Crafting:** simple things by hand anywhere (torches, bandages, molotovs, road flares, planks from
  sticks, bats, hammers). A **campfire** (buildable anywhere) is the station for medicine, painkillers
  and gunpowder, and heals survivors resting nearby. A **workbench** (buildable anywhere) is the station
  for melee weapons, the crossbow, ammo, armor, the backpack, nails, batteries and explosives. Five **schematics** (shotguns, hunting
  and anti-tank rifles, kevlar, explosives, metal walls) are hidden in lockers, ammo crates and toolboxes around the map
  and unlock their recipes for the whole team. Two materials have to be looked for: **leather** (padded jacket,
  backpack, machete) in car trunks and duffel bags, on the farm, in the cabins and at the lodge - or off a deer - and **kevlar plates** (two
  to a vest) in ammo crates, which hold them in pairs.
- **Salvage:** Shift+click a weapon, armor, medicine, a throwable or a walkie-talkie in the inventory - in the
  backpack, in its weapon slot or worn - and tear it down for materials, by hand, anywhere: the knife you start with
  gives scrap metal and leather, a gun gives gun parts and scrap, and any rounds in it go back into the pack. What has
  a recipe gives about half of it back and never all of it (`SALVAGE` in `shared/defs.js`). The pistol, knife and
  hammer everyone starts with come back after a death, but a reconnect brings back only the ones you still had.
- **The backpack grid** has 24 slots. A **Backpack** (4 leather, 6 cloth and 2 rope at the workbench) is worn in an
  equipment slot of its own, under the armor, and opens 10 more in the same grid - shown locked until then. It
  only comes off (or is dropped, or salvaged for about half its materials) once those 10 slots are empty, it goes
  down with everything else when you die, and the others see it on your back.
- **Co-op:** at 0 HP you go **down** (crawl, pistol only, 30 s to bleed out). A teammate holds [E] on you
  to revive you, or you use a medkit. When nobody is left standing, the game is over. Pings, teammate
  nameplates, a compass with markers (the car, teammates, rumoured supplies, supply drops, discovered
  places, everyone's waypoints) and a field map [M] keep the team together. A nameplate carries its owner's health bar while they
  are hurt, within 12 m or in your crosshair (amber below 60%, red below 30%), a downed teammate's turns into
  a red DOWN plate, and the player list [Tab] shows everyone's health and who is down, dead
  or turned. Friendly fire is off, headshots deal bonus damage, health slowly regenerates.
- **Joining late:** the server runs one drop-in game. Join a run in progress and you arrive beside the team
  (at the car if they are still by it, or if nobody is left alive), with the starting kit plus a little more
  9mm and bandages for each day gone by. Leave and come back during the same run and you have what you left with.
- **Death:** survivors respawn as player-controlled zombies (claws + leap) hunting their former friends.
  That lasts until dawn. The sun that burns the horde burns it out of them too: at sunrise they are survivors
  again, beside the team, with the tools, one pistol magazine and one bandage. What they carried was dropped
  where they fell and lies there for four minutes, so after a death in the night it can be walked back to.
  A wipe still ends the run, a death in the final stand lasts to the end of it (the clock is stopped: no dawn),
  and reloading the page is no way round a death: you rejoin as what you were. `DAWN_RETURN` in
  `shared/constants.js` turns all of this off, and a death lasts the rest of the run as it used to.
- **Your record:** the browser keeps your last 20 finished runs and your bests - fastest escape, most nights
  survived, most kills in a run, escapes in a row - and shows them on the end screen (a new best is called out)
  and on the title screen. A run counts if you were in it from its first minute and still there when it ended.
  It lives in `localStorage` on your own machine and is never sent to the server; Settings has a button to clear it.

### The valley

**Every playthrough is a new valley.** When a game ends (or the last survivor leaves) the server rolls a
new seed and every client rebuilds the map from it; nothing but the seed crosses the wire. For a seed,
`shared/layout.js` plans the valley and `shared/world.js` builds it:

- **Route 9** crosses the map at a random heading - straight, on a bend or in an S - with The Breakdown
  (your car, a rest area) on it near the middle and the roadside places strung along it.
- **The lake** lies somewhere out towards the rim, away from the highway, with a handful of ponds. You can
  swim in it (`shared/swim.js`): wading in slows you, a crouch won't put your eyes under, and where it is deeper
  than you stand you float with your head out, swimming at 2.4 m/s (3.6 on sprint). Afloat, your hands are busy
  (no weapon, no jumping) and stamina only drains - treading water, swimming, harder on sprint. Run out and you
  drown, 12 HP a second, until your feet touch the bottom again: a way across and out of a tight spot, never
  somewhere to sit out a night. The dead don't swim; they gather on the shore. A fall into deep water doesn't hurt.
- **The railway** runs across the valley from a tunnel in the hillside on one rim to a tunnel on the other,
  on a course of its own: it crosses Route 9 once, on the level, a short walk from The Breakdown, keeps off the
  water and out of every other place, and bends in long easy curves, never steeper than 3% - the ground is cut
  and banked up to it, so it runs through cuttings and along embankments. Rails and sleepers are only drawn:
  the line is open ground to walk, for the living and the dead. Every road and trail that crosses it does so
  over planks. Each tunnel is shut by a cave-in a few metres in. Somewhere along it a freight train stands
  where it stopped: a locomotive, a tank car, two boxcars standing open at a timber loading dock, a flat of
  lumber and a closed boxcar. The open boxcars are walked into from the dock and hold freight crates (planks,
  nails, scrap, rope, tape, wire, tinned food, now and then gun parts); a boxcar's one doorway takes door
  boards, so one makes a shelter for the night. The field map draws the line hatched (`shared/rail.js`,
  `node scripts/test-rail.js`).
- **Eighteen places** to a map. Eight are on every one: The Breakdown, Route 9 Gas Station, St. Agnes Chapel (with
  St. Agnes Cemetery behind it, `shared/cemetery.js`), Blackwater Dock (always on the lake shore, pier out over the water), Hollow Creek (the village: diner,
  general store, police station, garage, houses), Blackrock Mine (on high ground), the Tri-County Fair (in a
  clearing of its own, the Ferris wheel over the midway) and Whitlock Depot (on the railway: the station house with
  its waiting room and ticket office, a platform, a freight shed, a water tower and a signal, and a siding with two
  cars on it). The other ten are drawn
  from sixteen: Pinewood Motel, Starlite Drive-In and the Army Checkpoint (all on Route 9), Lakeside
  Campground (near the lake), the Relay Station and Ranger Lookout (on high ground), Miller Farm, Harlan
  Sawmill, Granite Quarry, Shady Pines Trailers, the Hunting Cabins, the military Crash Site, Dutch's Salvage
  (a scrapyard), Camp Tamarack (a summer camp), Elk Ridge Lodge and Mercy Clinic. Each is sited by its own
  rule and kept apart from the rest, the highway and the water.
- **Mercy Clinic is dark at noon.** Reception and the pharmacy at the front have windows and daylight; a passage
  behind them leads to the ward wing, whose windows were boarded over when the wards were sealed. Walk down the
  passage and the day goes out behind you: in the wards it is as dark as down the mine, a flashlight, a torch or a
  flare is all there is to see by, and a Shade moves there at noon (the daylight that pins it everywhere else
  does not reach it, and the sun that burns the horde at dawn spares whatever stands in there). Three of the dead
  live in the wards, one of them crawling, and from the second day a Shade in the isolation ward; the wards fill
  up again at sunrise. It is where the medicine is: the pharmacy's medicine cabinets, one more in the wards, and
  in the deepest ward the map's one drug locker - two medkits, three painkillers and four bandages on top of what
  else is in it, once a game. Outside, an ambulance that never left still has its rear compartment to search
  (`shared/clinic.js`, `node scripts/test-clinic.js`).
- **The mine goes under the valley.** The adit at the back of Blackrock Mine's yard stands open: a decline
  runs down from it to a drift 100-200 m long that comes up again at a second portal on the edge of another
  place (a different one on every map; the field map shows the workings dashed). Half way there is a junction
  with a few dead-end galleries off it, each ending in a room with crates nobody has come back for - and one
  of the car's supplies may be hidden down there. The deepest room holds the map's one strongbox: an M4A1, an
  AK-47, a flamethrower, an anti-tank rifle or an RPG, loaded, with two magazines more and two pipe bombs. It is there once; it does not
  refill at sunrise. It is pitch dark at noon, so bring a light: the dead live
  down there, the Shade among them from the second day, and the sun that burns the horde at dawn does not
  reach them. The horde follows a survivor in by either mouth (`shared/mine.js`, `node scripts/test-mine.js`).
- **The Army Checkpoint has a machine-gun nest** on the verge by its boom gate (see The mounted gun above;
  `shared/mountedgun.js`, `node scripts/test-gun.js`).
- **Roads** are not drawn by hand either: county roads are a spanning tree grown out from Route 9 (every
  place hangs off the nearest thing that already has a road, and turns its front to it), then the worst
  detours are closed with a couple more roads and with forest trails. Each link is routed over the terrain
  with A* (roads follow the valleys, share corridors and bend around hills and water).

The place catalogue (`PLACES` in `shared/layout.js`) is the one table to edit: mark a place `core` to have
it on every map, change `PLACE_COUNT`, or add a place (a `ZONE` id, name and loot table in `defs.js`, a
`PLACES` entry, and a `place(ZONE.X, (b) => {...})` builder in `world.js`).
`/sandbox/map-test.html?seed=N&debug=1` shows the field map of any seed, and `node scripts/test-world.js`
walks every place's doorways and checks that what it holds can be reached (give it seeds that have a new place).

## Architecture

```
shared/     deterministic code used by both sides
  layout.js     seed -> the plan of the valley: Route 9, the lake, which places and where, which roads
  world.js      the plan -> terrain, A*-routed roads, sites, buildings, props, containers, supply spots,
                doorways, vegetation, colliders
  playersim.js  movement + weapon state machine (prediction on the client, authority on the server)
  collision.js  OBB/cylinder colliders, uniform grid, raycasts
  protocol.js   binary Writer/Reader, message ids, quantization
  defs.js       items, weapons, recipes, structures, zombies, events (wire ids)
  nights.js     seed + night number -> the night's theme (what its horde is made of, and the warning)
server/     uWebSockets.js server, game loop, zombie AI + flow-field navigation, combat, snapshots
client/     three.js client: net/, game/ (prediction, entities, input, voice), render/, audio/, ui/
```

### Netcode

- Clients simulate input at a fixed 60 Hz and send their commands one packet per server tick (three
  commands, the later ones as deltas of the first; half as many packets while no key is held and the
  mouse is still). The server consumes them with a token bucket (anti speed-hack) using the *same*
  shared simulation. Because both ends run the same deterministic code, the server does not send a
  client its own state: every command packet carries an 8-bit fingerprint of the state the client
  predicted, and only when that disagrees with the server's result - or something other than the
  player's commands touched the state (knockback, a pickup, a respawn) - does the snapshot carry the
  authoritative state. The client then rewinds to it and replays unacknowledged commands; residual
  error is smoothed visually. `test-netsync` checks that the two stay in exact agreement, and get back
  into it within a round trip, with up to 250 ms of lag each way.
- Snapshots (20 Hz) are delta-compressed per client against what that client last received
  (WebSockets are reliable + ordered, so no ack window is needed) and only contain the sections that
  have something in them (a flags byte; tick and acked command are implied). Creates carry full
  state; updates are sorted by id and carry only changed fields behind a one-byte head, with ids as
  steps and positions (1/64 m) as 1-3 byte deltas; angles are 8-bit (zombies) or 9+7-bit (players),
  far entities update at half rate and only entities within the area of interest are sent. Events
  (sounds, shots, impacts, kills) are pre-encoded once and filtered per client by distance. Everything
  a client gets in a tick (player list, inventory, snapshot) leaves as one packet, and the ping rides
  inside the command packets and snapshots. `npm run bench:net` measures all of it.
- Hitscan and melee are lag compensated: each client reports the tick it was rendering, and the
  server rewinds zombie/player hitboxes (32-tick history) to it before tracing - to the render time
  that came with that very command, however long it sat in the queue, and as far back as 1 s
  (`MAX_REWIND`: a shot asks for its ping plus about 0.2 s). Shotgun spread is seeded
  deterministically so the shooter's predicted tracers match the server's pellets.
- The shooter sees what a shot strikes at once: the client judges its own pellets against the same
  hitboxes (`shared/hitbox.js`) where it has the zombies drawn and shows the blood or the puff off the
  wall as the gun fires, then drops the server's word of the same impact when it arrives. The damage
  and the hit marker stay the server's. `scripts/test-netsync.js` checks the rewind.
- Remote entities are interpolated 100 ms in the past from per-entity sample rings (a little further back
  when snapshots arrive unevenly). Zombies follow a cubic curve through their samples and coast through a
  late packet instead of freezing; their gaits pin planted feet to the ground in world space.
