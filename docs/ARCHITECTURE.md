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
  protocol.js    Writer/Reader, message ids, quantization, entity field layouts
  world.js       deterministic world generation from a seed: terrain (+ lake/ponds), 16 places, A*-routed
                 roads, roadside/woodland sites, buildings, props, containers, supply spots, doorways,
                 vegetation, colliders
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
- Materials: prefer `MeshLambertMaterial` (performance). Share geometries and materials; never allocate
  in per-frame paths. The scene keeps a FIXED number of lights (light count changes force shader recompiles);
  toggling a light's `castShadow` also recompiles, so only quality changes do it.
- Textures are procedural canvas textures. Audio is synthesized, except the CC0 recordings in
  `client/audio/samples/` (credited in its CREDITS.md; CC0 only) which always keep a procedural fallback.
- Performance budget: 60 fps on a mid-range laptop GPU with ~80 zombies on screen. One draw call per zombie
  (single SkinnedMesh, rigid skinning), instanced vegetation, merged static geometry.

## Rendering pipeline

- **Frame:** world -> `ScreenPasses` (`render/post.js`: SSAO, sun shafts, flashlight beam, applied in place into
  the MSAA scene target with one blended quad) -> eye-adaptation metering -> viewmodel -> bloom -> final pass
  (ACES, horror grade, grain, damage/infected vision) in `render/renderer.js`.
- **Quality presets** (`QUALITY` in `render/renderer.js`: low / medium / high / ultra) own every cost knob:
  pixel-ratio cap, MSAA, sun shadows (map size per cascade, range), which objects cast (foliage, characters,
  flashlight), SSAO, sun shafts, grass density, tree distance. Everything applies live on a settings change
  (`main.js applySettings` -> renderer, Environment.setShadows, Foliage.setQuality, Game.setShadowQuality).
  The render-scale setting multiplies the preset's pixel ratio.
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
  static world, trees (+ bushes/rocks and characters on high/ultra), built structures. The viewmodel scene has
  its own lights; `Game.updateViewmodelLight` rotates the key light into camera space and dims it by a
  ray/crown probe towards the light so hands are dark in shade.
- **Time of day** is one palette table (`KEYS` in `render/environment.js`): colours, light levels, fog, mist,
  haze scatter, shaft strength and base exposure per sun height. Eye adaptation only compensates relative to
  `Environment.adaptRef` (the log-average luminance an open scene has at that light level), clamped 0.7-1.6x.
- **Look-dev:** `node scripts/lookdev.js --url <vite url> name:x,z,yaw,pitch,cycle[,flash] ...` screenshots the
  real game (server with `GODMODE=1 DEBUG_COMMANDS=1`) and prints uncapped fps, draw calls, triangles and the
  adapted exposure; `--debug 1|2` shows only the sun shafts / only the SSAO.

## Gameplay systems (iteration 2)

- **No base.** Structures can be built anywhere (within 7 m of the builder). `STRUCT.DOOR` snaps into the
  doorways recorded by world generation (`world.openings`); campfires and workbenches are crafting stations
  (`STRUCT_DEFS[t].station`), recipes name the station they need (`RECIPES[i].station`) and optionally a
  schematic (`schem`, team-wide unlock bitmask in the global state).
- **The escape.** `SUPPLIES`/`SUPPLY_NEED` in defs; the server hides each supply at one of the candidate
  places' `world.partSpots` every game and replicates the rumoured zones (`global.hints`). Installing all
  of them enables the engine hold-interaction, which starts the final stand (`game.escape`).
- **Night waves.** `startNight()` builds `NIGHT_WAVES` queues; groups spawn 58-84 m around a random
  survivor (`Zombies.pickSpawnAround`). The horde never targets structures or a fixed point - only people.
- **Light and the Shade.** `ZTYPE.SHADE` (`ZOMBIE_DEFS[t].shade`) only moves in darkness. Every tick
  `Zombies.isLit` asks whether light reaches it: it is day, it stands within the `light` radius of a burning
  torch / campfire (`STRUCT_DEFS`), a road flare (`THROWABLES`) or a molotov fire, or it is inside a survivor's
  flashlight cone (`FLASHLIGHT_RANGE`, `FLASHLIGHT_CONE`) - each with a clear ray to its head, chest or shins,
  so walls, trees and terrain cast shadows. While lit (`z.lit`) it holds still with `ZANIM.FROZEN`, takes
  `litResist` x damage and no knockback (`Combat.damageZombie`); the client keeps the pose it was caught in
  (`ZombieInstance.hold`) and plays the freeze / release sounds from the replicated anim, with no extra traffic.
- **Containers** are `ENT.CACHE` entities (position + searched state) created from `world.containers`;
  searching is a server-side hold interaction (`ACT.HOLD_BEGIN/END`, progress in the self state).
- **Supply drops** (`spawnSupplyDrop`): the server picks a supply spot and a random heading, emits one
  `EVT.FLYOVER` (plane origin at release, heading, eta; constants `PLANE_*` / `CRATE_*`) and PLANE_LEAD / PLANE_SPEED
  seconds later spawns the crate at the cargo ramp with the plane's speed: state 3 free fall, 0 under the canopy
  (it sheds the forward speed and lands exactly on the spot), 1 landed, 2 opened. The client (`render/flyover.js`)
  flies the plane model (`models/plane.js`), trails GPU-animated smoke puffs that linger ~2.5 min and drift with
  the wind, and plays the engine drone as a positional loop (speed-of-sound delay, doppler, air absorption).
  `/airdrop` (debug commands) calls one in.
- **Downed/revive** is part of the deterministic player state (`s.downed`: crawl speed, pistol only).
- **Weather** is client-side only and adds no network traffic. `client/game/weather.js` derives a seeded
  schedule (fog banks, gales, rain, thunderstorms; weighted toward dusk and night, and the first evening always
  brings fog) from the world seed and the replicated phase clock (`phase`, `day`, `timeLeft`, `phaseLen`), so
  every client sees the same weather. Lightning strikes come from hashed 0.5 s slots of that clock, so they land
  at the same time and place for everyone; each listener hears the thunder after its own distance delay. The
  renderer reads `weather.state` for fog density (and the valley mist), the overcast deck (no sun shafts),
  lightning light, wind (`Foliage.update` drives `G.uWind`: trees bend trunk and crown together, grass and bushes
  lean; the ambience plays the same wind), ground mist, the flashlight beam's haze (post.js, denser in rain), and
  rain streaks and splashes (`render/weatherfx.js`, kept out from under `world.roofs`).
