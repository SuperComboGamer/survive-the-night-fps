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
  game/       client game state, entity views, input
  render/     renderer, sky, terrain, vegetation, water, post, particles, textures, materials, models/
  audio/      procedural WebAudio engine (no audio files)
  ui/         DOM HUD (hud.js + hud2.js: compass, objective, world markers, downed, summary), field map
              (mapcanvas.js bakes it, mapscreen.js shows it), splash, inventory/crafting, build menu, chat
  sandbox/    standalone dev pages for visually testing modules (not shipped)
scripts/     dev runner, headless screenshot helper (scripts/shot.js)
```

## Conventions

- ES modules everywhere. `import * as THREE from 'three'` on the client.
- Units: meters, seconds, radians. Y is up.
- **Facing:** yaw = rotation about +Y. yaw 0 faces **-Z**. forward = (-sin(yaw), 0, -cos(yaw)).
  Models must be authored so their FRONT faces **-Z**; then `object.rotation.y = yaw` orients them.
- Camera: Euler order `'YXZ'`, `rotation.y = yaw`, `rotation.x = pitch` (pitch > 0 looks up).
- Human player: capsule radius 0.35, height 1.8 m, eye height 1.62 m.
- Materials: prefer `MeshLambertMaterial` (performance). Share geometries and materials; never allocate
  in per-frame paths. The scene keeps a FIXED number of lights (light count changes force shader recompiles).
- No external asset files: all textures are procedural canvas textures, all audio is synthesized.
- Performance budget: 60 fps on a mid-range laptop GPU with ~80 zombies on screen. One draw call per zombie
  (single SkinnedMesh, rigid skinning), instanced vegetation, merged static geometry.

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
- **Containers** are `ENT.CACHE` entities (position + searched state) created from `world.containers`;
  searching is a server-side hold interaction (`ACT.HOLD_BEGIN/END`, progress in the self state).
- **Downed/revive** is part of the deterministic player state (`s.downed`: crawl speed, pistol only).
