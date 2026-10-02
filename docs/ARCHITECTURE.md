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
  collision.js   static/dynamic collider grids, ray casts
  playersim.js   deterministic player movement + weapon simulation (prediction on client, authority on server)
server/      authoritative game server (uWebSockets.js)
client/      three.js client (Vite root)
  index.html, main.js
  net/        connection, snapshot decode, interpolation, prediction
  game/       client game state, entity views, input, weather schedule (weather.js)
  render/     renderer, sky, terrain, vegetation, water, post, particles, weather fx, textures, materials, models/
  audio/      WebAudio engine: procedural synthesis + CC0 recordings in audio/samples/ (samples.js loads
              them after init; any sound whose file fails to load/decode falls back to its procedural version)
  ui/         DOM HUD (hud.js + hud2.js: compass, objective, world markers, downed, summary), field map
              (mapcanvas.js bakes it, mapscreen.js shows it), splash, inventory/crafting, build menu, chat
  sandbox/    standalone dev pages for visually testing modules (not shipped)
scripts/     dev runner, headless screenshot helper (scripts/shot.js), look-dev harness (scripts/lookdev.js)
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
- Performance budget: 60 fps on a mid-range laptop GPU with ~80 zombies on screen. One draw call per zombie
  (single SkinnedMesh, rigid skinning), instanced vegetation, merged static geometry.

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
  are allocated once; keep it that way.
- **Global state**: all of it when anything but the clocks changed, otherwise just time / horde left once a
  second. **Events**: encoded once, filtered per client by radius / recipient; a shot carries no origin (the
  client uses the shooter's replicated position).
- `compression` stays off: permessage-deflate was measured at ~10% of the remaining payload, not worth the CPU.

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
  holes in the shadow (chain link, weeds, stencils) cast from their own mesh. The viewmodel scene has
  its own lights; `Game.updateViewmodelLight` rotates the key light into camera space and dims it by a
  ray/crown probe towards the light so hands are dark in shade.
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
  real game (server with `GODMODE=1 DEBUG_COMMANDS=1`) and prints uncapped fps, draw calls, triangles and the
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
- **Start-up.** The browser only allows audio after a user gesture, so `main.js` starts the engine on the first key
  or pointer press on the splash (the click on Join at the latest) and nothing waits for it: the join opens the
  socket straight away. Until `audio.ready` (about a second of bank rendering) a one-shot asked for is dropped and
  a loop is only queued, so the game can be in play before there is sound; ambience and music then come in from
  the state of that moment, and `main.js` plays the join stinger it could not play earlier.
- **Checking it without ears.** `/sandbox/audio-test.html` plays everything by hand (`?procedural` for the
  fallback); `?autotest` runs the engine's self-test (every recording decodes, loops are seamless, beds follow
  the state) and ends with `AUDIO_TEST_OK`. `node client/audio/selftest.js` checks the procedural banks.

## Gameplay systems (iteration 2)

- **No base.** Structures can be built anywhere (within 7 m of the builder). `STRUCT.DOOR` snaps into the
  doorways recorded by world generation (`world.openings`); campfires and workbenches are crafting stations
  (`STRUCT_DEFS[t].station`), recipes name the station they need (`RECIPES[i].station`) and optionally a
  schematic (`schem`, team-wide unlock bitmask in the global state).
- **Crafting in bulk** (Shift / Ctrl+click a recipe) is not in the protocol: it is `ACT.CRAFT` sent n times. The
  server refuses each craft it cannot do with a toast, so the client counts first: `craftRun` in
  `client/game/bulkcraft.js` repeats the checks of `Game.craft` and the slot rules of `server/inventory.js` on a
  copy of the inventory (and, stricter than the server, only counts ammunition while a whole batch fits the
  reserve). `sim-smoke` holds it against the server, so change the two together. The inventory screen replays
  the crafts still on their way before it counts again (`Inventory._model`), the repeats leave through a bucket
  in `Game.sendCrafts` (the server drops what a client sends past 200 messages a second), and a listener plays
  one craft sound per 0.1 s however many `SOUND.CRAFT` events a tick brings.
- **The escape.** `SUPPLIES`/`SUPPLY_NEED` in defs; the server hides each supply at one of the candidate
  places' `world.partSpots` every game and replicates the rumoured zones (`global.hints`). Installing all
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
  A boss night's boss (`bossPending`) comes in with wave `BOSS_WAVE`; `Game.spawnBosses` scales its health by
  `BOSS_HP_PER_PLAYER`. A boss drops its loot only if it dies before the dawn sun sets it alight (`z.onFire`,
  `Combat.killZombie`); the sun's kill goes to the killfeed as `KILLER.WORLD`.
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
- **Supply drops** (`spawnSupplyDrop`): the server picks a supply spot and a random heading, emits one
  `EVT.FLYOVER` (plane origin at release, heading, eta; constants `PLANE_*` / `CRATE_*`) and PLANE_LEAD / PLANE_SPEED
  seconds later spawns the crate at the cargo ramp with the plane's speed: state 3 free fall, 0 under the canopy
  (it sheds the forward speed and lands exactly on the spot), 1 landed, 2 opened. The client (`render/flyover.js`)
  flies the plane model (`models/plane.js`), trails GPU-animated smoke puffs that linger ~2.5 min and drift with
  the wind, and plays the engine drone as a positional loop (speed-of-sound delay, doppler, air absorption).
  `/airdrop` (debug commands) calls one in.
- **Talking.** Chat and voice reach `TALK_RANGE` (clear to `TALK_CLEAR`); beyond it a walkie-talkie link
  carries them (`radioLinked` in defs: both ends carry `ITEM.WALKIE`). Text is gated on the server:
  `handleChat` sends each recipient its own `S2C.CHAT` flags (`CHATF`: radio / faint / unheard). Voice is a
  peer-to-peer WebRTC mesh the server cannot gate, so the receiving client does it: `S2C.PLAYERS` carries who
  holds a walkie (`PLF.WALKIE`), and each `VoiceSource` in `audio.js` mixes a positional path with a band-limited
  radio path that takes over as the speaker leaves earshot (or the area of interest). The walkies themselves
  are `WALKIE_STASHES` extra items hidden in schematic-type containers by `startGame` on their own random
  stream (`cache.stash`), and never despawn once dropped.
- **Downed/revive** is part of the deterministic player state (`s.downed`: crawl speed, pistol only).
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
- **Item guide** (`client/game/itemguide.js`): the "Used in" and "Found in" lines of the inventory's tooltips are
  derived at load from `RECIPES`, `STRUCT_DEFS`, the loot tables (`CONT_TABLES`, `LOOT_TABLES`, `ZOMBIE_LOOT`,
  `SPECIAL_LOOT`) and `PLACES`, so a new recipe, item or table needs no text written for it. The one thing it
  repeats by hand is `GATHER`, what a hit on a tree or a wreck gives (`Game.gatherHit`): change the two together.
  `scripts/test-itemguide.js` holds every line against the tables, generated worlds (which place tables are
  rolled at all) and the server's gathering. Supply-drop loot (`CRATE_TABLE`, private to the server) is not in it.
