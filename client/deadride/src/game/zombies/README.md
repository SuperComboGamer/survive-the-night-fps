# Zombies — system guide and Outfit API

Everything here is procedural: bodies, heads, clothes, gear and materials are generated in code at load time from a
*variant definition*. Map workers build their own zombie sets **only** by writing variant definitions with the Outfit API
described below — no changes to the zombie system are needed.

```
src/game/zombies/
  index.js        ZombieManager (API.md §6): spawn / update / raycast / damage / explode / callbacks
  factory.js      registerVariants(), variant registry, geometry build + cache (looks × 3 LODs per variant)
  parts.js        Outfit class: body + garment recorder, low-level primitives (o.parts.*), garment presets (GARMENTS)
  gear.js         high-level gear helpers on the Outfit (helmets, lamps, hats, respirators, tools, crystals, seaweed …)
  body.js         Catmull-Clark body cage (continuous skin, fingers), face tags garments select from
  face.js         face identity (faceParams) + head signed-distance sculpt (brow, orbits, lids, nose, lips, folds, jaw, chin)
  head.js         tensor-grid head sampler (mirrored sphere trace, dense over eyes / nose / mouth), eyes, ears, skin weights + jaw skinning
  mouth.js        lip pouch, 32 shaped teeth, gums, tongue; gridMesh() smooth-normal emitter; build cache (variant-level head/hair replay)
  hair.js         hair as geometry: scalp cards (shader cuts sub-strands), brows, beard, moustache, sideburns, eyelashes
  hand.js         hand / finger relief (tendons, knuckles, pads), nails, bare feet with toes
  flesh.js        wounds as geometry (bite / gash / open chest with ribs / cheek / bullet) + dismemberment stumps
  skinshade.js    GLSL for skin, eyes, teeth, mouth, flesh, bone, nails, hair (+ the SSS / Kajiya-Kay light-loop patch)
  mesh.js         GeoBuf / Cage / Catmull-Clark subdivision, material + pattern ids, dismemberment regions, finalize()
  shading.js      the zombie material (MeshPhysicalMaterial + onBeforeCompile): skin, cloth, leather … layers, wounds
  skin.js         ZombieBody: one SkinnedMesh per zombie, world-space skinning, LOD draw ranges
  rig.js          54-bone skeleton (fingers, jaw), Pose (FK / world matrices), two-bone IK
  anim.js         procedural locomotion (planted feet, IK), attacks, hit reactions, crawl, scripted poses
  ai.js           flow-field pursuit, line-of-sight chase, separation, surround slots, stuck recovery, attack decisions
  ragdoll.js      Verlet ragdoll (hinge limits, ground + wall collision), impulses at the hit point, blasts
  spawnanim.js    spawn scripts: rise from the ground, tear a barricade + climb through, swim + climb a ladder
  signature.js    helmet lamps (beam + halo + pooled spot lights), frost breath, water drips, embers, balloons
  variants/shaft-nine.js   the 7 Shaft Nine miners (reference set)
  variants/examples.js     one example each for Whiteout, Last Ferry and After Hours (templates for map workers)
  variants/index.js        registerAll(): built-in sets for boot.js (examples fill maps that have no set of their own)
```

## 1. Quick start for a map worker

1. Create `src/maps/<map-id>/zombies.js`:

```js
import { registerVariants } from '../../game/zombies/factory.js';
import '../../game/zombies/gear.js';          // installs the gear helpers (o.minerHelmet, o.beanie, …) on the Outfit

export const MY_VARIANTS = [ /* variantDef, variantDef, … (≥ 5 clearly different ones) */ ];
registerVariants('<map-id>', MY_VARIANTS, { aliases: { oldName: 'new_id' } });
```

2. Make the game see it — any one of: import the module from your map module (`src/maps/<map-id>/index.js`:
   `import './zombies.js';`), or put the definitions in the map definition (`zombies: { variants: MY_VARIANTS }` — boot.js calls
   `zombies.registerVariants(mapId, def.zombies.variants)`; plain id strings there are ignored), or give it
   `zombies: { register: (zm) => zm.registerVariants('<map-id>', MY_VARIANTS) }`. boot.js then calls
   `variants/index.js registerAll()` (built-in sets; a map with no variants of its own gets its example variant) and
   `zombies.prepare(mapId)` (builds all geometry + compiles shaders). Stop `zombieVariants` / spawn `variant` ids must match your
   ids; an unknown id falls back to an alias, then to a random variant of the current map.
3. Preview in the sandbox (the sandbox imports `src/maps/<map-id>/zombies.js` automatically when `map=` is given):

```
index.html?sandbox=zombies&scene=studio&map=<map-id>&variant=<id>&n=1     studio turntable (window.__t API, §11)
index.html?sandbox=zombies&map=<map-id>&stop=0&n=6                         your real stop: nav, colliders, fog, lighting
node tools/zombie-shots.mjs --map <map-id> --out /tmp/zs                   lineups + front/side/back/head/hands sheets
node tools/zombie-metrics.mjs --map <map-id> --stop 0                      24-zombie stress: slip, CPU/GPU ms, draw calls
```

## 2. Conventions

* **Rest model space**: metres, a canonical 1.75 m adult standing at the origin in an A-pose, **facing −Z**, **+X is the
  character's right**, +Y up. Every position you pass to the Outfit API is in this space. At spawn the body is scaled to the
  variant's height and proportions, so never scale gear yourself.
* Useful landmarks (import from `rig.js` / `parts.js`): `HEAD_CENTER = (0, 1.662, 0.004)` (cranium centre; top of skull ≈ +0.11,
  forehead ≈ z −0.1), neck base y 1.49, clavicle notch y 1.43, shoulder joint (±0.178, 1.405, 0.014), chest bone 1.29–1.485,
  waist ≈ 1.0, hip joints (±0.09, 0.925), knees y 0.5, ankles y 0.077, ball of foot z −0.118, heel z +0.085.
  `restAt(bone, t)` (0 = joint, 1 = tail), `restPos(bone)`, `restTail(bone)` give bone points; `RIG.arm.R` has the hand frame
  (`wr` wrist, `h` along the hand, `p` palm normal, `t` thumb side) used for held tools.
* **Bones** (54): `root pelvis spine1 spine2 chest neck head jaw`, per side (`.L` / `.R`): `clavicle upperarm forearm hand`,
  `index1-3 middle1-3 ring1-3 pinky1-3 thumb1-3`, `thigh calf foot toe`.
* **Binding**: every primitive takes `bone:'name'` (rigid), `weights:{bone:w, …}` (blend), or `bind:'auto'` (copy the skin weights
  of the nearest already-built surface — use it for things lying on clothes/body so they deform with them).
* **Build order**: `o.body()` and `o.garment()` only *record*. Everything under `o.parts.*` and every gear helper is deferred and
  runs **after** body + garments + head are built, in call order, so accessories can `snap` onto the finished clothed surface and
  later gear can hug earlier gear (goggles over a helmet, straps over a pack).
* **Determinism**: `build(o, rng, look)` runs once per LOD with an identically seeded `rng`; use only `rng()` (never
  `Math.random`) so the three LODs of a look match. `look` is 0…looks−1 — use it for per-look colour / gear swaps.

## 3. variantDef reference

```js
{
  id: 'ski_patrol', name: 'Ski Patrol',         // id is what spawns reference; ids are global, prefix them by map theme
  looks: 2,                                      // distinct geometry builds (each 3 LODs); 2 is the sweet spot (memory / build time)
  height: [1.64, 1.9],                           // metres, random per spawn
  hp: 1.0,                                       // multiplier on the round health (150 at round 1, +100/round to 9, ×1.1 after)
  body: { gaunt: 0.4, girthRange: [0.95, 1.1] }, // per-spawn girth range; gaunt 0..1 drives rib relief in the shader
  skin: { tint: [0.95, 0.97, 1.0], variation: 0.12 },
  layers: { wet: 0, frost: 0, dust: 0, blood: 0.4, burn: 0, crystal: 0 },   // per-zombie material layers (0..1), see §6
  eyes: { glow: 0, color: 0xffa040, cataract: 0.7 },                        // glow > 0 = emissive eyes (HDR, 3..6 reads well)
  hair: { color: 0x1a1512, amount: 0.8, hairline: 0.3, beard: 0.5, brows: 1, bald: 0 },  // painted scalp hair / stubble
  speedClasses: { walk: 1, run: 1, sprint: 1 },  // weights on the round's speed mix (0 = never)
  voice: { f0: 95, formants: [600, 1100, 2500], rasp: 0.5, wet: 0.3, muffle: 0, kind: 'male' },  // passed to audio.zombieVoice
  idiosyncrasy: { limpChance: 0.25, limp: [0.35, 0.75], dragChance: 0.15, hunch: [0.05, 0.35], tilt: 0.35, armHangChance: 0.12,
                  kypho: [0, 1], headFwd: [0, 1], twitchChance: 0.35 },  // posture: rounded upper back, forward head (+ random dropped
                                                  // shoulder, splayed knees, toe-in/out per spawn)
  arms: { reach: 0.55 },                         // probability each arm reaches forward instead of swinging

  // signature / combat extras (all optional)
  lamp: { color: 0xffe2b6, intensity: 32, range: 18 },  // working cap lamp — requires o.capLamp()/o.minerHelmet() in build
  emissiveColor: 0xffe2b6,                        // tint for 'emissive' parts and crystal veins
  helmetY: 1.69, helmetSurface: 'plastic',        // head hits above this rest height report out.surface = helmetSurface
  hitHeadR: 0.27, hitHeadDY: 0.05,                // enlarge the head hit sphere (oversized mascot heads)
  wet: true,                                      // permanent wetness: drips from chin/fingers/hems, wet footprints
  breath: true,                                   // frosty breath puffs
  embers: true,                                   // rising sparks (magma-burnt)
  balloon: { hand: 'L', color: 0xd82828, length: 1.1, r: 0.17 },   // helium balloon on a Verlet string (shootable)

  // per-spawn variety + "cause of death" story (round 2 additions; all optional)
  facial: { moustache: 0.3, sideburns: 0.25, age: [0.2, 0.9], cheekWound: 0.12 },  // chances / ranges: painted moustache,
                                                  // sideburns, forehead + crow's-feet lines, torn cheek with exposed teeth
  wounds: [{ type: 'bite', at: 'neck', r: 0.045, chance: 0.85, side: 1 },       // types: 'bite' | 'gash' | 'open' (flesh +
           { type: 'open', at: 'chest', r: 0.07 },                                //  exposed ribs) | 'bandage'; at: neck, shoulder,
           { type: 'bandage', p: [0.47, 1.07, -0.1], r: 0.05 }],                  //  forearm, chest, belly, thigh, calf, back, scalp,
  extraWounds: 1,                                 // cheek (mirrored to a random side unless side is given) or p: rest [x,y,z]
  gearDrop: { hat: 0.25 },                        // chance a spawn has lost its headwear (helmet lamp then off too)
  jawOpen: [0.1, 0.3],                            // slack-jaw range (teeth read at 3-5 m)
  // eyes.darkGlow (default 3): extra eye glow in dark stops, scaled by the stop's darkness

  build(o, rng, look) { /* §4 */ },
}
```

Unknown ids passed to `spawn` fall back to an alias, then to a random variant of the current map (`prepare(mapId)`), then to a
variant sharing the id prefix, then to the first registered one.

## 4. build(o, rng, look) — the Outfit

### 4.1 Body

```js
o.body({ skin: 0x6d7064, girth: 0.97, belly: 0.2, muscle: 0.45, gaunt: 0.55, nails: 0x6a6450,
         decay: 0.5, dirt: 0.4,                                    // skin wear (rot patches) and grime
         fat: 0..1, sex: 0 (male) … 1 (female proportions), age: 0..1,  // build: WHERE mass sits (belly, flanks, chest, nape,
                                                                   // thighs / hips, waist, shoulders) — not a uniform scale
         face: { gaunt: 0.8, bloat: 0, lipsGone: 0 } });           // head shape overrides (else random per look):
// face keys: brow, nose, noseW, jaw, chin, cheek, gaunt, lip, cranium, forehead, bloat, earSize, lipsGone, teethMissing, teethLen
```

The LOD0/1 skin is sculpted automatically from `muscle` / `gaunt` / `fat` / `sex` (body.js `sculptSkin`, real displacement, not
a normal map): clavicles, sternal notch, sternocleidomastoids, larynx, pecs + lower pec fold, nipples / areolae (breast mass with
`sex`), navel (deeper with `fat`), deltoids, biceps / triceps, elbow + wrist bones, scapulae, erector columns + spinal furrow,
costal margin + iliac crest (gaunt), rectus abdominis (lean), quads, patella, tibia crest, calves, malleoli. `muscle` raises
the masses, `gaunt` raises the bones, `fat` softens both. Posture comes from `idiosyncrasy` (kypho, headFwd, shDrop, kneeSplay, toeOut).

### 4.2 Garments

`o.garment(kind, opts)` makes a real offset shell of the subdivided body (continuous with seams/hems, layered correctly over
anything already worn — sort order is by offset or `opts.layer`). Covered skin is removed from the mesh. Presets:

| kind | covers | defaults |
|---|---|---|
| `shirt` | torso + sleeves, open V at the throat | weave, fold collar, V-neck, placket + buttons, chest pockets, seams (detail 7) |
| `tshirt` | torso, short sleeves, crew neck | knit, seams |
| `singlet` | torso, no sleeves | knit |
| `jacket` | torso from the hips + sleeves | canvas, fold collar, deep V, placket, pockets, seams |
| `coveralls` | one piece: torso, sleeves, legs | canvas, fold collar, V, placket, pockets, seams, trouser details (detail 15) |
| `overalls` | bib + legs (use `o.bibStraps()`) | denim, trouser details |
| `vest` | waistcoat: torso + shoulder tops, V front | weave, buttons |
| `pants`, `shorts` | waist + legs | denim / weave, waistband, fly, belt loops, back pockets, outseams (detail 8) |
| `gloves`, `mittens` | hands (+ cuff) | leather / knit |
| `boots`, `wellies` | feet + shin (with a real sole slab) | leather / rubber |
| `socks`, `hood` | feet / neck | knit / cloth |

Garment options (all optional):

| option | meaning |
|---|---|
| `color`, `mat`, `pattern`, `rough`, `wear`, `dirt` | material (§6); `wear` also rips the cloth (dark ragged tears), `dirt` adds grime low down and in creases |
| `offset`, `loose` | shell distance from the body (m) and its random bagginess; `puff:{period, depth, bulge}` makes quilted baffles |
| `sleeve` | forearm segment where sleeves end (4 = rolled up at the elbow … 6 = wrist) · `hem` (pants: shin seg 4–8) · `height` (boots: shin seg where the shaft starts, smaller = taller) |
| `collar` | `'fold'` (shirt collar with points), `'stand'` (parka / work stand collar) or `false`; `collarHeight`, `collarGap` |
| `vneck` | depth (m) of the throat V, or `{ring, depth, pull}`; `0` = square opening |
| `detail` | construction flags painted in rest space: `1` placket + buttons, `2` chest pockets with flaps, `4` side/shoulder seams, `8` trouser details (waistband, fly, belt loops, back pockets, outseams), `16` knee patches, `32` (with `1`) zip instead of buttons |
| `layer`, `opaque:false`, `hemThick`, `wrinkle`, `frost` | force a layer order · keep skin under it · hem roll thickness · wrinkle strength · frost exposure 0..1 |
| `soleMat`, `soleColor` | boots only |
| `fit` | `'tight'` \| `'normal'` \| `'loose'` — drape model (default from `offset + loose`; presets: coveralls / overalls / wellies loose, singlet / gloves / boots / socks tight) |
| `stiff`, `weight` | fabric bending stiffness 0..1 and weight multiplier (default from the `pattern`: denim / canvas / oilskin / quilt stiff and heavy, knit / fleece soft); wet cloth (`layers.wet`, `wet: true`) is heavier, clings more and folds softer |
| `flare`, `blouse`, `ease`, `sag`, `stack`, `cuff`, `cuffBunch` | drape shape (metres unless noted): hem flare, blousing over the belt, sleeve / leg ease, sag factor, trouser stacking on the boots 0..1, `cuff:'elastic'` gathers the sleeve at the wrist, wrist bunching 0..1 |
| `foldAmp`, `sim`, `simSteps`, `cloth:false` | fold amplitude multiplier, switch the relaxation off, relaxation steps, force the old smooth shell |
| `tears:false`, `wear` | `wear ≥ 0.3` cuts ragged holes with thick frayed rims (knees, elbows, shoulder, seat, belly), the skin stays visible underneath |
| `seams:false`, `hipPockets:false`, `thread`, `zipColor`, `tapeColor`, `buttonColor`, `laces:false`, `laceColor`, `weltColor` | construction details (LOD0): seam welts + topstitch, jacket hip pockets, thread / zip / button colours, boot laces and welt |
| `reflective`, `epaulettes` | retro-reflective bands + shoulder stripes (default on for `pattern:'hivis'`), shoulder epaulettes with a button (default on for canvas / weave / denim / oilskin jackets) |

**Custom garments** take a face selector over the body cage tags instead of a preset name:

```js
// leather apron: front of the torso from the chest down + the upper thighs (limb tags have no zone: whole rings)
o.garment({ sel: (t) => (t.part === 'torso' && t.seg <= 6 && t.zone === 'front') || (t.part === 'thigh' && t.seg <= 2),
            offset: 0.016, loose: 0.004, mat: { mat: 'leather' } }, { color: 0x3a2618, wear: 0.6, dirt: 0.7 });
```

Face tags: torso `{part:'torso'|'neck', seg 0..8 (R0 crotch line … R8 shoulder tops), zone:'front'|'side'|'back', col 0..11}`
(col k spans 30k…30k+30° from the front midline, turning toward the character's left; the two faces flanking the midline are
cols 11 and 0), legs `{part:'thigh' seg 0..3 | 'shin' seg 4..7 | 'foot', side}`, arms `{part:'upperarm' 0..3 | 'forearm'
4..7 | 'hand' | 'finger' | 'thumb', side}`.

### 4.3 Gear helpers (gear.js)

| helper | options |
|---|---|
| `o.minerHelmet(opts)` | `{color, mat:'paint'\|'plastic'\|'metal', wear, dirt, ridge, brim, peak, lamp:{…}\|false}` — 1950s fibre helmet with comb, brim, lamp bracket; adds a cap lamp unless `lamp:false` |
| `o.capLamp(opts)` | `{housing, lensColor, emissive (0..16), cable, battery}` — lamp housing + lens + cable down the back + belt battery; records `o.info.lamp` for the runtime beam |
| `o.hardHat(opts)` | `{color, wear, dirt, cracked}` full-brim ribbed hard hat |
| `o.beanie(opts)` | `{color, fold:true, pompom:color}` |
| `o.souwester(opts)` | `{color}` oilskin rain hat, long at the back |
| `o.hood(opts)` | `{color, pattern, up:false, fur:color}` hood down (collar roll) or up (face opening with fur trim) |
| `o.goggles(opts)` | `{on:'forehead'\|'eyes'\|'helmet', lens, frame, strap}` |
| `o.respirator(opts)` | `{color, canisters:1\|2, filterColor}` |
| `o.belt(opts)` | `{y, color, height, buckle}` |
| `o.braces()`, `o.bibStraps()`, `o.kneePads()`, `o.neckerchief()` | `{color}` (+ `mat` for knee pads, `y` for the kerchief) |
| `o.backpack(opts)`, `o.beltCanister(opts)` | `{color}` / `{x, y, color}` |
| `o.pickaxe({hand})`, `o.cargoHook({hand})`, `o.skiPoles()` | held tools; a held tool makes that zombie use the tool swing attack |
| `o.crystals(opts)` | `{color, emissive, spots:[[bone,x,y,z,dx,dy,dz],…]}` glowing crystal clusters |
| `o.seaweed(opts)` | `{color, anchors:[[x,y,z],…]}` swaying strands (shader sway) |
| `o.icicles(opts)` | `{points:[[bone,x,y,z],…]}` |
| `o.hairShell(opts)` | `{color, length, hairline, messy}` messy hair cap (≈150 tris); hidden while headwear is worn, shown when it is knocked off |
| `o.tatters(opts)` | `{color, pattern, y, count, length, width, side:'front'\|'back'\|'all'}` torn cloth strips hanging from a hem, swaying |
| `o.mascotHead(opts)` | `{kind:'bear'\|'rabbit', color, snout, cracked, plush, size, looseEye}` oversized cracked mascot head |

### 4.4 Low-level primitives (`o.parts.*`, deferred) — build your own gear

All take material fields (§6) plus a binding (`bone` / `weights` / `bind:'auto'`). Positions are rest model space.

```js
o.parts.box({ bone, p:[x,y,z], s:[w,h,d], rot:[x,y,z] (Euler YXZ) | Quaternion, bevel, ...mat })
o.parts.sphere({ bone, p, r | scale:[x,y,z], rot, seg, hemi, ...mat })
o.parts.lathe({ bone, p, profile:[[r,y],…] (bottom → top = outward-facing), rot, scale:[sx,sz], seg, arc, arc0, double, ...mat })
o.parts.torusRing({ bone, p, R, r, rot, arc, arc0, flat, seg, tseg, ...mat })
o.parts.extrudeOutline({ bone, p, outline:[[x,y],…] (CCW, star-shaped), depth, rot, ...mat })
o.parts.capsuleBetween(a, b, r0, r1, mat, { bone | (a,b as bone names → blended), rigid, seg, rings, caps })
o.parts.tube(points, radii, mat, { bone | weights | bindFn:(t,i)=>[[boneIndex,w],…] | auto, seg, sub, flat, caps })
o.parts.strap(points, width, thick, mat, { lift, snap, coreFn })   // flat strap hugging the clothed body (braces, slings)
o.parts.band({ y, height, thick, lift, center:[x,z], tilt, window, seg, ...mat })  // ring around the body at height y
o.parts.puffy(['upperarm.L','forearm.L'], 4, mat, { r:[r0,r1], depth })           // baffled tube along a bone chain
o.parts.custom((o) => { … })                                        // arbitrary code after the body exists
```

Inside `custom` you get the Outfit itself: `o.snap(origin, dir, fallback, rad, window)` (outermost built surface along a ray —
use it to sit things on clothes), `o.weightsAt(p)`, `o.seg(n)` (LOD-scaled segment count), `o.lod`, `o.rng`, the immediate
primitive versions `o._box/_sphere/_lathe/_torus/_tubeRaw/_strap/_band`, and raw geometry: `o.buf.vert(p, n, weights, o._spec(mat),
ao)`, `o.buf.quad(a,b,c,d)` / `o.buf.tri(a,b,c)` (counter-clockwise = front face).

## 5. Worked examples

### 5.1 A complete variant: Whiteout ski patroller

```js
{
  id: 'ski_patrol', name: 'Ski Patrol', looks: 2, height: [1.68, 1.9], hp: 1.1,
  body: { gaunt: 0.25, girthRange: [1.0, 1.1] }, skin: { tint: [0.9, 0.95, 1.08] },
  layers: { frost: 0.7, blood: 0.5 }, eyes: { cataract: 0.9 }, hair: { color: 0x3a2a1c, beard: 0.6 },
  speedClasses: { walk: 0.8, run: 1.2, sprint: 1.0 }, breath: true, helmetY: 1.7, helmetSurface: 'plastic',
  voice: { f0: 100, formants: [600, 1150, 2550], rasp: 0.5, wet: 0.2, muffle: 0.1, kind: 'male' },
  build(o, rng, look) {
    o.body({ skin: 0x6c7278, girth: 1.02, face: { gaunt: 0.4 } });
    const red = look ? 0xb82418 : 0xc83a1c;
    o.garment('pants', { color: 0x1a1c22, pattern: 'ripstop', offset: 0.02, dirt: 0.3, detail: 8 | 16 });
    o.garment('jacket', { color: red, pattern: 'ripstop', offset: 0.024, loose: 0.012, wear: 0.4, dirt: 0.3,
                          collar: 'stand', collarHeight: 0.07, detail: 1 | 2 | 4 | 32 });  // zipped placket, pockets, seams
    o.garment('boots', { color: 0x2a2a30, mat: 'rubber', height: 5 });
    o.garment('gloves', { color: 0x141414, mat: 'leather' });
    o.hardHat({ color: 0xe8e4dc, wear: 0.3 });                     // (ski helmet stand-in)
    o.goggles({ on: 'helmet', lens: 0xd08a30 });
    if (look) o.backpack({ color: 0xb02018 });
    // white cross on the back: an extruded outline snapped onto the jacket
    o.parts.custom((o) => {
      const p = o.snap([0, 1.3, 0.02], [0, 0, 1], 0.12);           // outermost surface behind the chest
      const c = 0.035, w = 0.012, outline = [[-w,-c],[w,-c],[w,-w],[c,-w],[c,w],[w,w],[w,c],[-w,c],[-w,w],[-c,w],[-c,-w],[-w,-w]];
      o._extrude({ bind: 'auto', p: [p.x, p.y, p.z + 0.002], outline, depth: 0.003, mat: 'cloth', color: 0xf0f0f0 });
    });
    o.skiPoles({ color: 0x9aa0a8 });
    o.icicles({ points: [['head', 0.03, 1.535, -0.09], ['chest', 0.1, 1.42, -0.13]] });
  },
}
```

### 5.2 Custom accessory with `custom` + `snap`: a name badge on the chest pocket

```js
o.parts.custom((o) => {
  const p = o.snap([-0.09, 1.3, 0.02], [0, 0, -1], 0.12);         // outermost surface in front of the left chest
  o._box({ bind: 'auto', p: [p.x, p.y, p.z - 0.003], s: [0.07, 0.025, 0.004], mat: 'plastic', color: 0xe0d8b0, wear: 0.4 });
});
```

### 5.3 Last Ferry: harbour dead climbing out of the water (ladder spawn)

The variant needs nothing special (`wet: true` for drips + wet footprints). The spawn does the work:

```js
zombies.spawn('drowned_docker', pos, yaw, { kind: 'ladder', spawnDef: {
  kind: 'ladder', pos: [x, 0, z],                       // in the water, in front of the ladder
  path: [[lx, -0.9, lz], [lx, deckY, lz]],             // ladder bottom (under water) → top rung, on the ladder plane
  ladderTop: [lx, deckY, lz - 0.7],                    // where it steps onto the deck (defines the climb direction)
  rung: 0.3 } });                                      // rung spacing (hands and feet land on rungs)
```

The script swims to the ladder (water height from the stop's colliders `waterY` or `data.waterY`), climbs hand-over-hand with
planted hands/feet, mantles onto the deck and switches to normal pursuit.

### 5.4 After Hours: mascot suit with a balloon

See `variants/examples.js` (`mascot_guest`): `o.mascotHead({kind:'rabbit', cracked:0.45})`, plush coveralls (`mat:'fur',
pattern:'plush'`), `balloon:{hand:'L', color:0xd82828}` and `hitHeadR:0.27` so the oversized head is what bullets hit.

### 5.5 Dark map: working helmet lamp

```js
{ id: 'night_worker', lamp: { color: 0xffe2b6, intensity: 32, range: 18 }, emissiveColor: 0xffe2b6,
  build(o) { o.minerHelmet({ color: 0x2a2a28, lamp: { emissive: 10 } }); /* … */ } }
```

`lamp` (variant level) turns on the runtime beam; the lamp position/direction comes from the helmet (`o.info.lamp`). The beam
is a volumetric cone clipped by a world raycast (it lights the wall around a corner before the zombie appears), with a lens
halo; the two nearest lamps also get a real spot light (the nearest one casts shadows). Beams fade out in bright atmospheres.

## 6. Materials

Material spec fields (garments, gear and primitives): `mat`, `color` (sRGB hex), `rough`, `metal`, `wear`, `dirt`, `pattern`,
`emissive` (0..16, HDR), `param` (material specific), `ao`, `sway` (0..1, vertex sway for seaweed/flaps), `frost` (exposure).

| mat | look |
|---|---|
| `skin` | dead skin: mottling, livor mortis, veins, rot, pores, painted eyes/lids/brows/lips/stubble, rib relief |
| `cloth` | patterns: `weave denim canvas knit quilt stripes check oilskin plush ripstop fleece hivis`; fading, stains, rips, construction details |
| `leather`, `rubber` | grain, creases, scuffs, mud · dusty rubber |
| `metal`, `paint`, `plastic` | rust, scratches · chipped paint (param = metal under the chips) · plastic (param = crack amount) |
| `fur`, `rope`, `hair` | plush fibres · twisted rope / wood handle · hair strands |
| `glass`, `emissive`, `crystal` | lenses · lamp lens / indicators (`emissive`) · glowing faceted crystal (`emissive`) |
| `teeth`, `mouth`, `flesh`, `bone`, `nail` | used by the head / wounds / stumps |

Per-zombie layers (`variantDef.layers`, 0..1): `wet` (dark soaked cloth, water film clearcoat, running rivulets), `frost`
(patchy crust on up-facing surfaces, creases, hair and stubble, glints), `dust` (coal/rock dust with sweat wipes), `blood`
(spatter on hands/chest/mouth), `burn` (char crust + glowing magma cracks), `crystal` (glowing veins under the skin). Up to 8
persistent wound decals per zombie are added by hits (rest space, so they stick while animating).

## 7. Spawning

`zombies.spawn(variantId, worldPos, yaw, opts)` — `opts: {hp, speed, speedClass:'walk'|'run'|'sprint', kind, spawnDef,
barricade, look, hatOff, layers, layersMul}`. `hp` overrides the round health (still × variant `hp`), `look` forces a geometry
variant, `layers` overrides the variant's material layers for this spawn and `layersMul` scales them (e.g. `{layers: {wet: 0.4,
dust: 0.3}}` for a wet / sandy / dusty stop without extra variant ids), `hatOff`
forces the headwear off/on (else `gearDrop.hat`). Headwear built with the gear helpers (`minerHelmet`, `hardHat`, `beanie`,
`souwester`) lives in its own region so it can be left off per spawn and is removed with a head pop.

| kind | spawnDef | behaviour |
|---|---|---|
| `walk` | – | appears and walks in |
| `rise` | – | claws out of the ground (dirt burst, `onSpawnRise`) |
| `barricade` | `{boards, yaw, sill}` + `opts.barricade` (a `Barricade`) | walks to the window, tears planks one by one (`barricade.tearNext`), climbs through (sill 0 or 0.9 m) |
| `ladder` | `{pos, path, ladderTop, rung}` | swim → climb → mantle (§5.3) |

## 8. ZombieManager API (API.md §6)

```js
const zombies = new ZombieManager({ gfx, world, fx, audio });
await zombies.prepare(mapId);                 // builds every variant's geometry for the map + compiles the shaders (no hitches)
zombies.setRound(r);                          // BO2 health: 150 @ r1, +100/round to r9, ×1.1 per round after; speed mix rises
zombies.spawn(id, pos, yaw, opts) → Zombie    // ≤ 24 alive (null when full)
zombies.update(dt, time, player)              // player: {pos:Vector3 (feet), eyeH}
zombies.raycast(ox,oy,oz, dx,dy,dz, maxT, out) → bool   // out: {zombie, part:'head'|'torso'|'arm'|'leg', t, point, normal, bone, limb, surface}
zombies.damage(z, {amount, part, dir, point, normal, impulse, weapon, explosion, melee, headshotMul}) → {killed, headshot, dismembered}
zombies.explode(pos, radius, damage)          // radial damage, limb loss near the centre, ragdoll blast (corpses too)
zombies.alive, zombies.count, zombies.clear(), zombies.killAll()
zombies.onKill(z, info) · onHit(z, info) · onAttackPlayer(z, damage 45..50) · onSpawn(z) · onSpawnRise(z) · onBoardTorn
zombies.waterY(p) / waterOverride = (p) => y  // water level used by ladder swims and splashes
zombies.stats {updateMs, updateMsAvg, visible, draw} · zombies.profile = true → per-phase timings in zombies._prof
zombies.triBudget = 1.1e6, zombies.lodDist = [6, 12], zombies.maxLod0 = 3, zombies.animLodDist = 14, zombies.farShaderDist = 6   // tuning knobs (§9)
zombies.setMaxLights({point: 2, spot: 1})   // cap lights per zombie pixel — only when gfx orders its light pool by importance
zombies.setShaderDefines({...})             // global zombie shader switches (quality levels / GPU ablations; recompiles once)
```

Damage model: part multipliers head ×2 (neck ×1.5), torso ×1, limbs ×0.8; limbs have their own health — losing a leg makes
a crawler, an arm is shot off at the elbow or shoulder (gib ragdoll + stump cap); big head hits pop the head (neck spray).
Hits play a location-specific stagger (head snap, shoulder twist, knee buckle) and deaths become Verlet ragdolls carrying the
body's momentum plus the bullet / blast impulse at the hit point (the knees fold first; joint friction plus hip flexion /
extension limits stop limbs whipping or legs swinging over the body; limbs left balanced upright topple; bodies settle, then
sleep); corpses sink away after ~8 s. Audio hooks are optional:
`audio.zombieVoice(voiceDef)` → `{idle, attack, pain, death, spawn, sprint}` buffer arrays, `audio.play(buffer|name,
{pos, bus:'voice'})`, footsteps `'step.<surface>'`, `'zombie.hit'`, `'zombie.swing'`, `'flesh.gib'`, `'flesh.head'`,
`'balloon.pop'`, `'water.splash'`.

## 9. Performance rules

* One SkinnedMesh per zombie (1 draw + 1 per shadow pass); LOD 0/1/2 are index ranges of one geometry (Shaft Nine, measured
  in round 4: 85–120k / 20–32k / 3.6–5.3k triangles, ≈ 66 MB of geometry for 7 variants × 2 looks). Bare skin is Catmull-Clark
  level 2/1/0 (`SUBDIV_SKIN` in parts.js; mesh.js also supports level 3, measured +5k…+45k LOD0 triangles per look) and carries
  the anatomy relief as real geometry at LOD0/1 (`sculptSkin` in body.js). LODs are assigned every frame under a **triangle
  budget** for all zombie draws (`zombies.triBudget = 1.1e6`, main view + sun shadow + spot/point shadows): (1) LOD1 for
  everything visible within 8 m, (2) LOD0 for the ≤ `maxLod0` (3) nearest within `lodDist[0]` (6 m), (3) LOD1 for the rest within
  `lodDist[1]` (12 m), all while the budget allows; everything else is LOD2. Sun shadows use LOD1 for LOD0 bodies (else LOD2), spot/point light shadows always LOD2. Measured per-frame zombie draws
  are in `zombies.stats.draw` ({tris, sunTris, spotTris, total, totalCalls}).
* Animation LOD: walking zombies beyond 14 m (or off-screen beyond 6 m) animate at half rate; fast movers are sub-stepped on
  long frames (> 24 ms) so planted feet stay locked even at 25 fps.
* Hidden inner garment faces (under an outer opaque layer) and covered skin are removed at build time.
* GPU: zombies draw front-to-back before the world (renderOrder by camera-distance rank) so early-Z rejects hidden pixels in a
  swarm; per-zombie parameters live in ONE packed uniform array (`uZ`, one GL call per zombie); fbm noise is 2 octaves and
  micro detail is only fetched when the pixel can resolve it. `node tools/zombie-swarm.mjs map stop rounds configs` measures it.
* Shading: one MeshStandardMaterial program (no clearcoat/sheen lobes): wet film → roughness, cloth sheen / skin back-scatter /
  sky rim → one fresnel term on the received light. LOD2 bodies switch to a second program (`#define ZFAR`) that skips sub-pixel
  detail (construction details, pores). Albedo is capped at 0.6 so whites never clip.
* Keep gear lean: ≤ ~25 primitives per variant, `seg` 8–28; `o.seg(n)` scales counts down for LOD 1/2 automatically.
* `looks: 2` per variant; geometry builds once per look at `prepare()` (≈ 0.5–1.5 s per variant, cached; the body cage and
  subdivided garment shells are shared between looks and LODs).
* Nothing may allocate per frame in variant code — variants only run at build time.

## 10. Limitations / notes for integrators

* Collision walls in a stop should be `walk:false` so the nav grid does not treat their tops as floor.
* The zombie material reads the core fog / sky-visibility uniforms (G.*), so zombies fog and darken indoors like the world.
* Temporal AA in the core renderer reprojects with camera motion only; fast-moving limbs can show faint ghosting.

## 11. Sandbox `window.__t`

`spawn(id, n, {at, yaw, look, dist, kind, speedClass})`, `clear()`, `shoot(part|bone, {dmg, impulse})`, `explode()`, `kill(k)`,
`orbit(yawDeg, dist, y, ly, fov)`, `boneCam(bone, yawDeg, dist, dy, fov)`, `closeup('head'|'hands'|'feet'|'torso')`,
`follow()`, `cam(x,y,z, lx,ly,lz, fov)`, `freeze()`, `step(n)`, `aiOff()`, `moveTarget(x,z)`, `circleTarget(r, speed)`,
`stress(n)`, `metrics()` (foot slip, root acceleration, CPU/GPU ms, calls, tris), `resetMetrics()`, `zombieCost()`,
`barricadeTest(id)`, `ladderTest(id)`, `riseTest(id)`, `lod(l)`, `variants()`, `mapIds()`.

## 12. Cloth, construction and gear (cloth.js · folds.js · stitch.js · boots.js · gearkit.js)

Garments are real cloth pieces on the body (LOD 0 / 1; LOD 2 keeps the cheap offset shell):

1. `cloth.js` converts the garment shell to a compact quad mesh (`CMesh`, ~2 cm) and drapes it once per look with a **position-based-dynamics relaxation**
   (`relax`): gravity (fabric weight), structural + shear distance constraints, a Laplacian bending prior toward the fitted shape (stiffness), collision against the
   body surface **and every garment underneath** (`BodyProxy` + layer heights), skin cling and pins (shoulders / collar / waistband / belt). Result cached per look (`o._cc`).
   Analytic shape terms (hem flare, blousing above the belt, sleeve / trouser ease, sag) run before the relaxation. LOD 0 refines to ~1 cm (`refineAdaptive`, limbs axially).
2. `folds.js` adds **ridged crease displacement** (crisp crest, soft valley, 5-20 mm, outward only): hanging folds, elbow / knee / wrist / ankle-stack / belt-gather /
   armpit + crotch fan zones, and properly built **quilted baffles** (`puff`: pillows pinched at the stitch lines, box-quilting seams, fuller toward the bottom of each baffle).
3. `stitch.js` builds construction as geometry on the finished cloth (`Surf` = closest-point / ray queries on the layer itself): rolled hems with thickness, seam welts + topstitch
   dashes (side / shoulder / underarm / back / armhole, outseam / inseam), placket + buttons with holes and thread (`detail & 1`), zips with teeth + slider + pull (`& 1 & 32`),
   patch and flap pockets that bulge (`& 2`, jacket hip pockets), waistband + belt loops + fly + back / slash pockets (`& 8`), knee patches (`& 16`), frayed torn rims. Fur and
   plastic suits (mascots) skip pockets / buttons. Details of a garment covered by an outer garment are skipped.
4. `boots.js`: sole unit built around the actual upper (scalloped lug wall, herringbone tread blocks, stitched welt, heel stack), toe cap + heel counter panels, eyelets, criss-cross
   laces and tongue (leather), buckle straps (plastic / rubber), moulded ridges (wellingtons).
5. `gearkit.js` replaces the simple gear helpers: miner's fibre hat (shell thickness, rolled brim + peak, comb, rivets, chin strap), cap lamp (housing, cooling rings, reflector,
   lens, cable, battery), hard hat (ribs, gutter brim, harness, nape ratchet), rib-knit beanie, stitched leather belt with a real buckle (`o.info.belt` = belt height, used for the
   waist pins / gathers), backpack (lid, pockets, zip, straps), pickaxe (oval hickory handle, wrapped grip, forged head), ski poles (grip, strap, basket, tip), tatters (forked,
   thick, frayed), knee pads, belt canister.

Budgets (LOD0 / LOD1 / LOD2): garments ≈ 45-60 k / 12-18 k / 3 k triangles, gear ≈ 8 k; prepare cost per look ≈ 0.3-0.5 s CPU (relaxation once per variant + look). A/B switch:
`globalThis.__ZCLOTH_OFF = true` (before `prepare`) restores the old shell garments and simple gear. Headless look-dev (no browser): `node --import ./tools/cloth/reg.mjs tools/cloth/preview.mjs
--map whiteout --variants tourist --look 0 --lod 0 --views front,torso,legs` (software renderer → PNG), `tools/cloth/prof.mjs <map> [ids] [--trace]` (CPU per variant, triangles per category),
`tools/cloth/studio.mjs <map> <prefix> <id[:look]>,…` (real renderer close-ups), `tools/cloth/swarm-ab.mjs [map] [stop] [rounds]` (interleaved old / cloth prepare time + 24-zombie GPU cost in one
browser session), `tools/cloth/validate.mjs` (finite / in-range geometry of every variant of every map).

## 12. Faces, skin, hair, hands, wounds (realism pass)

All of it is generated from the same variant definitions; every new key is optional.

* **Face identity** is per *variant* (both looks are the same person; head + hair geometry is built once per variant/LOD and replayed).
  `o.body({ face: {...} })` keys (besides the old ones): `age` (0..1: folds, bags, jowls), `noseHump` (−1..1), `noseTip`, `noseDev` (crooked), `noseGone: 1`
  (missing nose), `deep` (orbit depth), `bags`, `folds`, `jowl`, `masseter`, `cleft`, `earStick`, `earLobe`, `lidDrop`, `browTilt`, `mouthTilt`, `jawShift`, `asym`,
  `gaze: [x, y]` (dead eyes rolling up), `lipsGone` (retracts the lips), `teethMissing`, `earsGone` (bit mask). Eyes: `eyes.cataract`, `eyes.glow`, `eyes.color`
  (glow colour), natural iris colours are picked per identity. Eyeballs, lids (margin tube), lashes, nostrils, 32 teeth, gums and tongue are real geometry at LOD0/1.
* **Hair** (`hair: { color, amount, hairline, beard, brows, bald, style: 'crop'|'short'|'medium'|'long'|'matted'|'combed', length (m), grey }`, plus
  `facial: { moustache, sideburns }` chances rolled per look). Scalp hair is ribbon "cards" in region `REG.hair` (hidden while headwear is worn and on a head pop);
  the fragment shader cuts sub-strands out of each card (dithered discard, TAA resolves it) and adds a Kajiya-Kay highlight. `o.hairShell()` now only sets style hints.
* **Skin**: per-pixel dead-skin model in `skinshade.js` (livor, necrosis, bruises with yellow rims, age spots, veins, pores, forehead / crow's-feet / lip lines,
  stubble dots, facial redness, periorbital rings, lips, nostrils, ears, neck cords, finger creases + knuckle wrinkles + tendon veins, ribs). Cheap SSS wrap in the
  light loop (`gSSS`). Fetch budget of the skin branch ≈ 10 `uNoise3` fetches.
* **Hands / feet**: `hand.js` sculpts the subdivided skin (extensor tendons, metacarpal heads, joint bulges, pads, styloids), builds curved nails (random broken /
  torn nails) and — when no garment covers the foot — five toes with nails.
* **Wounds are geometry** (`flesh.js`): `variantDef.wounds` / `extraWounds` / `facial.cheekWound` are resolved per *look* at build time (seeded rng) and cut out of every
  layer at the spot (skin, shirt, jacket…): torn rim, rolled skin edge, fat, muscle, floor / bone; `open` wounds get exposed ribs; `cheek` wounds open onto the teeth.
  Types: `bite`, `gash`, `open` (`ribs`), `bullet`, `cheek`; `bandage` stays a painted decal, and bullet hits still add painted decals at runtime. The spawn-time painted
  story wounds are switched off (`def.wounds` keeps only bandages, `def.extraWounds = 0`). Dismemberment stumps have a ragged skin edge, fat, muscle, protruding bone
  with marrow and hanging skin flaps.
* Dev tools: `node tools/zgeo.mjs <map> [--variants a,b] [--view head|hands|torso|mouth|eye|ear|x,y,z,dist] [--yaw d --pitch d] [--wounds "open,chest,0.07,1;…"] [--out shots/face/x]`
  (Node-only build + software preview + per-module build ms), `node tools/zface.mjs <prefix> --only a,b --views head,mouth,eyes,ear,hand1,chest,… [--wounds …]`
  (studio close-ups in the real renderer, dev map with only the listed variants).
