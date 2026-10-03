# Zombie faces / skin / hair / hands / wounds — round 1 (worker hand-back; honest self-grade, nothing passes)

Files (src/game/zombies/): face.js (per-variant identity + head SDF), head.js (mirrored sphere-trace of a tensor grid, 116x78 at LOD0, eyeball+cornea, lid tube, anatomical ears), mouth.js (32 shaped teeth,
gums, tongue), hair.js (scalp cards, brows, beard, moustache, sideburns, lashes; Kajiya-Kay), hand.js (tendons, knuckles, joints, pads, curved nails), flesh.js (wounds as geometry cut through all layers,
stumps with bone/marrow), skinshade.js (dead-skin model: livor, necrosis, bruises, marbling, veins, pores, wrinkles, stubble, flush, SSS-wrap, eye/teeth/gum/flesh/bone/nail/hair branches).
Edits: shading.js (skin/eye/hair/wound sections, program key v3), parts.js, gear.js. Tools: tools/zgeo.mjs, tools/zface.mjs, tools/devvariants.js. README §12.

| round | change | D | R | cost |
|---|---|---|---|---|
| base | blob head, painted eyes/lips/hair, sausage hands, painted wounds | 45 | 45 | waxy uniform skin |
| 1 | SDF head v2, eye patch, lids | 62 | 58 | streaks at eyes |
| 2 | hair cards, brows, beard, lashes, wrinkles, stubble | 68 | 62 | hair reads as needles/stipple |
| 3 | 32 teeth, gums, tongue, jaw split, hands, nails | 72 | 65 | gums misplaced (fixed) |
| 4 | wound geometry + stumps, caching, LOD1 trims | 74 | 66 | wound annulus visible as a disc |
| 5 | pallor, SSS fill, IBL spec cut, marbling, solid cards, dirtier teeth | 75 | 68 | see remaining |
Final: face/skin D74 R68; hair D62 R55; hands D66 R62; wounds D72 R62.

Measured: tris LOD0/1/2 (shaft look 0) lamp 125k/30k/6.7k … burnt 93k/21k/5.4k (baseline 43–51k/11–14k/3.4–4.5k); head+mouth+eyes+ears ≈27k LOD0. Prepare (Node, whole shaft-nine 7 variants/14 looks) 20.9 s of which
face/wound modules 5.9 s (head 2.3, wounds 2.6, hair 0.5, caps 0.3, hands 0.2); net +3.6 s per map. Swarm 24 zombies 1080p uncapped: zombies ≈3.4 ms GPU (not a controlled A/B). Skin fetches 5 base, worst ≈20.
Gates: smoke ok all four (before last tweaks), gameplay all PASS.

Remaining: toes fused (buildToes disabled); no true SSS/translucency, no tear-film/tarsus; hair = cut-out cards (discard, TAA dependent), paper-strip look at macro, no wet clumping; wound annulus can show as a soft disc,
ribs regular, cheek floor flat red, no LOD2 wounds, wound site fixed per look not per spawn; mouth interior saturated, lips flat; both looks share one face; night skin under helmet brim still dark; skin smooth at 1.6 m (pores sub-pixel, no baked textures);
hands mostly hidden by gloves, no dirty-blood look; stump caps not verified in game.
