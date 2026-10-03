# ZOMBIE SYSTEM — worker report, round 1 (worker's own self-grade; lead's in-game assessment is lower, see SCORECARD.md)

Zombie system finished and running in the real game. Shaft Nine set self-graded **D 78 / R 74** (does not pass >90). Zombie CPU ≈ 1.8–2.3 ms/frame for 24 zombies (budget 2 ms; measured under load 6–7).

Files: `src/game/zombies/` — index.js (ZombieManager, API.md §6, triangle-budget LOD, draw stats), factory.js, parts.js (Outfit API), gear.js, body.js, head.js, mesh.js, shading.js, skin.js, rig.js (54 bones), anim.js, ai.js, ragdoll.js, spawnanim.js, signature.js; variants/shaft-nine.js (7 variants), examples.js, debug.js, index.js (registerAll); README.md (full Outfit API + 6 worked examples); sandbox src/sandbox/zombies.js; tools zombie-shots.mjs, zombie-metrics.mjs.

Iteration table (worker; iterations 1–5 re-graded from notes after a context reset):
| It | D | R | What cost points | Fix |
| 1 | ~55 | ~50 | Subdivision shrank body, crotch fold, stump caps visible, sampler conflict, stance slip 1.2 cm | Cage fitting, absolute leg stations, caps masked, bound uNoise3 |
| 2 | ~62 | ~60 | Face tearing/muzzle look, 0.7 cm slip, slow build | Head rework + jaw weights, toe-joint pivot (slip 0.00 cm studio), build caches |
| 3 | ~66 | ~64 | Crowd dragged feet up to 219 cm, AI stuck on walls | Recovery steps, clamped landing, reach/cadence limits (0.19 cm), walls walk:false |
| 4 | ~72 | ~70 | No spawn anims; lamp beams too bright at dusk | Barricade/ladder/rise scripts, beams scaled by ambient, ragdoll jitter |
| 5 | ~74 | ~72 | Bulky clothing layers, plain garments | Per-vertex layer offsets, example variants |
| 6 | 78 | 74 | Inside-out hats, gaping necklines, plain garments, coarse weave, frost whitewash, stale skin after pool reuse, 633k tris/frame, sprinter slip at 25 fps, explosions throwing bodies 12 m, stretched limbs, lamp beam white wall | winding fix, collars/V-necks, plackets/pockets/seams/knee patches, thread-scale weave, ragged rips, shared wrinkle field, triangle budget (≤385k), sub-stepping, tamed blast, rigid severed limbs, beam fade |

Final grade table: Body mesh 14/20, Variants 15/20, Materials 12/15, Animation set 16/20, Lamp signature 13/15, Damage model 8/10 → Detail 78. Proportions 12/15, Locomotion 21/25, Hits+ragdoll 17/25, Material response 7/10, AI 11/15, Scale/lighting 6/10 → Realism 74.

Measured (sandbox 1600×900, 24 zombies, load avg 6.7–7.1): surface CPU 1.79 ms, 374k tris avg (430k max), 60 calls, 24 ms frame, zombie GPU 3.4 ms, foot slip max 0.181 cm; tunnels CPU 2.32 ms, 279k tris, 39 calls, zombie GPU 1.2 ms. LOD tris per variant: 43–51k / 11.5–14k / 3.4–4.5k.

Remaining problems (worker): map defs' plain id strings ignored; TAA ghosting on fast limbs (fixed by lead: alpha 0.6 marker + short history); nav cost inside zombie CPU timing; coarsest LOD near the camera in full crowds; faces, hair and weak sprint arm swing are the biggest gaps. Other maps: example sets only (about D 50 / R 70, one variant each).
