# WEAPONS — worker report, round 3 (worker's own self-grade)

Gates passed: tools/smoke.mjs shaft-nine ok (0 problems); whiteout ok; last-ferry ok; after-hours failed once (useProgram: program not valid → shader errors → CONTEXT_LOST) but not reproducible (185 programs checked valid; fresh run passed; machine short on resources). bench autoplay 60 s: 0 console errors (avg 28.3 ms under load 6–9, GPU 9.3 ms, 417 calls, 478k tris).
Changes: MP5 stamped receiver/magwell/flat stock struts/drum sight; Olympia rib/action/hammers; Ray Gun crystal in chrome cradle, fins, copper pipes, rivets, dial, louvres; AKS-74U folding skeleton stock from flat bars; baked per-vertex AO + convexity (bakeCavity in rig.js; extra vec2 attribute; convexity only sharpens already-worn edges); dark tactical gloves with woven fabric + leather palm, woodland camo twill sleeves; muzzle flash ring replaced by irregular plume petals per muzzle device (1–2 frames, 1 draw call); reload times retimed (M1911 1.6 s, MP5 2.3, AK 2.4, M14 2.6, 870 0.45 s/shell; hand paths only retimed, not re-keyed); build time: constructor builds hands+props+M1911 only, textures async 2–3/frame, other guns built in the background during load (constructor 1.0–2.2 s in game; all built 6.6–8.3 s). Not done: M1911 frame polish, 870 pump/trigger group/shell carrier, new marking decals, machining marks, inspect animations.

| Gun | D R2→R3 | D breakdown (shape/part detail/materials/hands) | R R2→R3 | R breakdown (recoil-handling/reload/sound/effects) |
| M1911 | 73→76 | 20/17/20/19 | 76→79 | 21/19/19/20 |
| MP5 | 71→77 | 20/19/19/19 | 77→79 | 21/19/19/20 |
| Olympia | 66→72 | 18/17/19/18 | 75→78 | 19/19/19/21 |
| M14 | 76→78 | 21/18/20/19 | 79→81 | 21/20/19/21 |
| AKS-74U | 71→75 | 20/18/19/18 | 78→80 | 21/19/19/21 |
| 870 | 67→69 | 18/15/19/17 | 77→79 | 20/20/19/20 |
| Ray Gun | 72→77 | 20/19/20/18 | 76→77 | 19/19/19/20 |
None ≥ 85. Blockers: M1911 + 870 detail, marking decals, re-keyed reloads + inspect anims, steel/wood separation under warm light, no listening. API: weapons.prebuild(id), weapons.ready promise, weapons.stats().timing; VM reflection strength = global gfx.vmEnv.
