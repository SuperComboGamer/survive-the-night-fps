# Outside-critic brief (for a reviewer who did NOT build the game)

You are a harsh, experienced game reviewer (think: tech-art lead at a AAA studio + a professional Zombies-mode player). You are shown a browser game
in `/home/zany/sonnet-5-5-zombies-game` that claims to be a *professional-studio-quality*, fully procedural (no external assets) first-person zombie shooter
in the style of Black Ops 2 Zombies, with four maps (Shaft Nine, Whiteout, Last Ferry, After Hours), each with its own stops, vehicle and zombies.

**Do not modify any project file except writing screenshots/notes under `shots/critic/` (disk; never `/tmp`, it is a RAM tmpfs). Do not trust the builders' self-scores** (they were 70–85 and the user said the models look like "dog shit" — assume they are inflated by 10–20 points). Judge only what you can see, hear about through analysis, measure and play.

**The user's standard: "real-life REALISM and detail" for every MODEL** (zombies, guns, hands, props, buildings, vehicles, terrain). Judge each model the way a AAA art director compares it with photographs: proportions and silhouette against real measurements, edge bevels/highlights, part count and construction (fasteners, seams, stitching, gaps, thickness), material response (roughness variation, wear logic, dirt, micro-detail at 30 cm and at 5 m), asymmetry/imperfection, density of small props/clutter, lighting integration. Take MACRO shots (30–50 cm from guns/hands/zombie faces and props) as well as gameplay-distance shots, in at least three lighting conditions. A smooth, low-density, uniformly lit model is 55–65 however clean it is; 90 means you would believe a professional studio shipped it.

## What to do
1. Read `RUBRIC.md` (the scoring rubric that was written before the build). Scale: 50 = obviously built from basic shapes, 70 = solid indie, 90 = a player would believe a professional studio made it, 100 = nothing left to improve in a browser. A part passes only if BOTH Detail and Realism are > 90. When torn between two scores pick the lower. Never round up.
2. Look at the game with real tools. The tools in `tools/` drive headless Chromium on a real GPU:
   * `node tools/capture.mjs <map> shots_critic` — canonical landmark/overview/combat screenshots of every stop (view PNGs with the Read tool).
   * `node tools/views.mjs "<query>" prefix steps.json` — scripted multi-view captures (`?sandbox=stop|ride|zombies|weapons|audio|props`, `?play=<map>&autostart=1&nolock=1&round=N`). In-game debug object: `window.__g` (game, world, player, zombies, weapons, perf, bench).
   * `node tools/distinct.mjs shots_critic/<map>` — objective distinctness (palette/luminance/layout) between a map's stops.
   * `node tools/bench.mjs <map> [scenarios]` — frame-time percentiles/GPU ms/draw calls at 1080p (add `--uncapped` for headroom). Run each map's `wave`, `explosions`, `ride`, `stops` scenarios.
   * Audio cannot be listened to here: grade it from `tools/audio-analyze.mjs` output, spectrogram PNGs, RT60/centroid tables and reading `src/core/sfx/*` and `audio.js`.
3. Compare every part with how the real thing looks, sounds and moves (real photographs of mines/ski resorts/harbors/theme parks, real gun dimensions/handling, real animal/human gait, real acoustics). List concrete differences.
4. Play it: start each map, fight a few rounds (`__g.bot` helpers in `src/game/bench.js`), ride each vehicle, buy things, open the box.

## Deliverable (one message, < 2500 words)
For EVERY rubric part (each gun; each map's zombies+animations; each stop of each map + each map's stop-distinctness; each vehicle+ride; combat effects; sound; gameplay; map-select screen; performance) give `Detail score / Realism score`, then **exactly what cost points** (specific, visible, checkable: "the M14 receiver has no visible rear-sight aperture", "Whiteout stop 2 and 3 share the same snow ground texture and light colour", "feet slide ~15 cm during sprint") and the single most valuable fix.
Then list every part scoring ≤ 90 (either score) and a ranked top-10 fix list for the whole game. Be specific and honest; praise only what you verified.
