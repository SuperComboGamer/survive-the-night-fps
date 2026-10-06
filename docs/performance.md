# Performance

What a frame costs, how that is measured, what keeps it down, and how a change is shown to look the same as before.
The tools are in `scripts/perf/`; the tables of the last pass are in the pull request that made it (and are made
again by `npm run perf:bench`).

## The budget

60 frames a second on a mid-range laptop GPU with about 80 of the dead on screen (ARCHITECTURE.md). The game caps a
night's horde at 120 alive; the benchmark's hordes of 200 are past anything a run produces, on purpose.

## What a frame's time goes on

Measured on an RTX 3070 at 1920 x 1080, High, before the pass (`perf:profile`, `perf:ablate`):

- **The CPU issuing draw calls, not the GPU drawing triangles.** A frame was the time its JavaScript took plus about
  0.7 ms: 3.4 ms of 4.1 at the island's start with nothing around, 7.0 of 8.5 with a horde of 200. Three quarters of
  that JavaScript was three.js setting up one draw call after another: 762 calls for the empty island (480 of them
  the static world: one mesh for every material of every chunk in sight), 1,370 with the horde (three calls a zombie:
  the view and two shadow cascades, and a bone texture uploaded for each).
- With the calls out of the way the GPU's share shows: on the island the trees and grass (alpha-tested leaves, and
  every tree within 145 m into two shadow cascades every frame) and the shadow maps were half of what was left; in
  the city it is the number of vertices (4.8 M triangles a frame in Main Street, half of them in the shadow maps).

## What keeps it down

- **A material of the static world is one mesh** (`render/multimesh.js`, `StaticWorld`). Every chunk's triangles of
  it are a run of one vertex buffer; each frame the runs whose chunk is near enough and whose bounding sphere is in
  the frustum are drawn in ONE `WEBGL_multi_draw` call (a plain loop of draws where the browser has not got it). The
  shadow casters are the same: one per page of positions and shadow side. The rule for what is drawn is the one a
  mesh a run was drawn by (distance by tier, frustum by sphere): `scripts/test-perf.js` holds the two equal on both
  maps from a hundred eyes. See-through materials (glass, chain link, blood, grime) stay meshes of their own, a chunk
  each, because three sorts those among everything else that is see-through. The terrain and the railway are drawn
  the same way. Vertex data is let go of once it is on the card (the mainland's was 600 MB of typed arrays).
- **The windows of the vehicles are one draw call, and their insides another** (ARCHITECTURE.md, "Glass one sees
  through"). A see-through material that asks for no sorting (`userData.unsorted`: `carglass`) is a `MultiMesh` like
  an opaque one, drawn first among what is see-through: the mainland has some seven hundred vehicles, and a mesh a
  chunk for their glass would be a draw call a chunk in sight. Everything inside every vehicle is one material
  (`cabin`): a shell's lining is drawn as far as the vehicle is (a few dozen triangles), what stands in it only
  from 55 m, and that is out of the shadow maps.
- **The dead are a crowd** (`render/crowd.js`). Every zombie of one body (a type, a variant, the near or far copy) is
  one instanced draw call; the bones of all of them are rows of one float texture uploaded once a frame; their
  objects are out of the scene graph. A zombie keeps its own pose and the crowd asks for the bones of those it
  draws. A zombie outside a crowd (sandbox pages, the picker) is drawn by its own mesh as before. Dogs and survivors
  are not in the crowd (few of them, and a survivor has things in its hands).
- **Vegetation outside the view is not in the buffers** (`render/foliage.js` `ViewCull`): the instance buffers are
  filled for the camera's frustum widened by 14 degrees, and filled again when it has turned 8.4 or moved 2.5 m.
  What casts into the shadow maps is a second set of meshes (the ones near the eye, wherever it looks). Trees are
  written nearest first, and the terrain is drawn after everything else that is opaque: what is hidden is not shaded.
- **Ceilings on rates** (`render/rates.js`), each above the frame rates people play at, so that below it nothing
  changes at all:
  - a zombie further off than 15 m (where its far copy is drawn) is posed at most 80 times a second; where it stands
    and faces is every frame's;
  - the shadow maps are drawn at most 160 times a second, and always in a frame the camera has jumped or swung in.
- **What a blow leaves costs a fixed handful of draw calls, and nothing at rest** (ARCHITECTURE.md, "Blows on
  the world"). Every mark in the world - slashes, dents, bullet holes - is a quad of one mesh (`render/marks.js`: a
  ring of 400 that the newest overwrite, so a magazine into a wall costs what one round does), every flying bit an
  instance of another (`render/strikefx.js`), and neither is drawn while it is empty. A prop that has to change - a
  wreck being taken apart, a barrel rocking - is lifted out of the static world's runs (`MultiMesh.cut`) into the
  `LiftBatch` (`render/liftbatch.js`): one mesh per material for every lifted prop there is, culled prop by prop,
  written only when a shape changes. A wreck nobody has hit is still in the static world and costs what it always
  did; a hit one is built when the eye is within 170 m; a light prop goes back the moment it settles.
- **Nothing is drawn past the drawing distance** (`Game.viewDist`: the haze's reach plus 40 m, the rule the static
  world always had): the handcars, and the fair while its generator is off.

The rules these follow:

1. A draw call costs about as much as a thousand triangles. Many things of one material or one body are one call.
2. Nothing new may be drawn for the first time during play (`Game.prewarm`): whatever a scene will need has an object
   in the scene before play, hidden or empty (the crowd's batches are made in `warmViews`).
3. What is culled must be shown to be exactly what was out of sight: write the rule down and test it against the
   plain one (`test-perf.js`).
4. A rate ceiling is set where nobody plays below it, says so in its name, and is tested at 60 and 144.

## Measuring

Every browser is `scripts/clip/lib.js`'s `launchChrome` (docs/object-clipping.md, "The headless browser's rules").

| Tool | What it does |
| --- | --- |
| `npm run perf:bench` | The frame-rate benchmark: 14 fixed scenes, each build against its own server (seed 1337), headless Chrome on the real GPU at 1920 x 1080, High, **vsync and the frame limit off** (the launcher's `perf: true`: 6 minutes a browser at the most). `--before <ref or dir>` (default: the tag `perf-baseline`), 3 rounds alternating before / after, medians; JSON per session in `shots/perf/`, the tables in the owner's format on stdout (`perf:report` prints them again, `--write` saves them). `--capped`: vsync on, for draw calls, triangles and JavaScript time while working. A session in which the machine was busy (a fixed piece of arithmetic timed in the page) is taken again. |
| `npm run perf:visual` | The same 55 pictures from two builds, compared: the benchmark's spots, every kind of the dead at 3, 10 and 30 m, the specials either side of the distance their far copy takes over at, survivors, hordes, rooms, four frames of the crossing. Everything is pinned (seed, hour, weather, wind, `Math.random`, the game's clock stepped by hand; the dead and the survivors in a picture are put there by the script). Writes before / after / difference sheets and `VISUAL.md` to `docs/pr-images/perf/`. `--before same`: one build twice, the noise a real difference has to exceed. |
| `npm run perf:server` | Node only: a tick with a night-4 horde for 4 and 8 players on both maps (mean, p99, worst), snapshot bytes per player per second, world generation, and a fingerprint of the simulation tick by tick, before and after. |
| `npm run perf:profile` | One scene, capped: Chrome's CPU profile (self time; `perf/inclusive.js` for inclusive), the frame's draw calls by what draws them, and the scene with one thing taken away at a time. `perf/profile-load.js`: the same for the load, the picker and the world swap. |
| `node scripts/perf/ablate.js` | One scene, uncapped, with one thing taken away at a time: what each costs the GPU. |
| `node scripts/perf/world-hash.js` | A fingerprint of every generated world over a list of seeds, against another tree's. |
| `node scripts/test-perf.js` | In `npm test`: the culling, the buffers, the crowd, the far copy's switch, the rates. |

The scenes (`scripts/perf/lib.js` `SPOT`, `bench.js`): the island's start with nothing around, with 7 survivors in
view, with 40 specials and walkers, with a horde of 200 by day, at night under the flashlight, with five bosses,
and that with the CPU slowed 4x; the crossing's cutscene; Main Street, the city from a roof, a shop from inside, a
horde of 200 in the street at night (and with the CPU slowed 4x), the runway stand. The dead are called up with the
admin `/spawn` round a second player who stands ahead of the camera, so they gather in view; the number in view is
in the table.

The machine is somebody's. An uncapped browser makes it sluggish: the benchmark draws at 60 frames a second except
while a scene is being timed (6 s), and its whole run is about 25 minutes of browsers for 3 rounds of two builds.
Work with `--capped`, `perf:profile` and `perf:visual`; keep uncapped runs for a baseline, a checkpoint and the table.

## "Nothing looks worse"

A change to how something is drawn is shown by `perf:visual` against the build before it: a picture whose mean
difference is over 0.6 of 255 is looked at. Two runs of one build differ by 0.00 to 0.2 (the grain, a particle),
except the two island frames of the crossing, whose running dead are a stride apart from run to run (1 to 5). What a
picture cannot show - a rate ceiling, a cull at an odd angle, a hitch - is said in the pull request under what needs
a human to play.

## Tried and dropped, and what is left

- **Smaller vertices and index buffers for the static world** ("compress the models"). Measured first: after the
  draw calls were merged the island is not bound by vertices at all, and the city's box-and-quad soup would index to
  about two thirds of its vertices (a box is 24 of 36) and shrink by a quarter with 16-bit normals and colours;
  8-bit colours band in the dark (vertex colours are linear). A fifth off the city's static cost for a rewrite of
  how the kit and every prop hand their triangles over: not done. The vertex data's copy in memory is gone, which
  was the larger part of what it cost.
- **Lights switched off while unused.** The scene keeps twelve spot and point lights at all times so that nothing
  recompiles; each costs uniforms on every program change and arithmetic in every pixel. Hiding the unlit ones by
  day would need every material's second program built beforehand and a hitch-free switch on the first muzzle
  flash: not attempted.
- **Occlusion in the city.** In a street the buildings hide most of the city behind them, and it is all still drawn
  (Main Street: 2.6 M triangles in the view). It needs runs per building rather than per chunk and occluders that
  are provably opaque (a storey cut open is not): the largest thing left on the mainland.
- **A cascade's casters by distance.** The near cascade draws every caster tree within 145 m; only those within its
  box matter. About a third of the tree shadow vertices.
- **A third, lighter copy of the dead past 40 m.** The far copy (from 15 m) is 2,200 to 3,400 triangles.
- **The world swap** (the crossing: 4 s with nothing drawn, behind the cutscene's loading card) and **the load**: world
  generation (1.2 s for the mainland), the static world's build (1.6 s), the terrain (0.7 s). They want slicing over
  frames or a worker; a worker cannot hand a world over (it is closures). Not done.
- **The server.** A tick with a night-4 horde is 0.6 ms for 4 players and 1.2 ms for 8 on either map, of the 50 ms
  it has; worst 6 ms. Left alone: there was nothing to win that was worth a change to the simulation.
