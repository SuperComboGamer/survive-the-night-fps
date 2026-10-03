# Common brief for every worker

Project: `/home/zany/sonnet-5-5-zombies-game` — a three.js (r186, vendored) first-person zombie shooter in the style of Black Ops 2 Zombies with four maps
(Shaft Nine, Whiteout, Last Ferry, After Hours), each with its own vehicle, stops, zombies. Everything is generated in code (no external assets).
The goal is a game that a critic would call *professional-studio quality* in look, sound, motion and feel, running ≥ 60 fps on a GTX 1070 @ 1080p.
**Read `docs/API.md` (engineering contract) and `RUBRIC.md` (scoring) completely before you write code.** Then read the code you depend on (`src/core/*`). `src/maps/shaft-nine/surface.js` is the reference stop.

## How you work
1. Plan → build → **look at real screenshots** (Read tool on the PNG) → list every difference from the real thing (how it looks / sounds / moves) → score with RUBRIC.md → say exactly what cost points → fix → repeat. Do at least 4 such iterations for your part; keep going until *your own harsh honest* scores for both Detail and Realism exceed 90 or you cannot improve further within reason (then report the true score and exactly what blocks it).
2. **Grade what you SEE in screenshots / measure in tests, not what you meant to build. Never round up. When torn between two scores pick the lower.** 50 = obviously basic shapes, 70 = solid indie, 90 = a player would believe a professional studio made it, 100 = nothing left to improve in a browser.
3. Compare against your knowledge of the real thing: photographs of real mines/ski resorts/harbors/amusement parks, real gun photos/dimensions, real footage of how such things move and sound. List concrete differences (proportions, materials, lighting, colour, wear, scale, motion).
4. Performance is a hard requirement: ≤ 700 draw calls, ≤ 2.5 M triangles per frame (incl. shadow pass), no per-frame allocation in hot loops, no shader compiles after load. Check `gfx.stats`, `gfx.gpuMsAvg`. "Smarter technique, never less detail": instancing, merging, GPU animation, fog-distance LOD, impostor glows.
5. Iterate with the tools in `tools/` (real GPU). **Use at most one Chromium at a time, close it (the scripts do), use `timeout`, and prefer 1600×900 for iteration shots** — other workers share this machine (6 cores, 11 GB RAM, one GPU). Do not leave servers/browsers running. Never run `npm install` inside the project.
6. Code style: ES modules, no build step, no external libraries except three.js + its addons from `vendor/three/examples/jsm` (more addon files can be copied from the scratchpad `tools/node_modules/three/examples/jsm` into `vendor/three/examples/jsm` if you need them). Match the surrounding code's idiom; comment the non-obvious. Keep files < ~1200 lines each (split).
7. Ownership: only create/edit files in your own area (stated in your task). **Core files (`src/core/*`, `src/main.js`, other areas) belong to others: make only minimal, surgical `Edit`s for real bugs, never rewrite/overwrite them, and list every such edit in your report.** If you need a new core capability, implement it inside your own area if possible.
8. Never fabricate results. If something can't be measured here (e.g. listening to audio), say how you graded it instead.

## Final report (your last message) — keep it under ~1500 words
* What you built (files) and how to view it (sandbox URLs / commands).
* Scorecard per iteration for each rubric part you own: `part | D | R | what cost points | fix`. The last table = final honest scores.
* Remaining known problems + anything you need from the integrator (API changes, bugs found in core, edits you made to core files).
* Measured performance numbers for your content (draw calls, triangles, gpu ms).

## REALISM MANDATE (added after the user's verdict on the build)
The user looked at the game and said: **"the quality of the models is dog shit — I want real-life realism and detail."** They are right: the current models read as smooth game
props (mannequin zombies, toy-like guns and gloves, boxy props). Model FIDELITY is now the top priority of the whole project, above everything except the 60 fps gate.
Every model you touch must survive a professional 3D-artist critique against photographs / the real object. Checklist (every asset must pass):
1. **Proportions and silhouette from real measurements** (write your reference dimensions in a comment; verify them in-engine with a measuring helper, don't eyeball).
2. **No perfect edges.** Every hard edge has a small bevel that catches light (≥ 0.5 mm at 1:1 on metal/plastic, more on wood, cloth hems, rubber); nothing is perfectly straight,
   symmetric or regular: dents, sag, misalignment, uneven wear, asymmetry, per-instance variation.
3. **Real construction, visible as geometry** at the distance it is seen (≤ 1 m for guns/hands, ≤ 8 m for zombies, ≤ 6 m for props/architecture): parts, fasteners, seams, stitching,
   gaps/tolerances, thickness on thin things (sheet metal, cloth, planks, glass), overlaps, hinges, cables, threads, knurling, checkering, serrations, rivets — not painted on.
4. **Material response**: plausible F0/roughness/anisotropy/clearcoat/sheen/SSS, roughness variation, edge wear, dirt in cavities, dust on top faces, streaks below sources,
   oil/sweat/blood sheen; micro-detail at every distance; no flat uniform colours; wear that follows the object's logic (handled parts wear where hands touch, etc.).
5. **Detail density of a AAA game at the same viewing distance**: guns 60–150 k triangles, hands + arms 30–60 k, zombie LOD0 60–120 k (nearest 2–3 only), LOD1 ≈ 25–35 k,
   LOD2 ≈ 5 k, hero props 5–30 k, buildings' visible facades modelled (window frames, mouldings, cornices, downpipes), vegetation with real branch structure.
6. **Every iteration: compare with the real thing and write down ≥ 12 concrete differences a professional artist would call out** (proportions, edges, part count, surface
   detail, material, wear logic, colour, scale, imperfection, lighting integration), fix the biggest, re-render, compare again; ≥ 4 rounds. Render *macro shots* (30–50 cm) as well as
   gameplay-distance shots in real stop lighting (Shaft Nine yard at dusk, a lamp-lit tunnel, a blue night stop). Contact sheets go to `shots/<your area>/` on DISK.
7. Grade honestly with RUBRIC.md — a smooth, low-density, uniformly-lit model is a 55–65 however clean it is. Do not grade what you meant, grade what the screenshot shows.

### Performance facts you must design around (measured on the target GPU)
* **Triangles are cheap** (a wave frame is ≈ 0.65 M of a 2.5 M budget). **GL calls, distinct materials/programs and per-object uniforms are what cost** (the frame is CPU-bound by
  WebGL call count: ≈ 2100 calls per wave frame; each distinct program re-uploads the light block; each draw ≈ 20–40 µs). So: spend triangles freely, but merge geometry into
  existing batches / skinned meshes, reuse materials, use uniform-free per-instance data (attributes, textures), no new draws per detail.
* Skinned characters in a close swarm are the GPU hot spot (fragment shading, overdraw) — keep the per-pixel work of LOD0/LOD1 skin and cloth shaders small (bake detail into
  textures/vertex data instead of evaluating noise per pixel; ≤ ~25 texture fetches per skin pixel).
* Never read GPU results back synchronously. Never allocate per frame. No shader compiles after load (constant light/shadow configuration).
* `/tmp` is a 5.9 GB RAM-backed tmpfs and was 99 % full of worker screenshot dumps (Chromium crashed): write screenshots to `/home/zany/sonnet-5-5-zombies-game/shots/<area>/` (disk),
  delete old ones, keep `/tmp` < 500 MB.
* Gates before hand-back: `node tools/smoke.mjs` (all maps → `ok`), `node tools/gameplay.mjs`. Tools: `tools/views.mjs`, `tools/zshots.mjs`, `tools/gpumat.mjs`, `tools/perfprobe.mjs`,
  `tools/zombie-swarm.mjs`, sandboxes `?sandbox=weapons|zombies|stop|ride|props`. The machine is shared (load 10–20): absolute ms are noisy, use interleaved A/B and percentiles.
* Engine features you can use (docs/API.md §13): planar reflections (`refl` material option), GPU flipbook fire/smoke (`fx.fire/fx.smoke`), amortised shadows, exposure-compensated
  glows, `gfx.vmEnv`, TAA alpha codes (skinned bodies write alpha 0.6, viewmodel 0), detail/parallax layers (if present in §13).
