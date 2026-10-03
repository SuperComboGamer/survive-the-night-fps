# WEAPONS — worker report, round 2 (verbatim summary; scores are the worker's own self-grade)

Changes: view-model light rig (pooled lights closer than 1.3 m moved out to 1.3 m during the VM pass; spots ×0.45) fixing flashlight blow-out; steel/walnut/paint materials reworked (metal 1, dark base ≈7 % F0, rough 0.34–0.54; walnut oil finish 0.66–0.86; parkerized pattern); real 2 mm peep sight on M14 with focus-fade of the leaf while aiming; new `polyLoft` tool; M14 rebuilt (receiver ring, op-rod rail, stripper-clip bridge, ears, peep leaf, walnut C-section handguard with vents, gas cylinder, flash suppressor, bolt lugs, etc.); M1911 rounded slide + port notch; AKS-74U stamped receiver/dust cover/trunnion; 870 receiver; hands with creases/pads/back-of-hand panel/sleeve folds; MP5 HK slap re-posed; recoil retuned from spring maths; per-gun body resonance + action clacks timed to animation; Ray Gun splash scheduled with fx.schedule(distance/220), own plasma burst, damage via combat.zombies.explode. Not reworked this round: MP5, Olympia, Ray Gun geometry.

| Iteration | What was wrong | Fix |
|---|---|---|
| R2-1 | Lilac flat receiver; flashlight blow-out | light rig, PBR steel/wood, reduced sky lighting, dusk/tunnel presets |
| R2-2 | Blocky M14/M1911/AK/870; peep sights filling view; zebra grain; big swirl engraving | real cross-sections; peep fade; grain/engraving retune |
| R2-3 | Sausage fingers, plain sleeves; M14 vm rotation too big; clacks off-sync | creases, pads, folds; spring retune; resonance + timed clacks; Ray Gun splash timing |
| R2-4 | In-game MP5 glare, flashlight glints, slap arm through view | gloss down, spot ×0.45, slap poses |

| Gun | Detail | Realism | What still costs points |
|---|---|---|---|
| M1911 | 73 | 76 | frame/grip flat extrusions; simplified hands |
| MP5 | 71 | 77 | receiver not reworked |
| Olympia | 66 | 75 | chunky stock; loading hand close to camera |
| M14 | 76 | 79 | no fine machining / baked detail; hands |
| AK-74u | 71 | 78 | flat receiver sides; stock bars are round tubes |
| Remington 870 | 67 | 77 | pump/trigger group plain |
| Ray Gun | 72 | 76 | chrome only reads where env has something to reflect |

Measured (real game 1080p, machine shared): view-model 10–12 calls, 27–37.5k tris/gun; whole frame 262–343 calls, 222–263k tris; GPU 4–11 ms noisy; weapon system build 4.7–10 s in-game under load (2.7 s in round 1). Audio graded from spectra/code only (cannot listen). One unreproduced "WebGL: too many errors / black scene after wave cleared" during a heavily contended session.
