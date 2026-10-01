# Survive The Night

A co-op multiplayer horror survival FPS in the browser. Your car broke down on Route 9 in the middle of
a dead valley. By day, scavenge the valley's farms, motels, trailer parks and roadside wrecks for the
supplies the car needs. By night, the horde comes to wherever you are, so you board up on the spot and
hold. Every night there are more of them. Install every supply, start the engine, survive the final
stand and drive away. Die, and you rise as one of them.

- **Client:** three.js (Vite), fully procedural art and audio (no asset files)
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

Environment variables (server): `PORT` (3000), `MAX_PLAYERS` (8), `SEED` (random world seed).
Testing only: `DAY_SECONDS`, `NIGHT_SECONDS`, `START_DAY`, `GODMODE=1` (survivors take no damage),
`DEBUG_COMMANDS=1` (chat commands `/night`, `/day`, `/kill`, `/down`, `/give <item> <n>`,
`/spawn <ztype> <n>` (`/spawn 10 3`: a zombie dog pack), `/supply`, `/parts`, `/engine`, `/unlock`, `/tp <x> <z>`,
`/where`, `/cat` (brings the stray cat over), `/den` (teleports next to the nearest zombie dog pack)).

### Tests & tools

| Command | What it does |
| --- | --- |
| `npm test` | syntax-checks every module, fuzzes the delta encoder/decoder (all entity kinds) and runs `sim-smoke` |
| `node scripts/sim-smoke.js [seed]` | in-process server run with fake clients: the cat, zombie dog packs (forest dens, pack hunting, lunge bites, head hitbox), containers, chopping, stations, schematic locks, door boards, pings, downed/revive, night waves, dawn summary, supplies, final stand, victory |
| `node scripts/worldstats.js [seed]` | world generation stats: places, roads, sites, containers, supply spots, doorways |
| `npm run test:bots` | headless bots join a running server, play, and report bandwidth + prediction error |
| `npm run test:e2e` | two headless Chrome clients: see each other, search a container, build, pick up, chat, drop weapon |
| `node scripts/e2e-weapons.js` | fires + reloads every gun, swings melee weapons, throws a molotov and a pipe bomb |
| `node scripts/e2e-showcase.js` | spawns every zombie type + boss, screenshots, death -> zombie mode, voice peers |
| `node scripts/e2e-stress.js` | ~120 zombies around the player, reports frame CPU time |
| `node scripts/e2e-motion.js [url] [s] [jitterMs] [latencyMs]` | a zombie pack chases the player; reports motion jitter (stalls, velocity kinks, wobble, planted-foot slip, hip pops), optionally over a simulated bumpy connection |
| `node scripts/e2e-night.js` | night shelter scene (torches, walls, traps) + proximity voice between two clients |
| `node scripts/shot.js <url> <out.png>` | headless Chrome screenshot |

Browser tests use the system Google Chrome via `puppeteer-core`. Showcase/stress/motion/night need a server
started with `GODMODE=1 DEBUG_COMMANDS=1`. Art/audio/UI modules also have standalone sandbox pages
under `client/sandbox/` (e.g. `/sandbox/map-test.html?debug=1` renders the valley map with every site,
container, supply spot and doorway, `/sandbox/props-test.html?new=1`, `/sandbox/icons-test.html`,
`/sandbox/audio-test.html`, `/sandbox/ui-test.html` on the Vite dev server;
`/sandbox/models-test.html?film=0` renders a walker's gait as a film strip and reports foot skating (`&anim=0` idle,
`&hurt=1` a hit flinch, `&vox=0` a growl);
`/sandbox/models-test.html?cats=grid` shows the cat's poses; `?grid=10`, `?variants=10` and `?film=10` show the
zombie dog's poses, coats and gait).

Measured on a laptop: the server ticks in ~2-3 ms with a 120+ zombie horde (50 ms budget); the client
spends ~0.8 ms updating and ~2.5 ms submitting a frame with 120 zombies on screen; bots see ~2 KB/s per
client and 0.00 cm prediction error.

## Deploying (Railway)

Production runs on [Railway](https://railway.com) as one service (project "Survive the Night FPS") that
auto-deploys every push to `main` and is served at https://survivethenightgame.com and
https://www.survivethenightgame.com.

- `railway.json` (config-as-code): Railpack builder, `npm run build`, `npm start`, health check
  `GET /status`, restart on failure, exactly **1 replica** and no app sleeping. Game state lives in
  memory, so never scale it past one replica, and expect every deploy to start a fresh world.
- Node 24 is pinned with `engines.node` in `package.json`. uWebSockets.js only ships prebuilt binaries
  for Node 20/22/23/24 on glibc Linux, so don't move to an Alpine/musl image.
- One process serves the client, the WebSocket (`/ws`) and `/status` on `PORT` (set to `3000` on the
  service) on all interfaces, so a single domain is enough.
- The custom domains are attached to the service in Railway (Settings -> Networking). Their DNS
  records (a CNAME to the Railway target plus a `_railway-verify` TXT record per host) are managed
  at the domain's DNS host.

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
| E | Interact: pick up, install supplies, feed a campfire, repair. **Hold** to search containers, revive a downed teammate, start the engine |
| Melee | Hit trees for sticks & planks, wrecks for scrap |
| Z / middle mouse | Ping: go here / danger (aim at a zombie) / loot (aim at an item or container) |
| M | Field map |
| F | Flashlight (battery drains, recharges when off) |
| G | Drop current weapon |
| H | Quick heal (bandage / canned tuna / painkillers / medkit; a medkit gets you up when downed) |
| Tab | Inventory + crafting (Q / E switch crafting tabs while it is open) |
| Enter | Chat |
| V | Push-to-talk proximity voice |
| Build mode | LMB place · RMB rotate · Q / E or wheel cycle structure · E repair (when aiming at a damaged structure) · X demolish |
| Zombie form | LMB claw · RMB leap |

## The game

- **The escape (objective):** your car died on Route 9. It needs a battery, a spare tire, spark plugs,
  a fan belt and three jerry cans of fuel. Every game the supplies are hidden in different places
  (the fuel in three of them), guarded by the dead; the HUD tells you where each one is *rumoured* to be.
  Carry them back and install them [E]. When all are in, hold [E] at the car to start the engine: it
  needs 90 seconds to warm up and every corpse in the valley hears it - the **final stand**. Survive it,
  get in (be within 14 m of the car) and you escape. The day/night clock stops during the final stand,
  so the team chooses when to go - fortify the car first.
- **Day: scavenge & rebuild.** A clock shows the time until nightfall. Every place has searchable
  containers (lockers, ammo crates, toolboxes, cabinets, fridges, shelves, duffel bags, car trunks,
  log piles; hold [E]) plus loot on the floor, and ~90 roadside and woodland sites (wrecks, abandoned
  camps, sheds, hunter stands, military stashes, burnt homesteads, roadblocks, graves) sit along the
  roads and in the woods between them, so every walk passes something worth searching. Melee a tree for
  sticks and planks, or a wreck for scrap and nails. Materials, ammo and consumables are picked up
  automatically when you walk over them. Searched containers partly restock at dawn. Supply planes
  drop crates marked by red smoke (often carrying a schematic). **Canned tuna** cannot be crafted, only
  found (fridges, cabinets, the dock, trailers, the campground): eating a tin heals 30 HP and restores
  your stamina.
- **Night: board up where you stand.** 45 seconds before dark the horn sounds. There is no base: the
  horde spawns around wherever the survivors are and comes in three waves (wave 1/3, 2/3, 3/3), so the
  team throws up a temporary shelter on the spot - door boards that snap into any doorway (survivors
  squeeze through, zombies must smash them; windows can still be vaulted), barricades, walls, gates,
  spike traps, barbed wire, torches and a campfire. At dawn the sun burns the horde and a card sums up
  the night (kills, walls lost, downed, revived, lost).
- **Every horde is harder:** more zombies (scaled by night *and* player count), more health and damage,
  and new specials: spitters, boomers & zombie dog packs (night 2), leapers & bats (3), ropers & tanks (4), and a boss every
  third night (The Abomination - ground slams and thrown boulders; The Hive Queen - acid barrages and
  bat swarms). Stragglers far from the team are brought back into the fight.
- **Zombie dogs:** packs of two to four den in the thickest woods from day one (more of them each day). They
  catch your scent from half again as far off as the dead, and the first to find you howls and
  brings the whole pack. They fan out to come at you from the sides, crouch and lunge for a bite, peel away and
  circle back in. Fast but fragile (a couple of pistol rounds, one to the head); from night 2 packs also run with
  the horde, breaking from the treeline.
- **Arsenal:** pistol, pump shotgun, double-barrel (two shells back to back, slow break-open reload),
  MP5 (full-auto 9mm, quiet), AK-47, M4A1 (full-auto 5.56, accurate) and a scoped hunting rifle, plus
  knife, bats, machete and hammer. Guns turn up where you would expect them: double-barrels on farms and
  in cabins, MP5s at the police station and checkpoint, M4A1s and 5.56 at the army checkpoint and the crash site.
  The **crossbow** is the quiet one: a single heavy bolt that only the dead within a few metres hear (a
  gunshot carries 45-70 m), paid for with a slow re-cock after every shot. It needs no schematic and no
  gunpowder - rope, sticks and scrap at the workbench, and more sticks and scrap for bolts.
- **Crafting:** simple things by hand anywhere (torches, bandages, molotovs, road flares, planks from
  sticks, bats, hammers). A **campfire** (buildable anywhere) is the station for medicine, painkillers
  and gunpowder, and heals survivors resting nearby. A **workbench** (buildable anywhere) is the station
  for melee weapons, the crossbow, ammo, armor, nails, batteries and explosives. Five **schematics** (shotguns, hunting
  rifle, kevlar, explosives, metal walls) are hidden in lockers, ammo crates and toolboxes around the map
  and unlock their recipes for the whole team.
- **Co-op:** at 0 HP you go **down** (crawl, pistol only, 30 s to bleed out). A teammate holds [E] on you
  to revive you, or you use a medkit. When nobody is left standing, the game is over. Pings, teammate
  nameplates, a compass with markers (the car, teammates, rumoured supplies, supply drops, discovered
  places) and a field map [M] keep the team together. Friendly fire is off, headshots deal bonus damage,
  health slowly regenerates.
- **Death:** survivors respawn as player-controlled zombies (claws + leap) hunting their former friends.

### The valley

Sixteen places joined by a road network that is routed over the terrain with A* (roads follow the
valleys, share corridors and bend around hills instead of radiating from a hub), a winding asphalt
highway, and forest trails: The Breakdown (your car, a rest area), Pinewood Motel, Hollow Creek (the
village: diner, general store, police station, garage, houses), Shady Pines Trailers, Lakeside
Campground, Blackwater Dock, Route 9 Gas Station, the Army Checkpoint (a roadblock with an abandoned
traffic jam), Granite Quarry, the Relay Station (fenced hilltop), Harlan Sawmill, Miller Farm,
St. Agnes Chapel, Ranger Lookout, the Hunting Cabins and the military Crash Site, plus a lake and
several ponds. Every place is generated deterministically from the seed.

## Architecture

```
shared/     deterministic code used by both sides
  world.js      seed -> terrain, places, A*-routed roads, sites, buildings, props, containers, supply
                spots, doorways, vegetation, colliders
  playersim.js  movement + weapon state machine (prediction on the client, authority on the server)
  collision.js  OBB/cylinder colliders, uniform grid, raycasts
  protocol.js   binary Writer/Reader, message ids, quantization
  defs.js       items, weapons, recipes, structures, zombies, events (wire ids)
server/     uWebSockets.js server, game loop, zombie AI + flow-field navigation, combat, snapshots
client/     three.js client: net/, game/ (prediction, entities, input, voice), render/, audio/, ui/
```

### Netcode

- Clients simulate input at a fixed 60 Hz and send commands (9 bytes each, batched in pairs).
  The server consumes them with a token bucket (anti speed-hack) using the *same* shared simulation,
  and acknowledges the last processed command in every snapshot. The client rewinds to the
  authoritative state and replays unacknowledged commands; residual error is smoothed visually.
  The bots measure the prediction error - it is 0.00 cm in normal play (fully deterministic).
- Snapshots (20 Hz) are delta-compressed per client against what that client last received
  (WebSockets are reliable + ordered, so no ack window is needed): creates carry full state,
  updates carry only changed fields behind a bitmask, positions are 1/64 m int16 or int8 deltas,
  angles are 8/16-bit, far entities update at half rate and only entities within the area of
  interest are sent. Events (sounds, shots, impacts, kills) are pre-encoded once and filtered per
  client by distance. Typical traffic is ~2-3 KB/s per client with 100+ zombies alive.
- Hitscan and melee are lag compensated: each client reports the tick it was rendering, and the
  server rewinds zombie/player hitboxes (16-tick history) before tracing. Shotgun spread is seeded
  deterministically so the shooter's predicted tracers match the server's pellets.
- Remote entities are interpolated 100 ms in the past from per-entity sample rings (a little further back
  when snapshots arrive unevenly). Zombies follow a cubic curve through their samples and coast through a
  late packet instead of freezing; their gaits pin planted feet to the ground in world space.
