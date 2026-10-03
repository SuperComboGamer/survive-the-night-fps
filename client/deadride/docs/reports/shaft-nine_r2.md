# Shaft Nine — round 2 + REALISM pass (worker hand-back, worker's own self-grade)

Built (src/maps/shaft-nine/): rawgeo.js (polygons/sweeps/lathes/plane-clipped rock), parts.js + parts2.js (riveted I-beams, hewn timber, rails w/ fishplates, ore carts, corrugated iron,
relief brick, grating, flanged pipes, drums/crates/pallets/spools/tyres/shovels/barbed wire, twisted wire rope, rock piles, basalt bundles), yard.js (lattice headframe w/ grooved sheaves + rope,
brick engine house, corrugated shed, water tower, chain-link + barbed fence, lamp poles, caged ladders), macro.js (GPU-baked 1024² ground macro), cage (riveted angles, seam straps, knee braces,
12-sided strand rope, depth gauge, capacity plate), route (depth bands, junction boxes, valve wheels, cable trays).
View: `?sandbox=stop&map=shaft-nine&stop=0..4`, `?sandbox=ride&map=shaft-nine&from=0&to=1`, `?sandbox=shaft-parts`, `?sandbox=shaft-mats`, `?play=shaft-nine&autostart=1&nolock=1`.

Audit: ≈58 toy items found → ≈42 rebuilt as real construction, ≈5 improved-but-simple, ≈11 still boxy (yard flatbed truck, fuel tank on stilts, scaffold, weighbridge, tarps, adit portal mound;
tunnel stage/stalls/lamp room; flooded cabin/handrails).

| Iter | Yard | Tunnels | Flooded | Crystal | Magma | Cage+ride | cost / fix |
|---|---|---|---|---|---|---|---|
| R1 final | 80/76 | 82/79 | 80/77 | 78/72 | 76/72 | 78/80 | boxy props, one-material ground, flat rock |
| 5 | 81/77 | 83/80 | 81/78 | 79/73 | 76/72 | 79/80 | draws/programs cut, ground macro bake |
| 6 | 82/78 | 84/81 | 82/78 | 79/74 | 76/72 | 81/81 | headframe, sheaves, ropes, engine house, timber sets, rails, carts, pipes, cage steel |
| 7 | 82/78 | 85/82 | 82/78 | 79/75 | 76/72 | 82/82 | plane-clipped boulders, coal heaps, scree, striated crystals, basalt bundles |
| 8 final | 83/79 | 85/82 | 82/79 | 80/76 | 77/73 | 82/82 | coal read fix, magma glare cut, nav/collider fixes |

Twelve differences vs a real photo still visible: (1) yard ground has no real ruts/potholes/vegetation patches at distance; (2) fuel tank bamboo legs, no seams/ladder/gauge; (3) truck, weighbridge,
tarps are boxes; (4) sky banding + flat cloud blobs; (5) faceted untextured ridges; (6) boulders/coal uniform colour, no lichen/staining; (7) timber has no fungus/rot; (8) tunnel stage/stalls no
switchgear/cable loops; (9) flooded walls no waterline scum; (10) crystal walls not scalloped; (11) lava no flow direction/gas; (12) cage and rope no dents/grease/strand frizz.

Measured (1080p GTX 1070, machine load ≈10, noisy): draws yard 265→98, tunnels 127→99, flooded 193→92, crystal 135→63, magma 131→52; tris 201k→622k (yard) etc.; programs total 32/32/29/29/27
(targets 25/20 NOT met, ≈13 are core ShaderMaterials); whole-map build 14.8 s at load ≈10; smoke: ok, boot 85 s under load.

Open items: (1) every part < 90; (2) sky banding needs dithering in core sky/post; (3) a large tilted brown panel visible at tunnels landing from inside the arrived cage (`rf_d.png`);
(4) flooded GPU min 9.3 ms; (5) build time unverified. Core edits: none this round (round 1: colliders.js yaw sign).
