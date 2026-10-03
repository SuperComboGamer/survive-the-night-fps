# ZOMBIE SYSTEM — worker report, round 2 (self-grade judged on in-game shots)

Round-2 changes: standard (non-physical) material (clearcoat/sheen removed; distant zombies use a second simpler shader); stronger decay colouring (grey-green necrosis, purple livor, yellow bruise rims, wide veins, greasy vs dry shine); larger eye sockets; dirt gradients at hems/knees/elbows/seat/collar; albedo capped at 0.6; darker palettes with red/blue neckerchiefs and orange hi-vis; cheap edge term (cloth sheen, warm back-scatter on ears/nose/fingers, sky rim); glowing eyes in dark stops; larger drape/compression folds; sewn patches; ragged tears showing skin/flesh; per-variant 'cause of death' wounds (neck bite, open chest with ribs, bandage), 0–2 random extra wounds per spawn, missing headwear per spawn; per-variant faces (foreman heavy jaw + moustache; coal hewer hollow cheeks + torn cheek; drowned bloated lipless one ear; crystal bald heavy brow; burnt noseless earless; lamp miner moustache; gas miner square jaw); walker head lolling/twitch/hunch/limp/drag/hanging arm; lunge lean with both arms forward within 3 m; stronger sprint arm pump; hit reactions always visible (head snap, knee buckle, stagger step, free hand to wound ~1 s); slip 0.18 cm. Footsteps use engine names step.<surface>.<walk|sprint>.<L|R>.

GPU (zombies shown vs hidden, 24 zombies, load avg 9–13): yard 3.38 → 1.64 ms; tunnels 1.16 → 0.90 ms. Tris/frame incl. shadows: 327k avg / 367k max (yard), 270k / 357k (tunnels); calls 45 / 28. CPU 2.29 ms (tunnels), 3.1 ms (yard, load 11–13) — not proven under the 2 ms target.

| It | D | R | note |
| 6 (round 1) | 78 self (≈60 lead in-game estimate) | 74 self (≈58) | clay mannequins in game; identical faces; no gore |
| 7 (round 2) | 74 | 70 | in-game judged |

Grade table (round 2): Body/face 15/20, Variants 15/20, Materials 11/15, Animation set 15/20, Lamp signature 12/15, Damage model 6/10 → D 74. Proportions 12/15, Locomotion 20/25, Hits/ragdoll 16/25, Material response 6/10, AI 10/15, Scale/lighting 6/10 → R 70.
Remaining: geometric torn hems/hanging strips, real mesh holes, scars, hair geometry, visible torn cheek; motion verified only at close range; CPU needs idle-machine measurement; magma stop bloom washes zombies (lead retuned bloomScale).
