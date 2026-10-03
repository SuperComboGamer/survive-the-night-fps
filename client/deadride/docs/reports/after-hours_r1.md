# AFTER HOURS — map worker report, round 1 (verbatim from the worker; scores are the worker's own self-grade)

Environment and monorail done; zombies.js not started at this point (waiting for the zombie API). No core edits.

## What was built
Everything under `src/maps/after-hours/` plus the viewer `src/sandbox/park.js`.
- Map and stops: `index.js`, `plaza.js`, `space.js`, `castle.js`, `cove.js`, `station.js`.
- Shared kits: `common.js` (neon, bulbs, lofts), `detail.js` (merged ground decals, tombstone engravings, wind grass tufts).
- Route: `route.js`, `rides.js` — ferris wheel, roller-coaster loop with energy-driven cars, carousel, log flume with splashes, fireworks, searchlights, blimp.
- Monorail: `track.js`, `park.js`, `vehicle.js`, `train.js`.

## Monorail
- Track: closed 863.5 m spline, four 215.9 m legs, R_min 73 m, max grade 7.3 %, bank up to 9.5°. Stations dead straight and level.
- Ride plan (analytic): 29.3 s per leg, peak 14.75 m/s, accel/decel 1.10 m/s², jerk limit 0.90 m/s³.
- Lateral force: v²κ peaks at 2.9 m/s², 1.29 m/s² net of banking. Measured in sandbox: peak speed 14.75 m/s, lateral 1.24 m/s².
- Pose/feel: two-bogie chord pose, banking, spring roll/pitch/heave, joint clatter every 12.5 m, pylon events, collector-shoe spark arcs with light pulse. Platform acceleration converted to specific force.
- Train: two 12 m cars, alpha-cut windows/doors, sliding doors, interior, straps with pendulum physics, flickering tubes, cab, PA.
- Full game loop (bot-driven): clear, arrive, board, ride, arrive next stop — no console errors.

## Scorecard (worker's own)
| Iteration | Plaza D/R | Space | Castle | Cove | Monorail+ride | Main losses, then fixes |
|---|---|---|---|---|---|---|
| 1 first build | 62/56 | 58/52 | 55/50 | 55/50 | 66/60 | Lavender exposure wash, arch barely visible, dark rocket, shell winding/UV flips, white windows → exposure/fog retune, train shell rework, neon flicker packed into material values |
| 2 plaza detail | 70/62 | 66/58 | 62/56 | 62/58 | 74/70 | Flat shopfronts, dense star canopy, black terrazzo, black castle foreground → new facades/props, ground fog |
| 3 polish | 76/68 | 72/66 | 68/60 | 70/64 | 78/74 | Empty ground, sand too bright, gunports buried, closed pods/huts → decals, grass, puddles, huts + mausoleum with real openings, skull mouth tunnel |
| 4–5 (final) | 82/72 | 80/70 | 76/68 | 78/72 | 80/77 | see below |

Final honest scores (worker): Plaza D82/R72 (stylised night key, little real shadowing, low-poly facades, no reflections — puddles use a fake sky term); Space-Age Land D80/R70; Haunted Castle D76/R68 (very dark palette, boxy keep, minimal interiors); Pirate Cove D78/R72 (low-detail hull, sand/torch lighting approximate); Monorail + rides D80/R77 (no exterior spray, no wind coupling, plain lawn, sound reviewed by code only). Distinctness gate pass: min pairwise d = 0.37 (landmark), 0.54 (overview), 0.48 (fight); reskin threshold 0.12. **Nothing at 90.**

## Perf (worker, machine shared/loaded — not clean 60 fps proofs)
- Per stop view: 171–588 calls, 150k–245k tris; est. uncontended 4–8 ms/frame; contended median 5–20 ms.
- bench stops,ride: 606/675 calls, 342k/365k tris, GPU avg 13.5/14.1 ms, p50 33 ms (heavily inflated by contention).
- Build time 19.4 s full map under load (plaza 3.7, space 4.1, castle 2.1, cove 6.6, route 5.0, vehicle 2.7). ~101 shader programs. Heap 84–169 MB.

## Integrator notes
Variant ids used by stops: mascot_sun, mascot_rocket, mascot_ghost, mascot_parrot, guest, staff, clown, usher. Perk ids must be lowercase. Monorail.arrive() needs the frame loop running. First-view shader hitches for hidden stops handled by boot.js warm-up (~3.3 s). Audio worker presets override the map's `ambient`.
