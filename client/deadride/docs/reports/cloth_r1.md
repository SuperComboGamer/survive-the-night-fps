# Zombie clothing & gear — round 1 (worker hand-back; honest self-grade D 79 / R 72, not passing)

Files (src/game/zombies/): cloth.js (PBD drape on ~1 cm quad mesh, body-proxy collision, cached per look), folds.js (ridged creases 5–20 mm by zone; quilted baffles),
stitch.js (rolled hems, welts + topstitch, pockets, zips w/ teeth, buttons, placket, belt loops, knee patches, reflective tape, tears w/ frayed rims, hidden-layer culling),
boots.js (lugged soles, welt, toe cap, laces, buckles, wellingtons), gearkit.js (miner helmet w/ lamp, hard hat, rib beanie, belt+buckle, backpack, pickaxe, ski poles, goggles, respirator).
Surgical edits: parts.js (garment path LOD0/1), gear.js, shading.js (3 cloth lines), mesh.js (PointIndex.nearest shells: 8 s of a 36 s profile), README §4.2/§12.
A/B switch: `globalThis.__ZCLOTH_OFF = true`.

| # | change | D | R | cost |
|---|---|---|---|---|
| 0 | baseline smooth shell tubes, puffer donuts, blob boots, toy helmets | 58 | 55 | no folds/seams/pockets/hem thickness |
| 1 | drape, folds, baffles | 66 | 64 | still nothing constructed |
| 2 | construction geometry | 74 | 68 | +29k tris, ~1 s/look → DDA rays, cached folds |
| 3 | boots + gear kit | 77 | 70 | pointy boots, PointIndex hot spot |
| 4 | tears, culling, goggles/respirator, reflective, boot clamp | 79 | 72 | see list |

Measured: LOD0/1/2 tris old 61–82k/15–19k/4.6–6.2k → now 93–132k/21–31k/5–7k (tourist LOD0 = shells 62k + details 14k + gear 8k + head 45k). Zombie draw tris 343–481k → 557–699k.
Prepare CPU (headless Node, load ≈10): Shaft 15.4→26.4 s, Whiteout 14.6→21.4 s, After Hours 15.5→20.7 s (0.7–1.5 s per variant look). IndexedDB cache/workers not implemented.
Swarm GPU 24 zombies ≈3.3/2.8/3.5 ms (old best 4.2). Foot slip max ≈1.1 cm. Gates: smoke ok (all four maps at last run), validate.mjs 58 looks, gameplay 12/12.

Remaining differences: folds baked in A-pose; bell sleeves (keeper, sailor); weave/twill procedural per pixel (no true normal-mapped weave at 30 cm); inner folds poke through; puffer pillows too uniform;
hood/scarf/neckerchief/sou'wester/mascot parts still simple primitives; gloves/mittens no finger seams/stitching; stitches flat dashes, LOD0 only; no drawstrings/toggles; tears are ragged ovals at fixed sites;
boots no flex creases / pointy toe; wet cloth has no drip geometry; LOD2 smooth shell, LOD1 no details; folds do not react to motion.
