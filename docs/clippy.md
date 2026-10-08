# Clippy: build models that don't clip

Read this before you build or change a model, a hand pose, anything a survivor holds or wears, a ground pickup, a
prop, or where the world places one. It covers how to build a model so it doesn't clip. Once a clip is already there,
[object-clipping.md](object-clipping.md) explains how to measure it, fix it and present the fix, and documents every
tool flag and sandbox parameter used below.

Every model here is procedural three.js code. There are no model files. A hand pose is a table of finger angles, a grip
is a point and an orientation, and a world is built from a seed. So build in code, and measure in code. Don't judge a
model by eye from one camera.

## The budget

A clip is the depth of the deepest vertex of one solid inside another, where the eye can see it.

| Depth | Verdict |
| --- | --- |
| under 3 mm | invisible at play distance: done |
| 3 to 8 mm | shows in a still: fix it if it is in a held pose or on screen for long |
| over 8 mm | a finger through a gun: fix it |

A new or changed item ships under 3 mm in every state the survey draws it in. Explain any frame over that in the PR.

## 1. Build at real scale, in the right space

- **Real size, in metres.** A 6.4 cm grenade is 0.064. Never shrink, scale or hide anything to get rid of a clip. Move
  the hand, the grip or the item instead.
- **Weapon space** (`client/render/models/weapons.js`; the world, held and ground models all share it). The origin is
  the centre of the right hand's grip, where the palm wraps. The barrel or blade points along -Z, and up is +Y.
  - Guns: the pistol grip runs up +Y through the fist.
  - Melee: the handle runs along Z through the fist, with the edge or face toward -Y.
  - Throwables: the long axis is +Y.

  The hand and the third-person mount are both placed on that origin, so a model built off it is held off it.
- **Hand space** (`HAND_POSES`): the wrist is at the origin, the fingers point along -Y and the palm faces -X. The left
  hand is the right one mirrored in X.
- **Prop space** (`shared/props.js`): the origin is at ground level in the centre of the footprint, and the front
  faces -Z. The model fills `size`. The `boxes` / `cyls` colliders are the prop's solid shape for every clip check, so
  **keep the mesh inside its colliders**, or grow the colliders. A part that pokes outside them can sit in a
  neighbour without any test seeing it.

## 2. Make every part a closed, outward-facing shell

The clip check casts rays from each vertex and counts back faces. A model has to be a union of closed shells with
their faces pointing out. An open or inside-out part makes its numbers meaningless, and the check prints
`INSIDE-OUT FACES`.

- Closed: `box`, `ellip` (the whole sphere), `seg` (caps on), `boxR`, `cylZ`, `barrelZ` (its bore has a bottom),
  extrusions (`profile`, `plateY`), and a `lathe` / `latheY` / `latheZ` whose profile starts and ends at radius 0.
- Open: an `ellip` cut short with `t0` / `tl`; a lathe profile that leaves the axis open at either end; `spike` with
  `open: true`; `tube`, which caps only its far end (bury its start inside another part); and a thin folded cup like
  the noisemaker's bells.
- Mirror with `mirrorX`, which flips the winding. A bare negative scale turns a part inside out.
- Parts of one model may overlap where they are hidden (a barrel sunk into the receiver). Where the eye can see the
  overlap, it counts as a clip: a fallen can's lid inside the standing can, or two RPG grenades crossing.

## 3. A new held item: first person

1. Add the builder to `BUILDERS`, built in weapon space at real size.
2. Add a `VM` entry. `kind` (`rifle`, `shotgun`, `pistol`, `melee`, `throw` or `radio`) picks the animations and the
   `TUCK` off walls. A new kind needs its own `TUCK` entry. `rGrip` / `lGrip` are the grip points.
3. **Give every hand on it a pose fitted to it.** Start `rPose` (and `lGrip.pose`, and `magPose`) on the nearest
   shared pose, then:

   ```sh
   npm run clip:fit -- <item>                               # right hand
   npm run clip:fit -- <item> --side L                      # support hand
   npm run clip:fit -- <item> --side L --act reload --t 0.69 # a reload hold
   ```

   Paste each printed pose into `HAND_POSES` under a new name and point the `VM` entry at it. Every clearance it
   prints should be >= 0. Never reuse a shared pose for a different shape: `grip` is a fist made for a 3 cm handle,
   and every throwable held in it sank 19-38 mm. Never tune a shared pose to fit your item either, because it breaks
   every other item that uses it.
4. **Don't pose by eye from the player's seat.** The old support hands looked fine from there and were 20-35 mm into
   every handguard from anywhere else, and a sprint rolls the gun toward the eye. Fit against the mesh, then look from
   the far side (`&oh=`, `&orbit=`).
5. **Moves between holds.** A reload or swing moves the hand from one hold to another. Give each end its own pose
   (`st.poseA` / `st.poseB`), route the hand round the item (`st.arc`), and keep the elbow clear (`st.poleA` /
   `st.poleB`, `poleR` / `poleL`). An elbow pole is usually the fix for one forearm through the other hand. A throw
   opens the hand at `THROW_RELEASE`, when the item leaves it, and not before.
6. The viewmodel's near plane is 0.01 m. Keep the hip pose so nothing comes close to the eye (`nearZ` in the check).
   Never draw the viewmodel into the world's depth: the tuck handles walls.

## 4. A new held item: third person (`characters.js`)

- `holdFor` maps the item to a hold. A gun is a pistol hold in slot 1 and a rifle hold otherwise, a melee weapon is a
  melee hold, and anything else is a throw hold. Add a case if that is wrong for your item.
- Guns mount barrel along the forearm. A shouldered butt ends at `STOCK_POCKET`, measured from the model's own reach
  behind the grip, so build the stock at its real length. A tube that rides the shoulder needs a lift like `RPG_LIFT`.
- A throwable or other held thing needs its radius across the palm in `THROW_RADIUS`, or it sits through the fist.
- Third-person hands are simple fists. Move the item, don't fit fingers. Check every pose: idle, walk, sprint,
  crouch, looking up and down, downed, seated and swimming.
- Worn gear hangs from `WORN_AT` (`backpack.js`) and `hangPack` / `PACK_HANG`. Check `?pack=poses`.

## 5. Ground pickups (`pickups.js`)

- `BUILD` items are set down on their lowest vertex (`REST_SINK`, `REST_LIFT`, `REST_AT`). Build them with the base at
  y = 0 anyway.
- Weapons and `HELD_LAY` items go through `weaponPickup`, laid on their side and placed by their own vertices. Give a
  new throwable a `HELD_LAY` entry if it should lie some other way.
- Look at the item in the props sheet from low (`pitch=6`, to catch sinking or floating) and from above (`pitch=35`,
  to catch parts inside each other).

## 6. Props and where the world puts them

- **A prop's colliders follow its model** ([hitboxes.md](hitboxes.md)): several boxes along its silhouette, not one
  box round all of it. `npm run hitbox:measure -- --only <type>` and `npm run hitbox:overlay -- <type>` show how far
  off they are; `scripts/test-hitbox.js` fails a prop whose colliders hold more than 0.7 m of solid air at eye
  height. A prop that is already in the world keeps the box it was laid out by as its `plan`, so that giving it
  better colliders moves nothing.

- **A place's own props** (`Builder.prop`, `Builder.wreck`, `Builder.cont` in `shared/world.js`, `shared/rail.js`,
  `clinic.js`, `cemetery.js`, `fair.js` and `mine.js`): leave room for the whole collider footprint at the prop's
  rotation, not just its centre.
- **Anything scattered** (road dressing, sites, trees, boulders): go through the placement rules (`propBlocked`,
  `SITE_ROOM`, `occupy` radii, `partBlocked`). Make a rule skip things **after** their random draws, so nothing else
  on the seed moves.
- Moving a prop or a rule changes what a seed builds. Say in the PR which seeds changed and what moved.

## 7. Measure before you call it done

```sh
npm run clip:survey -- --save-baseline shots/clip/base-before.json   # before you start, on anything shared
npm run clip:survey -- --item <name>                                  # your item, every state
npm run clip:survey -- --baseline shots/clip/base-before.json        # after a shared change: exits 1 if anything got worse
npm run clip:pickups                                                  # ground items
npm run clip:props -- --seeds 1-100                                   # props and placement
npm test                                                              # includes test-world.js: no solid in another
```

The numbers find candidates and your eyes decide. Open the worst frames in the sandbox (`npx vite`, then
`/sandbox/models-test.html?vm=<id>&clip=1&dots=1&xray=1`, or `?hold=<id>&pose=...&clip=1`) and look from an outside
camera. A shared pose, grip, pole, reload branch or hold category changes other items too, so re-survey all of them.

## 8. A wardrobe part (the character creator)

A hairstyle, beard, hat, top, vest, pair of shoes or piece of kit is worn by every survivor the creator can make, not
only by the roster survivor it was made for. So it has to sit right with everything else the wardrobe offers.

1. Build it in `client/render/models/people.js` like the parts already there. Put it on the body's own surfaces
   (`sheet`, `pillow`, `surfPoint`, `headSurface`) at the layer it is worn at (`pP`, `pT`, a vest's `pV`), so it
   follows every body shape.
2. Add one line for it to its field in `shared/wardrobe.js`. Give it the next unused `id`, never one in `retired`.
   If it cannot be worn with something, say so in the line itself (`excludes`, `allow`). Don't make it smaller.
3. Measure it on every body and with every other part:

   ```sh
   npm run clip:outfits -- --looks <field>:<name>           # clothes against clothes, e.g. hat:stetson
   npm run clip:survey -- --sections tp --looks <field>:<name>  # held items and the pack, on those looks
   npm test                                                 # test-characters.js: it builds, it changes the model,
                                                            # it fits the budget, the wardrobe and people.js agree
   ```

   `--looks cover` runs every part, and `--save-baseline` / `--baseline` work as the survey's do. Look at the worst
   ones with `?turn=l:<code>` (the code is printed beside each look).

## The rules

- Never shrink, scale or hide an item to hide a clip.
- Make the smallest change in the existing code style. Don't add a new model where a pose or an offset will do.
- Fit poses against the mesh, never by eye.
- Every part is a closed, outward-facing shell, and every prop's mesh stays inside its colliders.
- No version bumps (`PROTOCOL_VERSION` or any package version). Clipping work needs no wire changes.
- Headless only. Use the `scripts/clip/` tools as they are: headless Chrome, off screen and muted, a temporary profile,
  everything stopped afterwards. Never open a visible browser window or lock the cursor.
