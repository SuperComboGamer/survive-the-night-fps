# Weapons (src/game/weapons)

Seven guns built entirely in code (true scale, metres), a first-person view-model with skinned arms and hands,
per-gun recoil / flash / casings / sounds, a knife (V) and frag grenades (G). Contract: docs/API.md §8.

View it: `index.html?sandbox=weapons&gun=m1911` (test range) · `&mode=gallery` (turntable studio) · `&light=dark`.
The sandbox exposes `window.__t` (equip, fire, reload, ads, sprint, melee, grenade, freeze(clip, t), inspect, gallery, view, stats).

## Files
| file | what |
|---|---|
| `index.js` | `WeaponSystem`, `buildWorldModel(id)`, re-exports `WEAPONS`, `getOutline`, `getIcon` |
| `specs.js` | `WEAPONS` registry (real specs + gameplay + feel), `GRENADE`, `KNIFE` |
| `models/*.js` | one file per gun: `build(K, mats)` geometry + `handling` (poses, hand frames, clips) |
| `models/props.js` | knife, M67 grenade, 12 ga shell + generic melee / grenade clips |
| `geo.js` | modelling kit: chamfered boxes, lathe, bevelled extrusions, lofts (`profLoft` for stocks, `polyLoft` through arbitrary cross-section polygons), sweeps, screws, pins |
| `materials.js` | GPU-baked PBR gun finishes (steel = metalness 1 / dark F0 / roughness 0.34-0.54; oiled walnut with low coat + reduced specular; satin paints; case colours + engraving, knurl …), edge-wear shader, canvas markings, peep-sight defocus material (the rear aperture/drum fades around the hole while aiming, like the out-of-focus peep the eye sees) |
| `rig.js` | `modelData` cache, `GunRig` (bones = moving parts, one SkinnedMesh per material) |
| `hands.js` | procedural gloved hands + sleeved forearms (36 bones), finger poses, 2-bone arm IK |
| `anim.js` | keyframe clips (tracks + events), easing, allocation-free sampling |
| `viewmodel.js` | pose stack (hip / ADS from real sight alignment / sprint / wall / recoil springs / sway / step bob), hands, held props |
| `flash.js` | multi-layer additive muzzle flash (1 draw call per gun), per-style recipes |
| `casings.js` | instanced physical casings (.45, 9 mm, 5.45 lacquered steel, 7.62, 12 ga) with bounce + sounds |
| `grenade.js` | frag grenade physics (bounce, roll, spoon fly-off, fuse) → `combat.explode` |
| `sounds.js` | offline-synthesised sounds (`audio.register`) |
| `outline.js` | chalk outline (wall buys) + HUD icon canvases |
| `combat-mock.js` | stand-in combat for the sandbox |

## Integration
```js
import { WeaponSystem, WEAPONS, buildWorldModel, getOutline, getIcon } from './weapons/index.js';
const weapons = new WeaponSystem({ gfx, fx, audio, world, player, input, combat });
weapons.give('m1911');                 // start weapon; 2 slots, a 3rd give() replaces the current one
// per frame, after player.update (camera placed):
weapons.update(dt, time);
```
- Reads `input` (mouse 0 fire, mouse 2 ADS, R reload, V knife, G grenade, 1/2/wheel swap, `dx/dy` for sway), `player`
  (`eye`, `forward`, `sprinting`, `onGround`, `moveSpeed`, `stepDist`, `landDip`, `vel`), `world.raycast` (wall retract, casings, grenades).
- Writes `player.adsK` (0..1, the game narrows FOV / sensitivity with it), calls `player.addKick(pitch, yaw, roll)` and `player.addAim(pitch, yaw)`.
- `current` → ammo object `{ id, def, name, mag, reserve }`; `slots`, `grenades` (max 4), `spread` (rad, for the crosshair).
- `give / has / swap / reload / refillAll / addAmmo(id, n) / maxAmmo(id) / setPerks({ speedCola, doubleTap })`
  (Speed Cola = reload ×0.5 time, Double Tap = ×1.33 rate). Events: assign `onShot(id)`, `onReload(id)`, `onEmpty(id)`, `onSwap(id)`.
- Shots go to `combat.shoot(spec)` with `{ origin, dir, damage, range, pellets, spread, weaponId, tracer, muzzle, isShotgun, caliber,
  headshotMul, falloff, explosive, impulse }` (one preallocated object — do not keep a reference). Knife: `combat.melee({ origin, dir, range, damage })`.
  Grenade: `combat.explode(pos, radius, damage, { source: 'grenade' })`.
- `buildWorldModel(id)` → centred static `THREE.Group` (layer 0, casts shadows) for the mystery box / wall buys.
- `getOutline(id, size)` → chalk canvas (muzzle left); `getIcon(id, width)` → HUD silhouette canvas.
- ADS zoom: `gfx.setFov(player.fov * weapons.fovMul)` — `fovMul` = 1 / per-gun optical zoom (`spec.zoom`, 1.1 shotguns … 1.35 M14),
  eased exactly like the view-model's ADS blend.
- Ray Gun: the bolt's splash is NOT passed to `combat.shoot` (no `explosive` in the spec); the weapon system schedules it with
  `fx.schedule(distance / 220 m/s)` and detonates with its own green plasma burst (particles + light + `gun.raygun.impact`), then applies
  damage through `combat.zombies.explode(pos, r, dmg, {source:'raygun'})` (falls back to `combat.explode`).
- View-model light rig: during the view-model pass only, pooled lights closer than 1.3 m to the gun (the player's flashlight, the own
  muzzle-flash light, nearby lamps) are pushed out to 1.3 m along the same direction (spot lights x0.45) and restored right after
  (`scene.onBeforeRender/onAfterRender`, chained). Without it the flashlight 25 cm ahead of the eye blows the gun out to white.
- Held-gun IBL: three r186 ignores `material.envMapIntensity` without an own envMap, so the effective view-model IBL scale is the
  engine's global `gfx.vmEnv` (applied around the VM pass). Per-material IBL scaling, if ever needed, must go through onBeforeCompile.
- View-model fill (`VM_FILL` in materials.js, runtime `weapons.mats.vmFill.value` = rgb, floor): in the view-model pass only, the
  ambient + IBL terms of every gun/hand material are topped up to a dim cool floor (sky-weighted diffuse + reflection). Where the scene's
  own ambient/IBL is brighter (day, lit interiors) nothing is added; in blue-night / neon stops metal and wood keep some modelling.
- Cloth: glove / sleeve materials are rough (0.8-0.98), low-specular (physical, specularIntensity 0.3) with a grazing-angle sheen term.
- Loudness: everything the weapon system plays is trimmed by `GUN_TRIM` = 0.708 (-3 dB) on top of the weapon bus.
- Real-game captures on a loaded machine: `node tools/weapon-game.mjs <outPrefix> <map>:<steps.json> ... --boot 420` (views.mjs step format,
  several maps in sequence, one browser at a time, long boot timeout).
- Start-up: `new WeaponSystem()` builds the hands, props and the starting M1911 only; its gun-pattern materials get 1x1 placeholder maps
  while the uber pattern program compiles with `compileAsync`, then the real maps are baked 2-3 per frame and swapped in (same slots, no
  recompile). `weapons.ready` resolves when every queued bake has landed. The other guns are built one per ~80 ms slot right after
  construction (boot is then waiting on `world.warm()`), each pre-warmed with `compileAsync`; `weapons.prebuild(id)` builds one now
  (e.g. when the mystery box starts rolling). Later material requests are never baked synchronously.
- Baked detail: `bakeCavity()` (rig.js) stores per-vertex `aCav` = (ambient occlusion, convexity) on the rest-pose geometry of the whole gun;
  the gun shader darkens/roughens crevices and lets convex edges wear through first. Zero runtime cost beyond one vec2 attribute.
- Muzzle flash styles (flash.js, one draw call): pistol/smg tongues, rifle 5-slot star (M14), booster side plumes + forward blob (AKS-74U),
  shotgun fireball + smoke (870, Olympia), ray (green); petals are irregular turbulent sprites, visible for 1-2 frames.

## Sounds (all registered with `audio.register`, played on bus `weapon`)
`gun.<id>.fire` (4 variations) · `.fire.distant` (2) · `.dry` · `.draw` and per-gun reload foley:
m1911 `magout magdrop magin slide` · mp5 `magout magin chargeBack chargeSlap selector` · olympia `open eject shellIn close hammer` ·
m14 `magout magin bolt boltBack` · ak74u `magout magin boltBack boltFwd selector` · remington870 `pumpBack pumpFwd shellIn` ·
raygun `charge cellOut cellIn impact`. Generic: `wpn.melee.swing/hit`, `wpn.grenade.pin/throw/bounce`; casing sounds use `audio.casing()`
when the engine provides it. Offline analysis (we cannot listen here): `node tools/weapon-audio.mjs out/au --filter gun. --spectro gun.m14.fire`.

## Clips
`{ dur, events: [[t, type, arg]], tracks: { gun: [[t, [x,y,z, rx,ry,rz deg], ease]], <part>: [...], L|R: [[t, handKey]], holdL|holdR: [[t, 'propId']], vis: [[t, {part: scale}]] } }`.
Hand keys: `{ f: frameName | 'rest', p, r, pose }` (frame on a gun part, follows it) or camera-space `{ c, fd, pn, pose }`.
Events: `snd`, `eject`, `ejectShells`, `shell`, `magFill`, `lock`, `unlock`, `melee`, `throw`, `pin`.

## Budget
View-model (measured in the sandbox, round 3): 10–13 draw calls, 27.4k–37.5k triangles (gun 10.2k–20.3k + both arms 17.3k).
`new WeaponSystem()` ≈ 0.46 s in the sandbox, 1.0–2.2 s in the real game on this shared machine (load average 7–13); textures ready
≈ 2.8 s (sandbox) to 6–15 s (game, under load); all 7 guns built ≈ 5.4–8.3 s after construction. No per-frame allocations in `update` /
fire paths on our side (core `fx.puff/spark/emit` allocate per particle internally).
Measured fire rates (60 fps sandbox): MP5 800 rpm, AKS-74U 693, M1911 384 (trigger-limited), M14 401 (semi, trigger-limited),
Olympia 295 (trigger), 870 one shot / 0.8 s (pump), Ray Gun 185.
