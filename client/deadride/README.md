# DEAD RIDE — four maps of zombies in three.js

A first-person, Black-Ops-2-Zombies-style shooter. Pick a map, clear each wave, then step into the map's vehicle to ride to the next stop.
Everything you see and hear — models, textures, sounds, effects — is generated in code at load time. The only third-party code is
three.js r186 and its official addons (vendored in `vendor/three`).

## Run
```bash
cd sonnet-5-5-zombies-game
python3 -m http.server 8080        # any static file server works
# open http://localhost:8080/
```
Chromium/Chrome/Edge recommended (WebGL2 + Web Audio). Click **PLAY**, click again to capture the mouse.

## Maps
| Map | Vehicle | Stops | Undead |
|---|---|---|---|
| **Shaft Nine** | Cage elevator | Surface Yard → Timbered Tunnels → Flooded Level → Crystal Cavern → Magma Chamber | Dead miners, some with working helmet lamps |
| **Whiteout** | Gondola | Base Village → Mid-Mountain Station → Summit Observatory | Ski patrol & tourists in frost-caked parkas |
| **Last Ferry** | Ferry | City Pier → Fish-Market Wharf → Island Prison Dock → Lighthouse Rock | Harbor dead climbing up pier ladders |
| **After Hours** | Monorail | Entrance Plaza → Space-Age Land → Haunted Castle → Pirate Cove | Park guests & staff in mascot suits |

## Controls
`WASD` move · `Shift` sprint · `Space` jump · `C` crouch · `Mouse` aim/fire · `RMB` aim down sights · `R` reload · `V` knife · `G` frag grenade ·
`1`/`2`/wheel swap weapon · `F` buy/use (hold to rebuild barricades) · `T` flashlight · **`F3` FPS / frame-time / GPU counter** · `Esc` pause.

## Systems (Black Ops 2 style)
Rounds with BO2 health scaling (150 → +100/round to round 9, then ×1.1) and walker/runner/sprinter mixes · points for hits, kills, headshots, knife kills ·
guns bought off the wall (chalk outlines, half-price ammo) · random weapon box (950, teddy bear relocates it) · five perk machines (Juggernog, Speed Cola,
Double Tap, Quick Revive, Stamin-Up) · Max Ammo / Insta-Kill / Double Points / Nuke drops · barricades zombies tear and you rebuild · endless vehicle loop.

## Performance tooling
* `F3` in game — live FPS, frame-time graph, p99, GPU ms (timer queries), draw calls, triangles. *Settings → Dynamic resolution* (on by default) steps the render scale
  1 → 0.55 within ~0.4 s when frames or the GPU timer exceed budget, and back up after 6 s of headroom — it is what keeps 60 fps on slower GPUs.
* `node tools/bench.mjs shaft-nine wave,explosions,ride,stops,menu [--uncapped] [--dyn] [--sec 20]` — scripted stress scenarios (24 zombies + auto-fire, explosion storm,
  vehicle rides, stop transitions, menu) on a real GPU through headless Chromium at fixed 1080p with dynamic resolution **off** (`--dyn` turns it on). Needs `playwright-core` (see `tools/harness.mjs`).
  **Read the numbers with the caveats in SCORECARD.md**: on the development machine even a trivial full-screen page shows p95 ≈ 11 ms / p99 ≈ 36 ms uncapped, the vsync mode of the
  harness cannot reach 60 Hz at all, and the GPU idles at a low memory clock under light load.
* `node tools/perfprobe.mjs [map]` — wave probe: frame percentiles, CPU sections, per-pass GPU ms, WebGL calls per frame by type, JS profile. `node tools/gpumat.mjs <map> <stop>` —
  GPU cost per material. `node tools/zswarm.mjs` — close-swarm zombie GPU cost. `node tools/audit.mjs <map>` — per-stop calls / triangles / casters / materials.
* Correctness gates: `node tools/smoke.mjs [maps]` (real game, every stop, zombies/fire/explosions, prints every console/GL problem), `node tools/gameplay.mjs` (BO2 rules: buys, perks, box,
  power-ups, barricades, damage), `node tools/zshots.mjs <map> <prefix>` / `tools/capture.mjs` / `tools/distinct.mjs` (screenshots + stop-distinctness metric).

## Repository map
`RUBRIC.md` scoring rubric (written before building) · `SCORECARD.md` every iteration's scores + honest final state · `docs/API.md` engineering contract · `docs/reports/` the workers'
verbatim reports · `src/core` engine (renderer/post/atmosphere, materials, GPU texture synth, builder, world, physics, FX, audio) · `src/game` game logic (director, economy, HUD, menu,
zombies, weapons) · `src/maps/<id>` map content · `tools` test harness · `vendor/three` three.js r186.

## Honest status
Everything is procedural and nothing reaches the "> 90 = a player would believe a professional studio made it" bar; the final scores per part are in `SCORECARD.md`, including what
costs the points. Sound was graded analytically only (nobody could listen). Frame rate was measured on a GTX 1070 through headless Chromium at 1080p on a shared VM, not on your machine.
