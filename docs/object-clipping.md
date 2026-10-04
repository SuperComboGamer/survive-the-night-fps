# Object clipping: how to check it, fix it and show it

Read this before you touch any model, the first-person viewmodel (hands and held items), anything a survivor holds or
wears, the ground items, or where the world puts its props. It is the workflow the clipping pass (the `clipping-pass`
PR) worked out, and the tools it left in `scripts/clip/`. Follow it step by step: survey, fix, re-measure, check what
shares the change, show before and after, check in the real game, run the tests.

Every model in this game is procedural three.js code. There are no model files to open in an editor: a hand pose is
a table of finger angles, a grip is a point and an orientation, an animation is a few keyframes and curves, and a
world is built from a seed. So a clip is fixed in code, and it is measured in code too.

## Contents

1. [What counts as a clip](#what-counts-as-a-clip)
2. [Where everything lives](#where-everything-lives)
3. [The tools](#the-tools) (`scripts/clip/`)
4. [The sandboxes](#the-sandboxes) (every query parameter)
5. [The workflow](#the-workflow)
6. [Fixing each kind of clip](#fixing-each-kind-of-clip)
7. [The rules](#the-rules)
8. [Presenting the PR](#presenting-the-pr)
9. [Where things stand](#where-things-stand) (the numbers, and the backlog)
10. [Checklist](#checklist)

## What counts as a clip

A clip is one solid drawn inside another where the eye can see it. It is measured as the depth, in mm, of the deepest
vertex of one model inside the other.

| Depth | What it looks like | What to do |
| --- | --- | --- |
| under 3 mm | invisible at play distance (about a glove's thickness) | nothing |
| 3 to 8 mm | shows on a close look, or in a still | fix it if it is in a held pose or on screen for long |
| over 8 mm | a finger visibly through a gun, an arm through a body | fix it |

The survey counts frames over 3 mm and over 8 mm. Depth alone can mislead: a 40 mm clip of 7 vertices (a fingertip
grazing an edge for one frame of a throw) matters less than a 15 mm clip of 1,200 vertices (a palm buried in a
handguard in every idle frame). The report gives both the depth and the vertex count.

The kinds of clip found so far, with an example of each:

- **First-person hand vs held item.** Fingers or the palm inside the item: every throwable was held in a fist made for
  a 3 cm handle and sank 19-38 mm in; the support hands were 20-35 mm into every handguard.
- **First-person hand vs hand.** The two hands, or a hand and the other forearm, inside each other: the pistol's rack
  put the left forearm 56 mm through the right hand; the bat swing crossed the arms.
- **Forearm or sleeve vs item.** A gun's stock or butt through a forearm in a shove or a reload.
- **Item vs the camera's near plane.** The viewmodel's near plane is 0.01 m; the clip check reports how close anything
  comes (`nearZ`). Nothing has reached it so far.
- **Viewmodel vs the world.** The viewmodel is drawn in its own pass over the world (renderer.js: depth cleared, its
  own camera, near plane and field of view), so the world never cuts into it. But a blade or a muzzle drawn over a
  wall or a car boot nearer than its tip reads as gone into it. The fix is the tuck (below).
- **Third person: held item vs the body.** A shouldered gun's butt 12-13 cm into the arm, the RPG's tube through the
  shoulder, a grenade through the fist.
- **Worn gear vs the body.** The worn backpack swinging into the lower back when looking up or downed.
- **Ground items.** Sunk into the ground (sticks 24 mm) or floating (the frag grenade 13 mm up).
- **Parts of one model inside each other.** A fallen drink can's lid in the standing can, two RPG grenades crossed
  through each other, a jacket's folded sleeves through each other.
- **World props inside each other.** A street lamp up through a wreck, a truck parked in a sandbag wall, a crate
  through a shed wall, a boulder 2 m into the mine's masonry.

## Where everything lives

**First person: `client/render/models/weapons.js`.** The whole viewmodel is here.

- `BUILDERS` and the `build*` functions: each item's model, authored in weapon space. The origin is the right hand's
  grip and the barrel or blade points along -Z. Guns: the pistol grip runs up +Y through the fist. Melee: the handle
  runs along Z. Throwables: the long axis is +Y.
- `HAND_POSES`: every hand pose. Each has `curl` (four fingers by three joint angles), `spread`, `thumb` (two segment
  directions), and `center` (where the grip sits in the hand: the wrist is placed so this point is on the item's grip).
  Hand space: the wrist is at the origin, the fingers point along -Y and the palm faces -X. The left hand is the right
  one mirrored in X. The shared poses (`grip`, `trigger`, `cup`, `support`, `pinch`, `open`, `knife`, `radio`) come
  first, then the poses fitted to one item each (`ball`, `bottle`, `akSupport`, `wristGrip`, `batR`, `kitHold`,
  `akMag`, `rackPinch`, ...). `VMArm.hand()` builds a pose's mesh the first time it is shown, so a pose costs nothing
  until its item is held.
- `FINGERS`, `PHALANX_R`, `THUMB_MCP`, `getHandGeo`: the hand's geometry. These are exported through `VM_DEBUG` for
  the grip fitter.
- `VM`: each item's viewmodel setup. `hip` is the pose at the hip, `rGrip`/`lGrip` are the grip points and hand
  orientations in weapon space, `rPose` and `lGrip.pose` name the hand poses, `poleR`/`poleL` point the elbows,
  `magPose` is the hand on the magazine in a reload, `swingPoleL` drops the left elbow in a two-handed swing, and
  `sprint`, `recoil` and `talk` are offsets.
- `SWINGS` (melee keyframes), `_animReload` (every reload), `_animThrow`, `_animUse` and `useItem` (the props being
  used: kit, tin, meat, drink, each with its own `usePose`).
- The reload hand blend: a reload moves the left hand from the grip to point A, then to point B (`st.a`/`st.b`,
  `st.m`, weight `st.w`). `st.poseA`/`st.poseB` are the hand poses at each point, and the grip centers blend between
  them (`_blendCenter`). `st.arc` sends the hand round something on the way. `st.poleA`/`st.poleB` move the elbow.
  The named arcs and poles are module constants: `PISTOL_RACK_POLE`, `PISTOL_RACK_ARC`, `DB_LOAD_ARC`, `DB_LOAD_POLE`,
  `RIFLE_RELOAD_ARC`, `XBOW_HAUL_POLE`, `SHOVE_POLE_R`.
- The tuck off a wall: `TUCK` (per kind of item, the most it moves), `TUCK_GAP`, `TUCK_RANGE`, `_itemReach`, and
  `s.wallDist` in `ViewModel.update`.
- `THROW_RELEASE`: the moment of the throw at which the item leaves the hand and the hand opens.

**The wall distance: `client/game/game.js`.** `Game.weaponClearance` casts two short rays from the eye (`WC_RAYS`:
straight on, and out past the right hand) and passes the distance to `vm.update` as `wallDist`.

**Third person: `client/render/models/characters.js`.** `SurvivorInstance`:

- `setWeapon` puts the world model (`createWorldWeapon`) on `mount`, under the right hand. Guns are held barrel along
  the forearm and melee weapons handle through the fist. Throwables are moved out to the palm by their radius
  (`THROW_RADIUS`, `FIST_PALM_X`).
- `holdFor` maps an item to a hold category (rifle, pistol, melee, throw, radio).
- `solveArms` works out each hold: where the grip is in chest space, how the weapon points, and the two-bone IK for
  each arm. Shouldered guns go forward until the butt ends at `STOCK_POCKET`, measured from the model's reach behind
  the grip (`stockZ`). `RPG_LIFT` raises the RPG onto the shoulder.
- `hangPack`, with `PACK_PIVOT` and `PACK_HANG`: the worn backpack hangs from its straps.
- `poseSwim`, `sitW` and the downed pose (Entities tips the body): the poses the held item and the pack must survive.

**Worn backpack: `client/render/models/backpack.js`.** `WORN_AT` is where it sits on the chest bone.

**Ground items: `client/render/models/pickups.js`.** `createPickup` builds each item. Items built in `BUILD` are set
down on the ground by their lowest vertex (`REST_SINK`, `REST_LIFT`, `REST_AT`). Weapons and throwables are laid on
their side by `weaponPickup` (`HELD_LAY`), placed by their own vertices.

**World placement: `shared/world.js`, `shared/rail.js`, and the other place files** (`clinic.js`, `cemetery.js`,
`fair.js`, `mine.js`):

- `Builder.prop`, `Builder.wreck`, `Builder.cont`: a place's props at fixed spots in its frame. A clip here is fixed
  by moving the prop.
- `propBlocked`: road dressing (power poles, signs) is left out where it would stand in a prop.
- `SITE_ROOM`: a roadside or woodland site is not built within this distance of a place's solid prop.
- `occupy` and `occupied`: the room vegetation keeps from props.
- `partBlocked`: a tree or a boulder that would stand in a wall is left out after its random draws, so the rest of the
  forest stays put.
- `shared/props.js`: every prop's collider boxes and cylinders, which are its solid shape for these checks.

**The sandboxes: `client/sandbox/`.** `models-test.html` loads `models-vm.js` (`?vm=`, `?ww=`), `models-hold.js`
(`?hold=`), `models-film.js` (`?film=`) or `models-lineup.js` (the rest). `props-test.html` loads `props-test.js`.

## The tools

All of these are in `scripts/clip/`, and each has its usage at the top of the file. They run headless and keep out
of the way of whoever is using the machine:

- Chrome runs `headless: 'new'`, off screen and muted, with a fresh `stn-chrome-*` profile in the temp folder that is
  deleted afterwards.
- Pointer lock is stubbed out in every page.
- Every browser, Vite server and game server a tool starts is stopped in a `finally`.
- Each tool starts its own Vite or game server on a free port.

Output goes to `shots/clip/`, which is gitignored. Set `CHROME` if Chrome is not where `lib.js` looks, and `ANGLE`
to `swiftshader` to force software rendering.

| Tool | npm script | What it does |
| --- | --- | --- |
| `survey.js` | `clip:survey` | Measures every item in every state: first person, third person, ground items. Writes `shots/clip/survey/here.json` and `.csv`, and prints the counts and the worst frames. `--against <tree or git ref>` measures another build too and prints the worst frame per item in each. `--save-baseline` and `--baseline` gate a PR (exit 1 when a frame gets worse). |
| `pairs.js` | `clip:pairs` | Before/after panels from two builds with the same camera, pose and clock. Takes a JSON list (see `pairs.example.json`). By default the "before" is a temporary worktree of origin/main. |
| `game-shots.js` | `clip:game` | Shots in the real game: a built server, admin `/give` and `/tp`, one or two clients. `--before <tree>` composes pairs. See `game-shots.example.json`. |
| `fit-grip.js` | `clip:fit` | Fits a hand pose to an item's mesh and prints the pose to paste into `HAND_POSES`. |
| `props.js` | `clip:props` | World props, trees, boulders and walls inside each other, over many seeds, with the `/tp` to each. |
| `pickups.js` | `clip:pickups` | Every ground item's lowest point: sunk or floating. |
| `lib.js` | | The shared plumbing: arguments, servers, headless Chrome, image sheets, worktrees, lending the sandbox to an older tree. |

Examples:

```sh
npm run clip:survey                                        # everything: about 700 frames, 10-15 minutes
npm run clip:survey -- --item grenade,molotov --sections fp
npm run clip:survey -- --against origin/main              # and origin/main (a temporary worktree), side by side
npm run clip:survey -- --against ../stn-main               # or another checkout
npm run clip:survey -- --save-baseline shots/clip/base.json
npm run clip:survey -- --baseline shots/clip/base.json     # exits 1 if a frame got worse
npm run clip:fit -- grenade                                # how the grenade's hand pose fits now
npm run clip:fit -- ak47 --side L                          # the AK's support hand
npm run clip:fit -- 61 --side L --act reload --t 0.69 --base support   # the hand on the AK's magazine
npm run clip:props -- --seeds 1-100 --show "wreck|streetlight"
npm run clip:pickups
npm run clip:pairs -- scripts/clip/pairs.example.json
npm run clip:game -- scripts/clip/game-shots.example.json --before ../stn-main
```

How the clip check measures: every mesh here is a union of closed shells. Each vertex of one model casts four rays
into the other. If three or more first meet a back face, the vertex is inside, and the shortest such ray is its
depth. Only vertices the camera can see are counted, because the upper arms and the gun stocks reach behind the eye.
A part modelled inside out would read as everything outside being inside, so rays from far outside are checked too
and the report flags it (`INSIDE-OUT FACES`; the survey names the items). Today the frag grenade, the noisemaker, the
molotov, the hunting rifle, the anti-tank rifle and the flare gun have a few such faces (1 ray in 400; the
noisemaker about a quarter of them: its bells are open cups); their
numbers hold up, because the faces are small, but look at them by eye.

How the grip fitter works (`grip-lib.js`): it builds the real `ViewModel` under node (`dom-stub.js` stands in for the
DOM), poses it the way the sandbox does, and voxelises the item (1.5 mm) into a signed distance field in the hand's own
frame. Then it:

1. moves the grip center along the palm normal until the palm and the thumb's base sit 0.6 mm off the surface,
2. closes each finger until it, or a joint past it, touches,
3. searches the thumb's two directions for a lie close to the base pose's and clear of the item.

It prints each part's clearance before and after: negative is inside, and touching is about +0.5. `--search` finds
the snuggest fit for each finger (use it for odd shapes, like a pistol grip under a trigger guard). `--open` keeps the
base pose's character (it opens the fingers until clear, then closes the free outer joints). `--keep 0` leaves the
index finger as it is, for a trigger finger. `--dy`/`--dz` slide the grip first.

## The sandboxes

Serve the client with Vite from the repo root: `npx vite` (vite.config.js has `root: 'client'`), then open
`http://localhost:5173/sandbox/models-test.html?...`. The tools start their own server, so you only need this to look
by hand.

### `?vm=` the first-person viewmodel (`models-vm.js`)

| Parameter | What it does |
| --- | --- |
| `?vm=ID` | the item (an `ITEM` id). `?vm=claws` is a zombie's claws, `?vm=all` a grid of every item, `?vm=0` empty hands (for `act=use`) |
| `&act=` | `fire`, `reload`, `melee`, `heavy` (knife stab), `throw`, `use`, `ads`, `sprint`, `walk`, `crouch`, `jump`, `look`, `talk` (the walkie keyed) |
| `&use=ID` | with `act=use`: the consumable (food shows the tin, venison the meat, the drink its can) |
| `&t=S` | freeze the clock S seconds after the action starts (it starts after a 0.6 s draw; `t=-0.45` is mid-draw). Makes the frame deterministic. |
| `&ts=a,b,c` | a grid of the same item frozen at several times |
| `&orbit=yaw,pitch,dist[,x,y,z]` | an outside camera orbiting a point (view space) |
| `&wcam=yaw,pitch,dist[,x,y,z]` | a camera orbiting a point in weapon space (yaw 0 from behind, pi/2 from the gun's right) |
| `&ortho=halfHeight` | orthographic, with `&wcam` |
| `&clip=nx,ny,nz,d` | cut away everything past a weapon-space plane (with `&wcam`). With one number, see `&clip=1` below. |
| `&crop=x,y,h` | magnify part of a 16:9 view (left, top, height in screen heights) |
| `&zoom=fov,x,y,z` | from the eye, narrowed onto a view-space point |
| `&zh=R\|L,fov` | from the eye, narrowed onto that hand wherever the animation has it |
| `&oh=R\|L,yaw,pitch,dist` | an outside camera orbiting that hand (the far side of a grip) |
| `&hide=L\|R\|LR`, `&hidegun` | hide an arm, or the item |
| `&light=game` (`&ldir=x,y,z`) | the in-game viewmodel lighting instead of the studio lights |
| `&wall=M` | a wall M metres ahead of the eye: shows the tuck |
| `&clip=1` | the clip check. `window.__clip` is a list with one entry per view: `{ handInItem, itemInHand, rInL }`, each `{ d (m), a, b (the two parts, e.g. R.hand > item.body), n (vertices inside), p (the deepest, view space) }`, plus `nearZ` (nearest approach to the camera, view-space z), `inverted` (outside rays meeting back faces), and `text` (all of it in one line, in mm) |
| `&dots=1` | with `&clip=1`: mark every vertex found inside, in red |
| `&xray=1` | the item and a used prop see-through, drawn over the hands: a buried finger shows |
| `window.__hands` | `{ R, L }`: each hand's grip center (view space) once posed. `pairs.js` reads it to aim at the hand where the before build has it. |

Tuning overrides, to try a change without editing weapons.js (the item is `?vm=`'s):

| Parameter | What it overrides |
| --- | --- |
| `&hip=x,y,z,rx,ry,rz` | the item's hip pose |
| `&rg=` / `&lg=px,py,pz,fx,fy,fz,nx,ny,nz` | the right / left grip: point, finger direction, palm normal (weapon space) |
| `&rpose=` / `&lpose=` | which hand pose each hand uses |
| `&hp=pose:{json}` | override part of a hand pose, or add a new one (several allowed), e.g. `&hp=ball:{"center":[-0.05,-0.075,0]}` |
| `&thumb=pose:x1,y1,z1,x2,y2,z2` | a pose's thumb directions |
| `&pole=rx,ry,rz,lx,ly,lz` | the elbow pole vectors |
| `&cq=rx,ry,rz` | the left hand on the charging handle |
| `&fgr=` / `&fgq=` | the flare gun's reload pose and loading hand |
| `&claw=x,y,z,rx,ry,rz` | the claws' idle pose |
| `&mat=glove:r,g,b;...` | hand and sleeve colours |

Other modes: `?vm=hands` lines up the hand poses (`&poses=a,b`, `&yaw=`, `&pitch=`, `&cd=`). `?ww=1` is the world
weapon lineup (`&item=ID`, `&view=back`).

Examples:

- `?vm=33&t=1&zoom=22,0.13,-0.12,-0.3&xray=1`: the grenade in the hand, close up, see-through.
- `?vm=61&act=reload&t=0.69&clip=1&dots=1`: the AK's reload at 30%, with the clipping vertices marked.
- `?vm=61&t=1&hp=akSupport:{"center":[-0.07,-0.088,0]}`: try a support-hand change.
- `?vm=0&act=use&use=21&t=0.9`: using a medkit.

### `?hold=` third person (`models-hold.js`)

| Parameter | What it does |
| --- | --- |
| `?hold=ID` | what is in the right hand (0: nothing) |
| `&pose=` | `idle`, `walk`, `sprint`, `crouch`, `crouchwalk`, `lookup`, `lookdown`, `reload`, `fire`, `melee`, `throw`, `downed`, `seated`, `swim`, `air` |
| `&t=S` | the clock. For `fire`, `melee` and `throw` the action starts at 1 s and t is the time after it. Use 1.15 for a walk or sprint mid-stride. |
| `&pack=1` | wearing the backpack |
| `&seed=N` | which survivor |
| `&cam=yaw,pitch,dist[,dx,dy,dz]` | orbit the right hand (yaw 0 from the front) |
| `&cam=body,yaw,pitch,dist` | orbit the chest (the whole figure) |
| `&clip=1` | `window.__clip = { itemInBody, bodyInItem, bodyInPack, itemInFist, text }`, each `{ d, n, what }`. `what` is the bone a body vertex follows (`chest`, `spine`, `farmR`, ...). The third-person fists are solid blocks closed round a handle, so a handle inside one is how it is held: `itemInFist` is reported on its own and the survey leaves it out of a frame's worst. Look at a fist by eye (`&xray=1`): an item much wider than the fist (a grenade) should sit against its palm side, not through it. |
| `&dots=1`, `&xray=1` | as in `?vm=` |

### Other sandboxes

- `?surv=1` (the lineup): every survivor holding every item. `&items=61,60` picks them, `&zombie=1` zombifies them.
- `?pack=poses` (`&cam=back`): the worn pack in six poses. `?pack=ground`: the pack on the ground.
- `props-test.html?cat=sheet&set=pickups&names=STICK,GRENADE&cols=2&rows=1&pitch=6&bright=1&zoom=1.2`: ground items
  in a grid. Use `pitch=6` to look along the ground (sinking and floating show) and `pitch=35` from above (parts inside
  each other show).
- `props-test.html?cat=sheet&set=props&names=car_wreck,streetlight`: props.

## The workflow

### 1. Survey first, and write down every clip

```sh
npm run clip:survey -- --save-baseline shots/clip/base-before.json
```

Read the worst frames, then look at each one with your own eyes: open its sandbox URL with `&xray=1` and `&dots=1`,
and an outside camera (`&oh=` or `&orbit=`). Many clips can only be seen from the far side of a grip. Write a list:
the item, the state, what is in what, the depth and vertex count, and how bad it looks. Look at the survey's
screenshots too (`--shots`). The numbers find candidates; your eyes decide.

Also run `npm run clip:pickups`, `npm run clip:props -- --seeds 1-100`, and look at every ground item in the props
sheet from low and from above.

### 2. Fix each clip with the right tool

See [Fixing each kind of clip](#fixing-each-kind-of-clip). Make the smallest change in the existing style. Try it in
the sandbox with the URL overrides before you edit the code.

### 3. Re-measure

Run the survey again on the items you changed (`--item`), and then on everything.

### 4. Check what shares the change

A hand pose, a grip, an elbow pole, a reload branch (all rifles share one) or a hold category in characters.js is
shared by other items. A change for one item can break another. Re-survey all of them, compare against the baseline
(`--baseline shots/clip/base-before.json`), and look at the frames that moved.

### 5. Before and after, from origin/main

```sh
npm run clip:pairs -- my-shots.json      # the before comes from a fresh worktree of origin/main
```

Write a panel for every fix. Use the same camera, pose and clock: pairs.js aims hand cameras at where the hand is in
the before build. For world fixes, take game shots on a fixed seed at the same spot (`props.js --show` prints the
`/tp`).

### 6. Check in the real game

```sh
npm run clip:game -- my-game-shots.json --before <worktree of origin/main>
```

At least: first-person shots of the items you changed (a throw's wind-up and release if you touched a throwable),
an item held against a wall and a car, and a second client watching a first one for the third person. The game
server runs with `NODE_ENV=production`, an admin secret (`/admin <secret>`, said for you, unlocks `/give`, `/tp` and
the rest), godmode, a fixed seed and a long day.

### 7. Run the tests

`npm test` (and its posttest). `scripts/test-world.js` checks that no two solids in a place go into each other. On a
change that moves world placement, a test that walks to a seed's supply (`test-analytics.js`) can find a different
one first; fix the test's assumption, not the world. Do not bump `PROTOCOL_VERSION` or any version number.

## Fixing each kind of clip

**A finger or palm inside an item (first person).** Give the item a hand pose of its own, fitted to it:

```sh
npm run clip:fit -- <item> [--side L] [--act reload --t 0.69]
```

Paste the printed pose into `HAND_POSES` under a new name and set it as the item's `rPose` (or `lGrip.pose`, or
`magPose` for a reload hold). A pose built for a 3 cm handle cannot hold a 6 cm grenade: do not try to tune a shared
pose until it fits everything. If the fit leaves a finger far out (a loose look) or the thumb was kept, look at it with
`&hp=` and try `--search`, `--open`, `--loose`, or `--dy`/`--dz` to slide the grip. A pistol grip needs the hand
lower, under the trigger guard, with a straight index finger (`--keep 0` on a base whose index is straight).

**A hand moving through the item between two holds (a reload, a swing).** In `_animReload`:

- give A and B their own poses (`st.poseA`/`st.poseB`: their grip centers blend, so the switch does not jump the hand),
- route the move round the item (`st.arc`: an offset at the middle of the move, and on the way back to the grip),
- move the elbow out of the way (`st.poleA`/`st.poleB`, `cfg.swingPoleL`, `SHOVE_POLE_R`).

Fix the hold at the end of the move with the fitter. Change keyframe timing only if the move itself is wrong.

**One hand or forearm through the other.** Usually an elbow pole: the IK bends the arm toward the pole, so pointing it
out to the side takes the forearm off the other hand. Try `&pole=` in the sandbox.

**An item drawn over a wall (first person).** The tuck handles this: `TUCK`, `TUCK_GAP` and `TUCK_RANGE` in weapons.js,
and `WC_RAYS` in game.js. A new kind of item needs a `TUCK` entry. Never draw the viewmodel into the world's depth: it
is in its own pass so the world never cuts it.

**Third person, item vs body.** Change the hold in `solveArms`, the mount offset in `setWeapon`, or the constants
(`STOCK_POCKET`, `RPG_LIFT`, `THROW_RADIUS`). Third-person hands are simple fists, so move the item rather than fit
fingers. Check every pose: look up and down, crouch, walk, sprint, downed, seated.

**Worn gear vs body.** `hangPack`, `PACK_HANG`, `WORN_AT`. Check `?pack=poses` and the survey's `-pack` frames.

**A ground item sunk or floating.** `createPickup` sets `BUILD` items down on their lowest point. A new weapon-style
pickup goes through `weaponPickup`. Run `npm run clip:pickups`.

**Parts of one model inside each other.** Move the part in its builder, keeping its size. Check it from two sides in
the props sheet.

**World props inside each other.** For a place's own props, move the one that is in the way (by as little as clears
it). For anything scattered (road dressing, sites, vegetation), use the placement rules (`propBlocked`, `SITE_ROOM`,
`occupy` radii, `partBlocked`). A rule that skips something should skip it after its random draws, so nothing else on
the seed moves. Run `npm run clip:props -- --seeds 1-100` and `node scripts/test-world.js`.

## The rules

- **Never shrink, scale or hide an item to hide a clip.** Real-world scale is fixed: a 6.4 cm grenade stays 6.4 cm.
  Move the hand, the grip or the item, never the size.
- **Don't redesign the art.** Make the smallest change in the existing code style. No new models when a pose or an
  offset will do.
- **One shared change can break other items.** Re-survey all of them after changing a shared pose, grip, pole, reload
  branch or hold category, and compare against the baseline.
- **World placement changes change worlds.** Moving a prop or a placement rule changes what a seed builds. Say so in
  the PR, and say how much changed (how many seeds, what moved).
- **No version bumps.** Not `PROTOCOL_VERSION`, not package versions: the owner (Cody) does those. Clipping fixes need
  no wire changes.
- **Strict headless isolation.** People use these machines while agents run. Use the tools as they are: headless
  `new`, off screen, muted, a temporary profile deleted after, pointer lock stubbed out, every browser and server
  stopped in a `finally`, and no processes or temporary worktrees left behind. Never open a visible browser window,
  steal focus or lock the cursor.
- **Measure, then look.** The survey finds candidates and your eyes decide. A deep clip of a few vertices for one
  frame can be fine; a shallow one across a whole palm in every idle frame is not.

## Presenting the PR

- **A before/after panel for every fix** (pairs.js): before on the left, after on the right, normal view plus close-up
  plus x-ray for hands, with a title naming the item and state.
- **A contact sheet** of every after shot (pairs.js writes `00-overview-after.png`).
- **A table of the numbers**: the survey's counts before and after (frames over 3 mm and over 8 mm, per section),
  and the worst frame per item before and after (`survey.js --against`).
- **Images are not committed to the code branch.** Put them on a separate `pr-images-*` branch of the fork and link
  them from the PR body by raw URL. `shots/` and `docs/pr-images/` are gitignored.
- **A "not fixed, and why" list**: every clip left over 8 mm, with the reason (an animation path that needs keying by
  hand, a few vertices for one frame, ...).
- **A "needs a human eye in motion" list**: what a still cannot show. Pose switches mid-animation, a new elbow swing,
  how a tuck eases, the third person in motion.
- **The world changes**, if any: what moves, and on how many seeds.

## Where things stand

Measured with `npm run clip:survey -- --against origin/main` and `npm run clip:props -- --seeds 1-100` on the
`clipping-pass` branch, against origin/main as it was then (c367908):

| | origin/main | after the pass |
| --- | --- | --- |
| first person (353 frames): over 3 mm | 305 | 96 |
| first person: over 8 mm | 286 | 51 |
| third person (284 frames): over 3 mm | 142 | 134 |
| third person: over 8 mm | 142 | 128 |
| ground items (70): sunk or floating | 16 | 0 |
| world overlaps, seeds 1-100 (props, trees, boulders and walls; not counting sandbag on sandbag) | 2213 | 0 |

The third-person count fell little, but the depth did: the worst frame per item went from 128-151 mm to 22-57 mm
for every shouldered gun except the RPG, which is still 134 mm when downed. Most of the third-person frames still
over 8 mm are the worn pack's straps against the jacket (30-50 mm, in every pose, as on origin/main) and long guns
looking down or mid-stride.

Fixed: every throwable's hand; every gun's support hand and right hand; every melee handle; the used items; every
reload's hand holds and pose switches; the pistol rack; the bat swing; the double-barrel reload; the rifle reload
returns; the long-gun shove; the crossbow haul; the flare gun and walkie-talkie; third-person shouldered guns, the
RPG, throwables and the worn pack; ground items; the world prop overlaps; and the tuck off walls.

The backlog: what is still over 8 mm, for the next pass to pick up. Most of it is animation paths that need keying
by hand rather than new grip poses.

| Item / state | Depth | What |
| --- | --- | --- |
| noisemaker throw, 30-38% | ~40 mm, 7-11 vertices | the palm against the clock in the wind-up |
| anti-tank rifle reload, 62% | 40 mm | the left forearm in the body |
| RPG reload, 42-52% | 19-26 mm | the left hand in the grenade as it lifts it |
| AK reload, 72% | 25 mm | the magazine against the palm |
| crossbow reload, bolt loading | ~22 mm | the left hand in the tiller |
| hunting rifle reload, 42-62% | 19-23 mm | the left hand / forearm in the stock |
| bat / spiked bat swing | 16-24 mm | the knob against the left cuff |
| machete swing end | 21 mm | the blade's butt past the forearm |
| flare gun reload | 15-20 mm | the loading hand in the barrel / shell |
| double-barrel reload | 17 mm | the shell against the forearm |
| magazines in reload (M4, MP5, flamethrower) | ~12 mm | the magazine's edge in the palm |
| pump shotgun shell insert | 11 mm | the shell in the fingers |
| knife | 6.7 mm | the handle in the palm (origin/main's own fitted pose; left alone) |
| third person: shotguns looking down | 57 mm | the stock in the arm |
| third person: M4 / MP5 walking | 33 mm | the stock in the arm mid-stride |
| third person: RPG aimed well up, or downed | | the tube still crosses the shoulder |
| third person: worn pack looking up | 46-50 mm | the pack's bottom against the back |
| third person: items in the hand while downed | ~25 mm | the item against the body |
| third person: the worn pack, every pose | 30-50 mm | its shoulder straps and back panel into the jacket |
| third person: flamethrower, idle | 46 mm | the gas bottle stock in the arm |

## Checklist

- [ ] Surveyed before changing anything: `npm run clip:survey -- --save-baseline ...`, pickups, props
- [ ] Looked at every clip with my own eyes (x-ray, dots, an outside camera) and listed it
- [ ] Fixed each with the right tool: a fitted pose, an arc or pole in the animation, a mount offset, a rest pose, a
      placement rule
- [ ] No item shrunk, scaled or hidden; no art redesigned
- [ ] Re-surveyed everything, compared against the baseline, and checked the items that share what I changed
- [ ] Before/after panels from a worktree of origin/main, with the same camera, pose and time, plus a contact sheet
- [ ] Checked in the real game: first person, against a wall and a car, and a second client for the third person
- [ ] `npm test` passes (or the failures are on origin/main too, and named)
- [ ] No version numbers touched
- [ ] No browser, server, temporary profile or worktree left behind
- [ ] PR: images on a `pr-images-*` branch, a numbers table, "not fixed and why", "needs a human eye in motion", world
      changes named
