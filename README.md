# Survive The Night

A co-op multiplayer horror survival FPS in the browser. Your car broke down on Route 9 in the middle of
a dead valley. By day, scavenge the valley's farms, motels, trailer parks and roadside wrecks for the
supplies the car needs. By night, the horde comes to wherever you are, so you board up on the spot and
hold. Every night there are more of them. Install every supply, start the engine, survive the final
stand and drive away. Die, and you rise as one of them until the sun comes up.

- **Client:** three.js (Vite), procedural art; procedural audio layered with ~16 MB of CC0 recordings
  (the score and stingers, ambience beds, weather, wildlife, footsteps, foley, gunshots, explosions, creature and survivor voices -
  see `client/audio/samples/CREDITS.md`), with a procedural fallback
- **Server:** Node + [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js), authoritative 20 Hz simulation
- **Netcode:** custom binary protocol, per-client delta compression, client-side prediction with
  reconciliation, entity interpolation, server-side lag compensation for hitscan and melee

## Running

```bash
npm install
npm run dev        # game server on :3000 + Vite dev server on :5173 -> open http://localhost:5173
```

Production:

```bash
npm run build      # builds the client into dist/
npm start          # serves dist/ + the WebSocket on http://localhost:3000
```

Environment variables (server): `PORT` (3000), `MAX_PLAYERS` (8), `SEED` (pins the map: without it every
playthrough is a new random valley), `TRUST_PROXY` (`1` / `0`: whether to take a player's address from the
`X-Forwarded-For` / `X-Real-IP` header; unset, only a proxy on a private network is believed - see
`clientAddress` in `server/index.js`. Joins are rate-limited per address), `STATS_FILE` (where the leaderboard is
kept: `data/stats.json` by default, or `stats.json` on the Railway volume when the service has one; empty keeps
nothing past the process).
Testing only: `DAY_SECONDS`, `NIGHT_SECONDS`, `START_DAY`, `GODMODE=1` (survivors take no damage),
`DEBUG_COMMANDS=1` (chat commands `/night`, `/day`, `/kill`, `/down`, `/give <item> <n>` (the item by name:
`/give flamethrower`, `/give flamethrower fuel 200`; `/items` lists the names, `/items ammo` the matching ones),
`/spawn <zombie> <n>` (the type by name, up to 20 at once, 12 m ahead: `/spawn tank`, `/spawn dog 3` for a zombie
dog pack, `/spawn hive queen`; `/zombies` lists the names), `/supply`, `/parts`, `/engine`, `/unlock`, `/tp <x> <z> [y]`
(with a height: onto what is under feet at it, down a drift of the mine), `/mine` (to the adit of Blackrock Mine;
`/mine far` to the far portal, `/mine in` down to the junction), `/clinic` (to the front door of Mercy Clinic;
`/clinic ward` into its dark wards; says so on a map without it), `/gun` (to the grips of the mounted gun at the
Army Checkpoint; it says so when the map has no checkpoint: seed 1 has one), `/where`, `/cat` (brings the stray cat over), `/den` (teleports next to the nearest zombie dog pack),
`/herd` (teleports 45 m from the wandering herd, just out of its sight), `/deer` (34 m from the nearest group of deer;
`/deer spawn [m]` puts a group 20 m - or that many - ahead, and lets you stand there ten seconds before it notices you), `/legs [1|2]` (takes one or both legs
off every zombie within 30 m that has legs to lose), `/bell` (the chapel bell tolls, wherever you are), `/radio`
(to the Relay Station's radio with the two batteries a call costs; says so if the map has no Relay Station),
`/cemetery` (to the gate of St. Agnes Cemetery; `/cemetery rise [n]` makes the n graves nearest you give up their
dead now)).

### Tests & tools

| Command | What it does |
| --- | --- |
| `npm test` | syntax-checks every module, fuzzes the delta encoder/decoder (all entity kinds) and the command packets, checks that prediction and server stay in step on a laggy link (`test-netsync`), checks the layout of every place (`test-world`), the mine under the valley (`test-mine`), Mercy Clinic's dark wards (`test-clinic`), St. Agnes Cemetery (`test-cemetery`) and the deer (`test-deer`) and runs `sim-smoke` |
| `npm run bench:net` | network traffic benchmark: the real server against simulated clients (real encoder, prediction and decoder) through a seeded session - idle, roaming, a night's fight. Reports packets and bytes per client per second in both directions and where the snapshot bytes go (`--players 8`, `--seed n`, `--day n`, `--json out.json`) |
| `node scripts/sim-smoke.js [seed]` | in-process server run with fake clients: the cat, zombie dog packs (forest dens, pack hunting, lunge bites, head hitbox), the wandering herd (slow walk together, roused by sight and by noise, losing a survivor), containers, chopping (and the client's harvest prompt: same reach and yields as the server), stations, schematic locks, door boards, pings, downed/revive, night waves, night themes, dawn summary, supplies, final stand, victory |
| `node scripts/test-records.js` | the personal record (`client/ui/records.js`) against a stand-in for `localStorage`: what a run does to the bests, junk in storage, storage that refuses or is not there (part of `npm test`) |
| `node scripts/test-stats.js` | the leaderboard (`server/stats.js`) against the real server in-process: what goes on a player's record (kills, nights, wins, revives) and what does not, the stats file across a restart and with junk in it, the board a client is sent - and that the id a player joins with is in nothing sent to any client, logged or saved |
| `node scripts/test-gun.js [seed]` | the mounted gun at the Army Checkpoint, against the real server in-process: the nest on every valley that has the checkpoint (its grips free, its field of fire clear of its own sandbags), one gunner at a time whose commands fire it and nobody else's, 600 rounds a minute heard 110 m off, a round lag compensated like any gun's (a walker crossing 60 m out, aimed where it was drawn 250 ms before: against the AK-47 through the same path), through one body into the next, the gunner's kills, the belt spent, clicking empty, fed from the backpack's 7.62 and reset by a new game, letting go by [E], stepping away, going down and dying, and the dead getting round the sandbags to the gunner (part of `npm test`) |
| `node scripts/test-ammo.js [seed]` | ammunition in the backpack, against the real server in-process and decoded as a client does: the starting 9mm is a stack, pickups stack up, a reload takes its rounds out of the backpack (last stack first, a shotgun shell by shell), a stack splits (`ACT.SPLIT_INV`) and part of it is dropped for a teammate who walks over it, counts past 255 survive the wire, and the reserve the guns reload from is the backpack's count after every tick (part of `npm test`) |
| `node scripts/test-fixtures.js [seed]` | the chapel bell and the Relay Station's radio, against the real server in-process and decoded as a client does: the rope, the bell and the radio are where world generation drew them and can be reached (not through a wall); a pull rings three tolls everyone hears, the idle dead at 60, 150 and 210 m and the herd come and the ones at 240 m do not, and the rope waits 45 s; a call spends two batteries and drops the crate where the caller stood, once a day and by day only; the client's prompts say why not, and the server never refuses a prompt for distance (part of `npm test`) |
| `node scripts/test-deer.js [seed ...]` | the deer against the real server in-process: where the groups are put, what makes them bolt (a survivor standing or crouched, a noise, the dead) and how far and fast, a shot at a running one missing unless the server rewinds to the shooter's picture exactly as for a zombie dog, head shots on a grazing one, what a kill leaves and that it counts for nothing, that nothing that walks the zombie list meets them, the dawn's newcomers, venison, that none of it draws on the game's random stream, and half an hour of being chased about with none in the lake, the mine or a wall and none pushing at a fence (part of `npm test`; `VERBOSE=1` prints the passes) |
| `node scripts/worldstats.js [seed]` | world generation stats: places, roads, sites, containers, supply spots, doorways |
| `node scripts/daytime.js [maps] [--floor] [--rows]` | how long a day has to be: walks the real player simulation from the spawn to the nearest place, round its containers, on to the next place and round that one, on 40 random valleys, sprinting and walking. `DAY_LENGTH` was set from it |
| `node scripts/test-mine.js [seed ...]` | the workings under the mine on a dozen valleys: the drift is cut, roofed and dry; feet, rays and bodies take the right one of the two levels (a survivor walks in at the adit and out at the far portal by the real simulation, cannot walk into the rock, and stays on the ground when crossing over it); what the rooms hold can be reached; and in a running game the dead live down there, follow a survivor in and out by the portals, hear noise round by the mouths and are spared by the dawn. `VERBOSE=1` prints the passes too |
| `node scripts/test-clinic.js [seed ...]` | Mercy Clinic on the first five valleys that have it: daylight in reception and outside, the wards wholly dark and the passage between going dark with no step in it, the one drug locker in the dark, the valley's flow fields leading into the deepest ward and out again; and in a running game the dead of the wards keep to them and go back when led out, a Shade moves in there at noon and is pinned in reception, the sunrise spares what stands in the wards, the drug locker's contents come once, and `/clinic` works. `VERBOSE=1` prints the passes too |
| `node scripts/test-cemetery.js [seed ...]` | St. Agnes Cemetery on six valleys (every grave is open ground a body can stand up on, the casket and the crypt's doorway) and in a running game: a restless grave by day (the warning, the climb, a head shot while it climbs and a shot that the ground stops), the dead of the graves getting out through the railings to the chapel's door, a wave's share of the horde, and a scripted night inside a ring of walls round the chapel: the dead come up inside it and reach the survivors, and the horde is no bigger for it (part of `npm test`) |
| `node scripts/test-world.js [seed ...]` | the authored places of four valleys (every place at least once), as a survivor meets them: every doorway can be walked through (the real player simulation), every container, floor-loot point and supply spot can be reached on foot from the place's front gate and is not inside something solid, no road runs into a building. A failure names the place, the spot in the place's own frame and a `/tp` to go and look |
| `npm run test:bots` | headless bots join a running server, play, and report bandwidth + prediction error |
| `npm run test:e2e` | two headless Chrome clients: see each other, search a container, build, pick up, chat, drop weapon |
| `node scripts/test-itemguide.js` | holds the "Used in" / "Found in" lines of the inventory tooltips against the recipe and loot tables they are derived from, generated worlds and the server's gathering (runs after `npm test`, as its `posttest`) |
| `node scripts/e2e-weapons.js` | fires + reloads every gun, swings melee weapons, throws a molotov and a pipe bomb |
| `node scripts/e2e-showcase.js` | spawns every zombie type + boss, screenshots, death -> zombie mode, voice peers |
| `node scripts/e2e-stress.js` | ~120 zombies around the player, reports frame CPU time |
| `node scripts/e2e-motion.js [url] [s] [jitterMs] [latencyMs]` | a zombie pack chases the player; reports motion jitter (stalls, velocity kinks, wobble, planted-foot slip, hip pops), optionally over a simulated bumpy connection |
| `node scripts/e2e-night.js` | night shelter scene (torches, walls, traps) + proximity voice between two clients |
| `node scripts/e2e-legs.js [url] [outdir]` | shoots a walker in the shins with the pistol until it has no legs left: the stumble, each leg coming off, the hobble, the crawl, a head shot where it lies, with a screenshot of each |
| `node scripts/shot.js <url> <out.png>` | headless Chrome screenshot |

Browser tests use the system Google Chrome via `puppeteer-core`. Showcase/stress/motion/night/legs need a server
started with `GODMODE=1 DEBUG_COMMANDS=1`. Art/audio/UI modules also have standalone sandbox pages
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
  `GET /status`, restart on failure, exactly **1 replica** and no app sleeping. Game state lives in
  memory, so never scale it past one replica, and expect every deploy to start a fresh world.
- The leaderboard (`server/stats.js`) is a JSON file, and a deploy starts from a fresh disk: attach a
  volume to the service and the file goes there by itself (`RAILWAY_VOLUME_MOUNT_PATH`). Without one
  every deploy empties the board.
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
- Is it keeping up? With players on, a `[stats]` line every 10 s gives the tick time over those 10 s (`tick`
  mean, `p99`, `max`), `over a/b` (ticks past the 50 ms budget: everyone rubber-bands) and `late` / `latemax`
  (how late the loop woke: the host or the event loop was busy, not the tick itself). A tick over budget also logs
  `slow tick` at once (at most one line per 5 s) with the ms per section (`phase=`, `zombies=`, `snapshots=`, ...)
  and the player, zombie and entity counts. `GET /status` has the same under `tick`, with totals since boot.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Shift | Sprint (stamina) |
| Space | Jump (vault barricades and windows) |
| Ctrl / C | Crouch (quieter - zombies notice you less) |
| Mouse | Look · LMB fire / attack · RMB aim / heavy melee |
| 1 2 3 4 5 | Primary · Pistol · Melee · Throwable (press again to cycle) · Build (hammer) |
| Q / wheel | Last weapon / cycle weapons (build mode: Q / E cycle structure) |
| R | Reload |
| E | Interact: pick up, install supplies, feed a campfire, repair. **Hold** to search containers, revive a downed teammate, start the engine, drive away once it is warm |
| Melee | Hit trees for sticks & planks, wrecks for scrap |
| Z / middle mouse | Ping: go here / danger (aim at a zombie) / loot (aim at an item or container) |
| L | Leaderboard: every player's kills, nights survived, wins and revives over all their games, and yours. Click a column to sort by it |
| M | Field map. Click to set your own waypoint (on a place's name or yard: that place); click it again, right-click or X to clear it. It shows on the compass and in the world with its distance until you get there |
| F | Flashlight (battery drains, recharges when off; a beam held on a Shade keeps it frozen) |
| G | Drop current weapon |
| H | Quick heal (bandage / canned tuna / cooked venison / painkillers / medkit; a medkit gets you up when downed) |
| I | Inventory + crafting (Q / E switch crafting tabs while it is open; Shift+click a recipe crafts 5, Ctrl+click - Cmd on a Mac - as many as the materials allow, up to 20). In the backpack: right-click drops a stack, Shift+right-click one of it, and Shift+click a stack to pick how much of it to split off into a slot of its own or drop |
| Tab (hold) | Player list: who is in the game, with their health, kills and ping, and who is down, dead or turned |
| Y / Enter | Chat (heard by survivors within 35 m - or by everyone carrying a walkie-talkie, if you carry one too) |
| V | Push-to-talk proximity voice (same reach as chat) |
| Build mode | LMB place · RMB rotate · Q / E or wheel cycle structure · E repair (when aiming at a damaged structure) · X demolish |
| Zombie form | LMB claw · RMB leap |

The HUD names a key at the moment it answers something: the flashlight when night falls and the light is off,
quick heal when you are under half health with something that heals in the pack, the build slot at the dusk
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
- **Day: scavenge & rebuild.** A clock shows the time until nightfall. A day is short - 2:45, the first
  3:15 - sized for a dash to one place or two, a look round each, and the horn. Every place has searchable
  containers (lockers, ammo crates, toolboxes, cabinets, fridges, shelves, duffel bags, car trunks,
  log piles; hold [E]) plus loot on the floor, and ~90 roadside and woodland sites (wrecks, abandoned
  camps, sheds, hunter stands, military stashes, burnt homesteads, roadblocks, graves) sit along the
  roads and in the woods between them, so every walk passes something worth searching. Melee a tree for
  sticks and planks, or a wreck for scrap and nails. Materials, ammo and consumables are picked up
  automatically when you walk over them - except a stack you dropped yourself (right-click it in the
  backpack), which stays down until you have walked a few steps away, so you can clear a slot or leave
  it for a teammate. A full backpack tells you what it left lying. **Ammunition** is carried in the
  backpack like everything else, a stack per calibre (150 rounds of 9mm to a stack, 240 of 7.62, ...), and
  the guns reload out of it: to share it, Shift+click the stack, pick how many, and drop them.
  Searched containers partly restock at dawn. Supply planes
  drop crates marked by red smoke (often carrying a schematic). **Canned tuna** cannot be crafted, only
  found (fridges, cabinets, the dock, trailers, the campground): eating a tin heals 30 HP and restores
  your stamina.
- **Talking carries only so far.** Voice and text chat reach the survivors around you: clear out to 25 m,
  fading to nothing by 35 m (a chat line from the edge of earshot shows up faint, and your own line tells you
  when nobody was close enough to hear it). **Walkie-talkies** bridge the rest: six are hidden in lockers,
  ammo crates and toolboxes every game - they cannot be crafted, only found. Just carry one, and your voice
  and chat reach every other survivor carrying one, anywhere in the valley (a radio line is marked with a
  handset, a radio voice crackles through the handset's speaker). Both ends need one; drop yours for a
  teammate who has none, and you lose it when you die.
- **Night: board up where you stand.** 45 seconds before dark the horn sounds. There is no base: the
  horde spawns around wherever the survivors are and comes in three waves (wave 1/3, 2/3, 3/3), so the
  team throws up a temporary shelter on the spot - door boards that snap into any doorway (survivors
  squeeze through, zombies must smash them; windows can still be vaulted), barricades, walls, gates,
  spike traps, barbed wire, torches and a campfire. At dawn the sun burns the horde and a card sums up
  the night (kills, walls lost, downed, revived, lost).
- **Every horde is harder:** more zombies (scaled by night *and* player count), more health and damage,
  and new specials: spitters, boomers, zombie dog packs & shades (night 2), leapers & bats (3), ropers & tanks (4),
  and a boss every third night (The Abomination - ground slams and thrown boulders; The Hive Queen - acid barrages
  and bat swarms). Night 2 has a boss of its own: a Tank. You hear its footfalls
  thump long before you see it, and inside 30 m each one shakes the camera (a charge is a rumble); it charges, smacks survivors off their feet, breaks a wood barricade with one
  blow and ploughs straight through whatever its charge breaks. Every boss comes in with the second wave, with
  most of the night still ahead: bring it down before sunrise and it drops what it carries (ammunition, medkits,
  gun parts). One that is still standing at dawn burns in the sun with the rest of the horde and leaves nothing.
  A boomer cannot claw at what you built: stopped
  by it with a survivor close behind, it swells for a second and bursts against it, taking that piece with it (a
  metal wall is dented). Shoot it before it gets there - or while it swells, and the piece only takes the blast.
  Stragglers far from the team are brought back into the fight.
- **Some nights have a theme.** From night 2 on, about two nights in three draw a theme from the map's seed and
  the night number, never the same one two nights running; night 1 is always plain. A theme changes what the
  horde is made of, not how many come: **The Pack** (about a third of the horde are dogs),
  **Sprinters** (half are runners), **Bile** (spitters and boomers), **Lights Out** (twice the shades the night
  would allow, six at most), **Wings** (bats and leapers, from night 3) and **The Snare** (ropers, from night 4).
  The dawn card names the coming night's theme and what to do about it ("Dog packs: they cannot jump a
  barricade, so close the ring and leave no gap."), the dusk horn repeats it and the night's title carries its name.
  The table is `NIGHT_THEMES` in `shared/nights.js`.
- **Noise brings the dead.** Every zombie with nobody to chase heads for what it hears, and the louder the
  noise the further it carries: an MP5 35 m, a pistol 45 m, rifles 70 m, shotguns 80-90 m, the hunting rifle 100 m,
  a car alarm 140 m, a pipe bomb or a bursting boomer 170 m, the chapel bell 220 m. More carry means more of them coming - and the
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
  fire - and comes for you the moment the light is gone. Frozen, it shrugs off three quarters of all damage
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
- **The mounted gun.** On a map with the Army Checkpoint, a heavy machine gun stands on a tripod in a horseshoe of
  sandbags beside the boom gate, covering the road out. It does not move: stand at its grips and press [E] to man
  it (one gunner at a time; the prompt says how much belt is left). Your own weapon goes down, and your fire button
  is its trigger: 600 rounds a minute, each a little harder than an AK-47's and through one body into the next,
  out to 200 m in a tight cone, with no climb. It swivels with your view 70 degrees either side of the road and
  from 15 degrees down to 25 up; look further and it stays at its stop. Step away, press [E] again, go down or die
  and you let go. It is the loudest gun in the valley - every shot carries 110 m - so using it brings the
  neighbourhood, and the sandbags only cover the front: the dead walk round into the open back. **One belt:** it
  has 250 rounds when the game starts, shown in place of your ammunition while you man it, and when they are gone
  it clicks. Hold [R] (or [E]) at the grips to feed it 50 rounds a second from the 7.62 in your backpack - the
  same rounds the AK-47 eats - up to 250. Its belt and who mans it start over with every new game; its kills are
  the gunner's.
- **Crafting:** simple things by hand anywhere (torches, bandages, molotovs, road flares, planks from
  sticks, bats, hammers). A **campfire** (buildable anywhere) is the station for medicine, painkillers
  and gunpowder, and heals survivors resting nearby. A **workbench** (buildable anywhere) is the station
  for melee weapons, the crossbow, ammo, armor, nails, batteries and explosives. Five **schematics** (shotguns, hunting
  rifle, kevlar, explosives, metal walls) are hidden in lockers, ammo crates and toolboxes around the map
  and unlock their recipes for the whole team. Two materials have to be looked for: **leather** (padded jacket,
  machete) in car trunks and duffel bags, on the farm, in the cabins and at the lodge - or off a deer - and **kevlar plates** (two
  to a vest) in ammo crates, which hold them in pairs.
- **Co-op:** at 0 HP you go **down** (crawl, pistol only, 30 s to bleed out). A teammate holds [E] on you
  to revive you, or you use a medkit. When nobody is left standing, the game is over. Pings, teammate
  nameplates, a compass with markers (the car, teammates, rumoured supplies, supply drops, discovered
  places) and a field map [M] keep the team together. A nameplate carries its owner's health bar while they
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
- **The lake** lies somewhere out towards the rim, away from the highway, with a handful of ponds.
- **Sixteen places** to a map. Six are on every one: The Breakdown, Route 9 Gas Station, St. Agnes Chapel (with
  St. Agnes Cemetery behind it, `shared/cemetery.js`), Blackwater Dock (always on the lake shore, pier out over the water), Hollow Creek (the village: diner,
  general store, police station, garage, houses) and Blackrock Mine (on high ground). The other ten are drawn
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
  AK-47 or a flamethrower, loaded, with two magazines more and two pipe bombs. It is there once; it does not
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
