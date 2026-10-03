# DEAD RIDE — engineering contract (read this first)

Browser game, **three.js r186 only** (vendored in `vendor/three`, official addons in `vendor/three/examples/jsm`). No external assets:
every model, texture, sound, effect is generated in code. Run: `python3 -m http.server 8080` in the project root → http://localhost:8080/
Test/look-dev tools (real GTX 1070 via headless Chromium): `node tools/shot.mjs`, `node tools/views.mjs` (see §12).

## 0. Conventions
* Units = metres, +Y up, right-handed. Camera/object faces **−Z at yaw 0**; forward vector of yaw θ is `(−sinθ, 0, −cosθ)`. Spawn/station `yaw` uses the same convention.
* Colours in code are sRGB hex (`0xRRGGBB`); three converts to linear. Light/emissive values are linear HDR (values > 1 glow; bloom + tone mapping in `gfx`).
* **Stops are authored in LOCAL coordinates** around their own origin. The world adds `origin` (translation only). Colliders/nav are local; `world.*` queries take WORLD coords.
* Real-world scale everywhere: door 2.0 m, stair rise 0.18 m, rail gauge 1.435 m (mine tubs 0.61 m), person 1.7–1.9 m, eye 1.7 m.

## 1. File map
```
index.html, src/main.js                 boot (query: ?sandbox=<name>  ?map=<id>&stop=<n>)
src/core/gfx.js        renderer, HDR MSAA pipeline (SSAO, bloom, auto-exposure, filmic composite), atmospheres, light POOL, IBL makeEnv
src/core/mats.js       material patching (fog, triplanar, snow, wet, breakup, wind), std()/phys()/glowMaterial()
src/core/synth.js      GPU procedural PBR texture synthesizer  (+ synthGLSL.js: 27 patterns, 12 weathering layers)
src/core/build.js      Builder: real-scale primitives, static batching, instancing, colliders
src/core/props.js      oilDrum crate pallet railTrack fenceLine ladder lampPost oreCart
src/core/glow.js       makeBeam (volumetric cone), HaloBatch (lamp glare)      src/core/water.js  Gerstner Water + CPU height()
src/core/terrain.js    buildTerrain(heightFn)     src/core/canvas2d.js  signMaterial / canvasTexture
src/core/fx.js         FX: GPU particles, decals, tracers, casings, weather volumes, impact table, explosions
src/core/colliders.js  analytic collision world     src/core/nav.js  flow-field navigation     src/core/world.js  World/Stop runtime
src/core/vehicle.js    Vehicle base class           src/core/player.js FPS controller           src/core/input.js
src/core/audio.js + dsp.js  audio engine API + DSP helpers          src/sky in core/sky.js
src/maps/<id>/index.js   map definition (default export)     src/maps/<id>/<stop>.js stop definitions   ... vehicle.js route.js zombies.js
src/game/zombies/*  zombie system    src/game/weapons/*  weapon system    src/game/*  game loop (owner: integrator)
src/sandbox/*.js    test scenes (?sandbox=name): gallery, stop, ride, weapons, zombies, audio
```

## 2. Stop definition (what a map author writes)
```js
export default {
  id: 'surface', name: 'Surface Yard', origin: [0,0,0],      // world offset; stops of one map must be far apart (hundreds of m) or at different depths
  viewRadius: 340,                                           // stop group is drawn while camera is within this (m)
  async build(ctx) { ...; return data; }
}
```
`ctx`: `{ B (Builder), synth, gfx, fx, THREE, rng (seeded), stop, world, group, origin, light(o), weather(cfg), env(atmoDef, patches) }`.
`build` returns **data**:
```js
{ atmo,                         // atmosphere def (§4)         envPatches: [{dir,color,size,intensity}]  emissive patches baked into IBL (lamps/sun)
  playerStart: {pos:[x,y,z], yaw}, station: {pos, yaw},        // where the player appears on arrival / where the vehicle docks (vehicle frame origin)
  groundY: 0 | heightFn(x,z) | waterY, groundSurface:'dirt', surfaceAt(x,z),   // ground for collisions (else use B.box colliders)
  navBounds: [minX,minZ,maxX,maxZ], navBlocked(x,z,groundY)->bool, nav:false to disable
  spawns: [ {kind, pos, yaw, ...} ],                            // §7
  buys: { walls:[{pos,yaw,gun}], perks:[{pos,yaw,perk}], box:{pos,yaw}|null },   // placements ONLY (the game instantiates models); keep 2+ walls, 1 perk, 1 box per stop
  zombieVariants: ['id',...] | [{id, weight, minRound}],        // which of the map's zombie variants appear here
  ambient: {...},                                               // §9 ambience recipe
  landmark: {pos:[x,y,z], name},                                // for menu/hero cameras
  update(dt, t, active) {},                                     // per-frame animation (only called while visible); do particles only if active
  onReady(stopRuntime) {},
}
```
Rules: every stop must have its own layout, landmark, palette, lighting, weather, props/materials, ambience and zombie variants — **a recoloured copy of another stop fails review**. All static geometry goes through `B` (batched, ≤ ~700 draw calls total per scene).

### 2.1 Builder `B` (src/core/build.js) — all positions are LOCAL metres
* `B.m(name, synthDef | THREE.Material, patchOpts)` named cached material. `B.mat(nameOrMat)`.
* `B.box({p:[x,y,z] (BASE centre), s:[w,h,d], yaw,pitch,roll, mat, bevel (m, default min(3cm,20%)), anchor:'center', swap:true (rotate UVs 90°), col:'wood'|false, walk:false, cast:true, recv:true})` → collider (if `col`)
* `B.beam(a[3], b[3], w, h, {mat,...})` box between two points. `B.cyl({p, r | [rBottom,rTop], h, seg, mat, pitch/roll, anchor, open, col})`. `B.sphere({p, r, seg, ps, scale, mat})`.
* `B.lathe({p, profile:[[r,y]...], seg, mat, col})`, `B.extrude({p, poly:[[x,z]...], h, bevel, mat, col})`, `B.tube({pts, r, mat, seg, segs, closed})`, `B.cable(a,b,sag,r,mat)`,
  `B.plane({p, s:[w,d], yaw, mat, col})` (horizontal quad, UV in metres), `B.stairs({p,n,rise,run,w,yaw,mat,col})` (walkable boxes), `B.rock({p,r,squash,amp,seed,detail,mat,col})` (lumpy; use with triplanar mat), `B.prism({p,s:[len,h,depth],mat})` gable roof.
* `B.instance(key, THREE.BufferGeometry, mat, B.matrix(p,yaw,scale,pitch,roll), colorHex, opts)` instanced copies (chunked). `rawToGeometry(raw)` in build.js.
* `B.addRaw(raw, THREE.Matrix4, mat)` custom raw geometry `{p,n,u,i}` (UV in metres). `B.colliders.addBox/addCyl` for hidden colliders. `B.group` is the stop's THREE.Group (add animated meshes here; they are NOT batched).
* `ctx.light({pos,color,intensity(cd),distance,decay:2,kind:'point'|'spot',dir,angle,penumbra,flicker,flickerSpeed,shadow})` returns a mutable source. The renderer keeps only the best N (pool of 4–10 point + 3 spot lights) active — *unlimited lamps are fine*, but glow must come from halos (below), not from real lights.
* Colliders: `col:'concrete|brick|rock|metal|wood|snow|ice|water|dirt|gravel|glass|fabric|crystal|lava|plastic|tile|grass'` picks impact FX/sound/footsteps. Boxes are walkable on top (step 0.45 m) unless `walk:false`.

### 2.2 Materials (src/core/synth.js) — GPU-baked tileable PBR (albedo/normal/ORM/emissive)
`B.m('name', { pattern, size:512|1024, tile:metres per repeat, colors:[c0..c3], rough:[min,max], metal, bump:mm relief, ao, params:{...}, layers:{...}, rustColor, mossColor, seed, emissive }, patchOpts)`
Patterns → params: `noise(scale contrast fine speckle pores panels panelWidth) planks(rows gap grain knots cols vertical weather nails) bricks(rows cols mortar variation chips roughness moss soot) stone(scale gap round variation mortarDark strata lichen) tiles(n grout checker bevel wear gloss crackle) plates(cols rows seam rivets brushed panelVar bolts) corrugated(ribs depth vertical paint dents) diamond(n height wear) rock(scale strata cracks roughness tone moisture) snow(scale ripples sparkle direction crust) ice(scale cracks bubbles depth) gravel(scale variation sand) dirt(scale pebbles cracks grass) weave(threads twill variation fuzz ripstop) quilt(rows cols puff stitch threads) leather(scale creases wear) rubber(scale tread) carpet(scale pattern) terrazzo(scale chips chipSize) lava(scale crackWidth glow crust) hex(n border glow bevel) hazard(n angle wear) asphalt(scale aggregate cracks lines) crystal(scale facets veins glow) wood(scale rings knots weather vertical) scales(rows cols round variation) bark(scale depth moss)`
Layers (0..1): `rust moss grime scratch edge wet frost dust streak cracks sparkle oil`. `glsl:'S p_custom(vec2 uv){...}'` adds a custom pattern (see synthGLSL.js `S` struct: h,a,r,m,ao,e).
`patchOpts`: `triplanar: 1/tileMetres` (no UVs needed: rocks/terrain/organic), `snow: 0..2` (world-up surfaces get snow driven by `atmo.snow`), `wet`, `breakup: 0..1` (kills visible tiling), `wind:{amp,freq,stiff}` (foliage/cloth sway), `vertex/frag` GLSL injections, plus any MeshStandardMaterial param (`emissive`, `transparent`, `side`, `alphaToCoverage`…). `std({color,roughness,metalness,...})` plain patched material; `glowMaterial()` additive unlit.
UV convention: metres. Sizes: 512 default, 1024 for hero surfaces (VRAM budget ≈ 400 MB total: don't bake > ~60 materials per map).

### 2.3 Visible light & atmosphere helpers
`makeBeam({length,r0,r1,color,intensity,dust})` volumetric cone along +Z (use `mesh.lookAt`), `new HaloBatch(n)` + `.add([x,y,z], color, sizeM, intensity, flickerSpeed)` (one draw call for all lamp glares; add `halos.mesh` to `B.group`).
`new Water({size, waves:[{dir:[x,z],len,amp,steep}], color, deep, roughness, level, foam, clarity, ripple})`, `water.update(t, camPos, amp)`, `water.height(x,z,t,outNormal)` — same function on GPU and CPU (buoyancy!). Add `water.mesh` to a group.
`buildTerrain(B,{minX,maxX,minZ,maxZ,cell,heightFn,mat})` + set `groundY: heightFn` in build data. `signMaterial({lines,bg,fg,glow,weather,...})`, `canvasTexture(w,h,draw)`.
Weather via `ctx.weather({count, box:[x,y,z], fall, wind:[x,y,z]|null, size, turb, streak, twinkle, rise, color:[r,g,b], alpha, cell, additive, seed})`: snow (cell 3, fall 1.2), rain (cell 13, streak 3, fall 9, size .02), embers (additive, rise), dust, spores, fireflies. Atlas cells: 0 soft,1 smoke,2 streak,3 flake,4 star,5 ring,6 shard,7 drop,8 fire,9 dust,10 glow,11 flare,12 chunk,13 rain streak,14 bubble,15 splat.
`ctx.fx.puff / spark / chunks / splash / blood / explosion / pulseLight / addShake` for stop-local effects (call from `update` when `active`).

## 3. Lighting calibration (learned the hard way — follow it)
Units: light intensities are *relative photometry*. **Pick the dominant natural light as the key** (sun/moon: 2–5 units at 1.0 exposure) and scale everything to it.
* Sun at dusk 4.4, noon 6–8, moon 0.6–1.2 (with exposure ×1.5–2.5). `env.intensity` 0.3–0.8 (IBL ambient; sky colours drive it — keep zenith bluer/darker than horizon so shadows are cool).
* Point lamps: **candela ≈ 15–60** (sodium/tungsten yard lamps, distance 20–28 m, decay 2), fire 8–20, flood spot 200–400, helmet lamps 30–80, flashlight 150. A lamp at 300 cd blows out a dusk scene. At night the *ratio* to the moon can be 20–60×.
* Glow (bulbs, neon, windows) = emissive materials with `emissiveIntensity` 6–14 + halos + bloom; never fake glow with real point lights beyond the pool.
* Tone: exposure auto-adapts inside `autoExposure:{key,min,max}` (keep range narrow 0.8–1.6; it fights authored contrast). Use `grade` (lift/gain/tint/sat/contrast) for the stop's colour identity. Vignette 0.3–0.5, grain 0.02–0.05, bloom 0.3–0.6.
* Fog is analytic height fog: `fog:{color (shade colour), scatter (colour toward the sun/moon), density (1/m at base), falloff (1/m), base (world y where density is max), power (sun lobe sharpness)}`. 0.003–0.012 for open air, 0.02–0.06 for fog/blizzard/mine dust. Stops underground: enclosed dark ambience, `sky:null`, `env.intensity` ~0.05–0.15, `sun.intensity:0`.
* Shadows: only `sun` casts world shadows (radius 36 m around the player); lamps are pooled point lights without shadows; ≤ 2 spot lights with shadows (assign `shadow:true`).
* Rust is dark brown-orange, not saturated orange; ground/dirt albedo 0.05–0.2; snow 0.8–0.9; concrete 0.25–0.4; never albedo 1.0.
### Atmosphere schema (`data.atmo`) — compiled by `compileAtmo` (gfx.js ATMO_DEFAULT shows every key)
`{ name, shafts:0..1 (screen-space light shafts toward the sun/moon; use 0.4-0.8 for low sun, needs sun.intensity>0.5), fog:{...}, sky:{zenith,horizon,ground,gradPow,sunColor,sunSize,sunGlow,disc:0|1(sun)|2(moon),stars,cloud,cloudColor,cloudLit,cloudSpeed,cloudScale,cloudDark,aurora,auroraA,auroraB,horizonFog} | null, sun:{dir:[x,y,z] (TOWARD the light), color, intensity, shadow}, env:{intensity}, exposure, bloom, vignette, grain, chroma, grade:{sat,contrast,lift:[r,g,b],gain,tint}, autoExposure:{key,min,max}, wind:[x,y,z], snow:0..1, wet:0..1, frost:0..1, ao:0..1, reverb:'spaceId', lightning }`.
Different stops of one map must differ in ≥ 5 of: palette, fog colour/density, sun/moon type, sky, weather, exposure/grade, light colour temperature, ambience, materials.

## 4. Map definition (`src/maps/<id>/index.js`, default export)
```js
{ id, name, tagline, blurb, accent:'#hex', vehicleName, zombieName, threat:1..5,
  stops:[stopDef,...],                                  // order = ride order; the last stop loops to the first
  async buildRoute(ctx),                                // optional scenery BETWEEN stops (cables, towers, valley, track, sea, channel markers…); ctx.B builds into world space (absolute coords)
  async buildVehicle(ctx) → Vehicle,                    // §5
  zombies: { variants:[...], voice... }                 // §6 (zombie worker defines the format) }
```
Stop origins: the vehicle travels between actual `station` poses (world = origin + station.pos). Hide far stops with fog; `viewRadius` controls draw distance per stop. Ride time 20–35 s per leg.

## 5. Vehicle (`src/core/vehicle.js`)
Subclass `Vehicle(world)`: build meshes into `this.group` (world space) and the player-riding `this.frame` (child of group; may sway); interior collisions in `this.colliders` (LOCAL to frame) + `this.bounds` (walkable xz) + `this.boardBox` (trigger volume: player inside ⇒ can depart) + `this.floorY`.
Async lifecycle (use `await this.animate(sec, (k)=>..., ease)` / `this.wait(s)`): `arrive(stop)` (dock at `stop.origin + station`, open doors → state 'open'), `ride(fromStop,toStop,hooks)` (close doors, physics-driven travel, open doors at destination; call `hooks.progress(k)` 0..1 each frame; world blends atmospheres), `depart(stop)` (doors close, drives away out of sight), `parkAway`, `snapDocked`. Override `simulate(dt,time)` for continuous physics (sway/waves/wind — **real physics**: pendulum, buoyancy on `water.height`, rope stretch, jerk-limited motion), `applyDoors(k)`. `accelLocal`/`angVel` are tracked automatically from `frame` motion and push the player (inertial coupling). Emit sound cues with `this.emit('creak'|'bump'|'doors'|'arrived', data)`.

## 6. Zombie system contract (`src/game/zombies/index.js`)
```js
export class ZombieManager {
  constructor({ gfx, world, fx, audio })
  registerVariants(mapId, [variantDef])              // variantDef format defined by the zombie worker in src/game/zombies/README.md
  spawn(variantId, worldPos: Vector3, yaw, { hp, speed, kind:'walk'|'barricade'|'ladder'|'rise', spawnDef }) → Zombie
  update(dt, time, player)                           // AI (flow-field via world.flow/navTarget), locomotion, attacks (calls onAttackPlayer), ragdolls, lamp beams
  raycast(ox,oy,oz,dx,dy,dz,maxT, out)               // → true; out = {zombie, part:'head'|'torso'|'arm'|'leg'|..., t, point:Vector3, normal:Vector3}
  damage(zombie, {amount, part, dir:Vector3, point:Vector3, impulse, weapon, explosion}) → {killed, headshot, dismembered}
  explode(pos, radius, damage)                       // radial damage + ragdoll impulse
  alive: Zombie[]; count; clear(); killAll()
  onKill(zombie, info), onHit(zombie, info), onAttackPlayer(zombie, damage), onSpawnRise/etc callbacks
}
```
Requirements: ≤ 24 alive at once, ≥ 5 clearly different variants per map; skinned meshes (one draw call per zombie ideally), procedural locomotion with **planted feet** (stance-phase foot lock + IK), momentum/turn-rate limits, hit-location reactions, ragdoll death with impulse from the bullet/blast, crawlers, barricade tearing, ladder climbing (Last Ferry), lamp beams (Shaft Nine), frost/wetness materials. Zero per-frame allocations. Precompile materials at init.

## 7. Spawn kinds (in `data.spawns`)
`{kind:'walk', pos, yaw}` appears and walks in (should be out of sight: fog/tunnel/gate) · `{kind:'barricade', pos, yaw, boards:5}` · `{kind:'ladder', pos (in water), yaw, path:[[x,y,z],...], ladderTop}` swim→climb→step onto deck · `{kind:'rise', pos, yaw}` emerges from ground/snow/water · optional `variant:'id'`.
**Barricade semantics (important):** `pos` = where the zombie stands BEHIND the barricade (the side the zombies come from, e.g. inside the building); `yaw` = its direction of travel through the opening toward the players (forward = (−sin yaw, 0, −cos yaw)). The game places the 5-plank barricade automatically **0.8 m in front of `pos`** along that direction (planks span the local x axis of that plane, 1.5 m wide, 1.9 m tall). Build the wall with a REAL opening there (wall segments around a 1.5 × 1.9 m hole, dark interior behind, sill at ground or 0.9 m) so zombies visibly climb through; never leave solid geometry in the opening. `spawnDef.barricade` (a `Barricade` from src/game/barricade.js) is passed to the zombie manager: `barricade.boards` (planks left), `barricade.tearNext(dir)` (rips a plank off, returns false when empty).

## 8. Weapon system contract (`src/game/weapons/index.js`)
```js
export const WEAPONS = { m1911:{id,name,class,price,ammoPrice,box,mag,reserve,rpm,...}, mp5, olympia, m14, ak74u, remington870, raygun }   // real specs, see RUBRIC.md §1
export class WeaponSystem {
  constructor({ gfx, fx, audio, world, player, input, combat })
  update(dt, time)            // reads input (mouse1 fire, mouse2 ADS, R reload, V melee, G grenade, 1/2/wheel swap); animates viewmodel (layer 1 objects added to gfx.scene); kicks the player camera (player.addKick / addAim); sets player.adsK; calls combat.shoot()
  give(id) / has(id) / current / slots / refillAll() / addAmmo() / maxAmmo() / setPerks({speedCola,doubleTap,juggernog})
  events: onShot(id), onReload(id), onEmpty(id), onSwap(id)
}
```
`combat.shoot({origin, dir, damage, range, pellets, spread, weaponId, tracer:{color,speed,len,width}, muzzle:Vector3, isShotgun, caliber, headshotMul, explosive})` is provided by the integrator (hitscan vs world + zombies, impact FX by surface, blood, tracers, points).
Viewmodel: separate camera FOV (`gfx.setVmFov`), rendered on layer 1 after a depth clear (never clips walls), lit by the scene lights; also retract when the wall is < 0.8 m.

## 9. Audio contract (`src/core/audio.js`, `dsp.js`, `src/core/sfx/*`, `ambience.js`; the audio worker owns them, keep the surface)
* **Boot**: `await audio.init()` after a user gesture (returns within ~3 s at most; heavy synthesis runs in module workers, results stay raw until needed). `audio.register(name, (ctx,dsp)=>AudioBuffer|[AudioBuffer])` still works (weapons register `gun.*` / `wpn.*`; `src/game/weapons/sounds.js` must stay import-free: the synthesis workers import it too). `audio.play(nameOrBuffer, {pos, vol, pitch, bus:'sfx'|'ui'|'voice'|'amb'|'music'|'weapon', loop, minDist, maxDist, space, occlusion, sos, delay})` -> handle `{stop, setVol, setPitch, setPos, playing}`; a buffer taken from a voice bank keeps its bus / priority / concurrency limit.
* **Frame**: `audio.update(dt, {pos, forward, up}, {space, muffle, underwater, wind})` (state optional). No per-frame allocation; unchanged sources cost nothing, sources beyond 6 m refresh at 30 Hz.
* **Auto world mode (default)**: `audio.attachPlayer(player)` (footsteps `step.<surface>.<walk|sprint|crouch>.<L|R>`, landing, hurt, low-HP heartbeat/breath) also calls `audio.setWorld(player.world)`. The engine then follows `world.active` by itself: the stop's room (`audio.spaceFor(atmo.reverb)` refined per stop: pier, wharf, crystalCavern, plaza...), sub-rooms chosen by a listener probe (`tunnelHall` / `hutInterior` / `warehouse`, ferry deck vs cabin), the ambience preset `<map>.<stop>` (origin = stop origin) with the map authors' positional `events` merged onto it (`exact: true` on `data.ambient` keeps a recipe untouched; `audio.preferPresets = false` disables presets globally), wind from `atmo.wind`, underwater below `waterY`, a continuous cross-fade during `world.setTransit`, `attachVehicle(world.vehicle)` (its `emit()` events: doors, signal, start, stop, bump, creak, arrived, departed, approach, horn, mooring, pylon, jointkick, pa; `state` is data-only) and occlusion through `world.clear` / `world.raycast` (per-material transmission: glass ~open, wood muffled, concrete strong; detours around door frames). Explicit `setSpace()` / `ambience.set(stop.ambient)` calls remain valid (they join the same room/runtime); `audio.auto = false` turns the follow mode off. Game-side duplicate step/land/hurt sounds are dropped.
* **Rooms**: `audio.setSpace(idOrDef, fade)` with a `SPACES` id or `{rt60, damping, predelay, wet, dryLP, early:[[t,g]..]}`; every gunshot / impact / voice goes through the current room's convolution reverb + air-absorption low-pass (mine shaft RT60 4.4 s with echoes, falling snow 0.16 s muffled). Ids: open, openDusk, mineShaft, tunnel, tunnelHall, flooded, crystalCavern, magmaChamber, snow, blizzard, whiteoutStation, summit, pier, wharf, warehouse, prison, lighthouse, plaza, space, castle, cove, hutInterior, vehicle, cage, gondola, ferry, monorail, underwater. `audio.prepareSpaces([...])` pre-loads convolvers (done automatically for every stop at attach).
* **One-shot helpers**: `audio.explosion(pos, radiusMetres)` (grenade 5.2 = full blast, 2.6 = small; ducking + tinnitus for close blasts), `audio.impact(surface, pos, {caliber, dir, normal})`, `audio.whiz(a, b)`, `audio.flesh(pos)`, `audio.casing(pos, surface, isShotgun)`, `audio.duck(bus, amt, secs)`, `audio.muffle(0..1)` (pause = 0.5), `audio.quiet(sec)` (hold back background buffer conversion at the start of a wave), `audio.masterVolume`.
* **Sound names** (all exist): `step.<surface>[.walk|sprint|crouch.L|R]`, `impact.<surface>`, `casing.<brass|shell>.<surface>`, `ricochet`, `bullet.whiz`, `flesh.hit|head|gib`, `glass.break|tinkle`, `explosion|.small|.far`, `water.splash`, `balloon.pop`, `board.plank|repair|hit|break`, `melee.*`, `zombie.hit|swing|step|cloth|drag|<idle|attack|pain|death|spawn|sprint>`, `player.hurt|death|land|jump|breath|heartbeat`, `ui.point|buy|deny|click|hover|confirm|back|tab|round.start|round.end|box.open|box.teddy`, `perk.<juggernog|speedcola|doubletap|quickrevive|staminup>`, `powerup.<maxammo|instakill|doublepoints|nuke|spawn>`, `vehicle.<cage|gondola|ferry|monorail>.<door|door.close|start|stop|bump|creak|horn|bell|...>`, `amb.evt.<40 event types>` (>= 8 variants each). Surfaces: concrete, brick, rock, metal, wood, snow, ice, water, dirt, gravel, grass, tile, carpet, crystal, lava (+ aliases plastic, fabric, glass, sand, stone, steel, ...). `tools/audio-audit.mjs` lists any name the game requests that is not registered.
* **Zombie voices**: `audio.zombieVoice(profile) -> {idle:[],attack:[],pain:[],death:[],spawn:[],sprint:[], pick(cat), ready}`; profile = `{f0: Hz | [lo,hi], formants: [F1,F2,F3] Hz, rasp 0..1, wet 0..1, muffle 0..1, kind: 'male'|'masked'|'burnt'|'crystal'|'clown'|'guard'|'guest'|'mascot'|..., size, seed}` (source-filter synthesis: glottal pulses, jitter/shimmer, vocal-fry bursts, formant cascade, aspiration, gasps; 8 variants per category). Each set within a session gets its own spectral colour (>= 8 dB long-term distance between sets). Prebuild banks in `zombies.prepare()`.
* **Ambience DSL** (`data.ambient`): `{space, gain, beds:[{type:'wind'|'hum'|'rumble'|'drone'|'water'|'noise'|'crackle'|'machine'|'music'|'insects', ...params, gain, pos?}], events:[{type: <amb.evt type>, every:[minSec,maxSec], gain, pos:'around'|'far'|[x,y,z], pitch:[a,b]} | {custom:(A)=>{}, every}]}`; loose parameter names (`lap`, `shimmer`, `style`, `tune:{bpm,notes:[[midi,beats]..]}`, `harmonics:[..]`) are understood; unknown types warn once.

## 10. World queries (`world.*`, WORLD coords, active stop)
`raycast(ox,oy,oz,dx,dy,dz,maxT,out{t,nx,ny,nz,surface,col,kind})`, `groundAt(x,z,yRef,out?)→{y,surface}`, `push(pos,r,y,h)`, `flow(x,z,out)`, `navTarget(x,z)`, `isFree(x,z)`, `clear(ax,ay,az,bx,by,bz)`. `world.stops[i]` (`.origin`, `.atmo`, `.data`, `.B.colliders`), `world.active`, `world.vehicle`, `world.setTransit(from,to,k)`.

## 11. Performance rules (hard requirement: never below 60 fps on a GTX 1070 @1080p incl. 24 zombies, explosions, rides)
Budget/frame: ≤ 700 draw calls, ≤ 2.5 M triangles (shadow pass included), JS ≤ 6 ms, GPU ≤ 12 ms. Merge statics via `B`, instance repeats, no per-frame allocations, pool everything, no runtime shader compiles after load (materials created at build time; `renderer.compile` warm-up), decals/particles are GPU ring buffers. Smart technique before less detail: instancing, LOD via fog distance, baked vertex data, impostor lights (halos) instead of real lights.
Check with `?bench` counters: `gfx.stats` (calls/tris), `gfx.gpuMsAvg`, `window.__t.ft()` frame times.

## 12. Tooling
* `node tools/shot.mjs "?sandbox=stop&map=<id>&stop=<n>" out.png --w 1920 --h 1080 --eval "__t.cam(x,eyeY,z,yaw,pitch)"` — one screenshot.
* `node tools/views.mjs "<query>" prefix steps.json` — many named views in one session: `[{"name":"a","eval":"__t.cam(0,1.7,14,0,0.2)","wait":600}]`. Return values of eval are printed (use for numbers such as `gfx.stats`, `gfx.debugExposure()`).
* Sandboxes expose `window.__t`. Harness console output (errors) is printed after the run. **View every screenshot** (Read tool) and judge it honestly against the real thing.
* Grade with `RUBRIC.md`. Never round up. Record per-iteration: differences vs. real → scores → what cost points → fixes.

## 13. Renderer notes added during integration (read once)
* **TAA replaced MSAA** (jittered projection, depth reprojection, variance clipping; AO is applied inside the resolve; viewmodel pixels are masked via alpha 0 written by patched materials). Thin geometry (wires, fences) is stable; after teleports/vehicle cuts call `gfx.resetTAA()`.
* **Light/shadow configuration is constant** (pool of point + spot lights, sun `castShadow` always true, only `shadow.autoUpdate` toggles) so no shader recompiles happen when stops/lights change. Never toggle `light.visible` or `castShadow` at runtime.
* **Sky visibility** (baked per vertex in `StaticBatch` from the collision geometry via a horizon scan) masks image-based ambient: roofs, pier undersides, tunnels and building interiors are automatically dark. It only sees COLLIDERS: register colliders for big occluders (roofs: `col:'metal', walk:false` boxes) or the space will light up like open sky. Set `B.skyVis = false` to skip the bake.
* **Noise in shaders** comes from a baked 3D noise texture (`uNoise3`, `zvn3/zfbm3` in NOISE_GLSL): 1 fetch per octave — use them instead of per-pixel hashes in custom shader code.
* GPU timings: `gfx.profile = true` fills `gfx.passMs` per pass; measurements at light load are misleading when the GPU is in a low power state — judge with `--uncapped` runs or `tools/bench.mjs`.
* **Alpha codes in the scene buffer** (written by opaque materials, read by the TAA resolve / reflection pass): `0` = viewmodel (no history), `0.25–0.9` = dynamic skinned body (short history; the zombie material writes `0.6`), `0.95` = water surface (`water.js`), `1` = static world. Any new custom opaque shader that draws moving skinned geometry should write `gl_FragColor.a = 0.6` after fog, otherwise it will smear/ghost under TAA.
* **Planar water reflections**: `core/water.js` (`Water`) automatically gets real reflections of everything visible on screen (skyline, lamps, ships, sky) — `gfx.js _renderRefl` splats last frame's opaque pixels to their mirrored screen position (half-res depth-tested point cloud, only runs while a Water mesh was drawn). Nothing to do in a map except use `Water`; the effect is strongest with bright emitters above a dark sea. Own water shaders that want it can sample `G.uReflTex` with `G.uReflVP` (see the block at the end of the water fragment shader).
* **Shadow maps are amortised**: the sun map is re-rendered on even frames, pooled spot shadows on odd frames (immediately when a slot is re-assigned or the sun shadow centre jumps). Shadow matrix and map are always updated together, so nothing is inconsistent; dynamic casters' shadows lag ≤ 1 frame. Do not rely on `light.shadow.autoUpdate` — it is forced to `false` and `needsUpdate` is driven by `gfx.render`.
* **Look controls that are global**: `gfx.bloomScale` (0.62, multiplies every stop's `atmo.bloom`; the per-stop values 0.3–0.6 were tuned before it existed), `gfx.vmEnv` (0.4, image-based-light scale for the viewmodel pass so guns don't turn into pale plastic under bright skies), composite sharpening is a clamped unsharp mask in a compressed space (no halos).
* **Static matrices**: stop groups and the world root are frozen (`matrixAutoUpdate = false`) after build so three.js does not re-multiply every static descendant each frame. Never move/rotate a *stop group*; animate objects inside it (they update normally). Meshes made by `Builder`/`StaticBatch`/`Instancer` are already frozen.
* **Explosions / smoke use GPU-baked flipbooks** (`fx.js` `bakeFlipbook`): an 8×8-frame turbulent fireball (additive, colours baked) and billowing smoke puff (alpha, grey shading) are rendered once at load; `fx.fire` / `fx.smoke` are `Particles` systems with `flip` textures where the frame follows the particle's life (two frames blended). Emit with `fx.fire.emit({p, v, life, size:[s0,s1], c0:[hdrR,G,B,a], c1, rot, rotVel, drag}, fx.time)`; for smoke give albedo-like colours (they are multiplied by the scene's particle light). All particles fade near the camera and never cover more than ~30 % of the view (`P_VS`), so muzzle smoke drifting into the lens is harmless.
* **Tools added by the lead**: `tools/smoke.mjs [maps]` (boots the real game, visits every stop, spawns each stop's zombie variants, fires, explodes, prints every console error / GL warning; exit 1 on any — run it before every hand-back), `tools/zshots.mjs <map> <prefix> [stops]` (in-game zombie/gameplay screenshots per stop), `game.debugGotoStop(i)` (jump to a stop as if a ride had arrived).
* **GLSL ES 3.00 reserved words** (compile error → black draws, cascade of GL errors): `patch`, `sample`, `common`, `partition`, `active`, `filter`, `input`, `output`, `superp`, `resource`, `noinline`, `precise`, `smooth`, `flat`, `centroid`, `lowp/mediump/highp` — never use them as variable names in shader strings.
* **CPU budget facts (measured, 1080p, shared dev box)**: a wave frame issues ≈ 2100 WebGL calls (uniform3f 560, uniformMatrix4fv 250, bindTexture 240 + activeTexture 210, bindVertexArray 180, draws 200, useProgram 55). Cost is per *program switch* (each refreshes ~10 vec3 + light uniforms) and per draw (matrices + textures): fewer distinct materials/programs per view and fewer draw calls are the levers, not triangles.
* **Planar reflections for ANY glossy horizontal surface** (not only `Water`): a stop that returns `data.reflect = { level: yLocal }` gets the mirrored-scene splat every frame (only while that stop is active); materials created with `std({ …, refl: 1 })` (patch option `refl`, 0..1 strength, changes the program key with an `R`) then mix the mirrored scene into pixels whose world y is within ~10 cm of the plane, whose normal points up, and whose roughness is < ~0.85 (full strength ≤ 0.3). Reflectance is Fresnel-limited (a dielectric floor mirrors ≈ 2 % head-on and ≈ 25 % at 10 m from eye height): to make wet decks/polished tiles read, lower roughness to 0.05–0.25 on the wet parts (via your patch `frag`/`wet` logic or a separate decal material) — do NOT raise `refl` above 1. The reflection is the *previous frame's* opaque scene splatted to the mirrored position (half res), so very fast camera turns smear for a frame; it is only correct for the plane at `level`.
* **Never read GPU results back synchronously** (`readPixels`, `getBufferSubData`, `getImageData` of a WebGL canvas): it stalls the whole GPU pipeline for 5–40 ms. Auto-exposure is exposed to shaders as the 1×1 texture `G.uExpoTex` instead.
* **Docked vehicles that heave** (ferry on swell): `game.js` refreshes the mirrored deck colliders at 20 Hz while the vehicle is docked and its frame moved, so the player rides the deck; vehicle authors should expose a correct `v.frame` (Object3D whose world matrix is the deck) and `v.colliders` in frame-local coordinates.
* **`visVariant()` (baked sky visibility on StaticBatch meshes) refuses materials whose `onBeforeCompile` was wrapped after `std()`/`patch()`** — a clone would lose the wrapper's uniforms and fail to compile ("undeclared identifier"). If you wrap `onBeforeCompile`, keep it on a material that is not used by `B.box/...` batches, or extend `patchOpts.frag/vertex` instead of wrapping.
* **Detail layer (patch() — automatic for every std()/synth material)**: a shared 256² micro-surface texture (`G.uDetail`: R = fine height with grain, pits and faint scratches, G = mottling, B = roughness breakup) is sampled once per pixel in world space (dominant axis projection, tile ≈ 12 cm) and turned into a derivative bump + albedo/roughness breakup, faded out between 4 and 16 m; plus **specular anti-aliasing** (Kaplanyan/Tokuyoshi roughness widening from normal variance — kills shimmer on normal-mapped metals). Ground-like materials (`name` starting with dirt/gravel/ground/sand/asphalt/road/path/mud, or synth patterns dirt/gravel/asphalt) automatically use the **gravel variant** (`G.uDetailG`: rounded Voronoi pebbles with dark gaps, per-pebble brightness, tile ≈ 25 cm, amplitude 4.5 mm). Options: `std({detail:'gravel'})` force the pebble variant, `detail: 2` scale the strength, `detail:false` disable (`?nodetail=1` disables it globally for A/B). Costs one texture fetch + ~40 ALU per pixel.
* **Canonical program keys**: `patch()` keys programs by flags + baked numeric constants (`pt0.2b0.5v…`), not by the cosmetic `std({key})` — look-alike materials share one GPU program. Measured: the frame's CPU cost is dominated by the ~55 uniform calls each *program* costs (three re-uploads the whole light block, shadow matrices and view matrices per program because view-space light positions change every frame): fewer distinct programs per view = fewer GL calls.
