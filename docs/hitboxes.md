# Hitboxes: colliders that follow what is drawn

Read this before you add a prop, change a prop's model or its colliders, or build a place out of walls and solids.
It is the workflow of the hitbox pass (the `hitbox-pass` branch) and the tools it left in `scripts/hitbox/`.
[clippy.md](clippy.md) is about one solid drawn inside another; this is about the solid the game *plays* by - what
stops a shot, a body, a look, an arm - being the solid the player *sees*.

## What goes wrong

Everything static in the world collides as upright boxes and cylinders (`shared/collision.js`): a prop's are in
`shared/props.js`, a place's walls are the boxes it is built of (`shared/worldkit.js`). The server judges every shot,
every step and every line of sight against them and against nothing else. A prop's model is far finer than that, so
the two can disagree two ways:

- **solid air**: a collider where nothing is drawn. The report that started the pass: the sedan was one box as long
  as the car and as high as its roof, so the air over its bonnet and its boot stopped bullets, bodies and the dead's
  eyes. A shot "across the bonnet" hit nothing and vanished.
- **a hole**: something drawn with no collider. A shot or a body goes through what looks solid.

Both are measured, in metres, by what they matter to:

| | what it is | where it shows |
|---|---|---|
| **shot** | bullets, a swing that lands on the world, the dead's line of sight (`raycastWorld`: one set of colliders for all three) | a shot stopped in the open; a zombie that cannot see you over a bonnet |
| **sight** | the same, between a crouching and a standing eye only | cover that is not there, or is there and not drawn |
| **move** | walking, seen from above: a collider reaching over a step (0.45 m) and under the head | an invisible wall; a walk through a solid |
| **stand** | where both are: the collider's top against the model's | feet floating over a bonnet, or sunk in a roof |
| **reach** | interaction and a survivor's melee go over anything no higher than the eye (`canReach`) | a container that cannot be searched over a low thing |

## The tools (`scripts/hitbox/`, all in node, no browser)

| Tool | npm script | What it does |
|---|---|---|
| `measure.js` | `hitbox:measure` | Every prop's colliders against its model, every variant: solid air and holes as volume and as worst distance, by shot / sight / move / stand / reach, worst first. `--only a,b`, `--where` (where on the prop the worst is), `--json out.json`, `--against old.json` (before and after, prop by prop). |
| `overlay.js` | `hitbox:overlay` | A PNG of a prop with its colliders drawn over it (tinted boxes, edges), from the side and from three quarters, with its numbers. `--before <tree>` puts the other build's colliders above. `--all vehicles`, `--variants`. |
| `sil.js` | | A prop from above as two maps of characters - its top and its underside in tenths of a metre: what the boxes are read off. `node scripts/hitbox/sil.js pickup_truck:0@0.25`. |
| `fit.js` | `hitbox:fit` | A first guess at boxes for a model (stacked by height). Tidy it by hand: it does not know a bonnet from a boot. |
| `sweep.js` | `hitbox:sweep` | The whole of a map: rays from every spot a body can reach, against the colliders and against everything drawn (parts, props, the city's kit, the bridge). Faults by the cubic metre, named by what owns them, with the `/tp` to the worst of each; a picture of the map with every fault on it. `--before <tree>`. |
| `here.js` | | What stands at a spot (`node scripts/hitbox/here.js mainland 1337 -144.8 39.2`): props, parts with or without a collider, colliders. For a fault the sweep names. |
| `navdiff.js` | | The dead's nav grid of the same valley in two trees: cells shut and opened, and whether anything that could be walked to no longer can. |
| `bench.js` | | The cost of a ray, a body's step and a reach in two trees, on the same spots beside the props. |
| `game-views.js` | | The one tool with a browser (through `launchChrome`): the same views in two builds of the real game, with a fan of shots drawn where the game stops them. |
| `lib.js`, `draw.js` | | The measure itself; triangles, lines and letters into a PNG. |

**How the measure works** (`lib.js`). The model is built under node as the client builds it (`createProp`, with
`scripts/clip/dom-stub.js` for the DOM) and turned into a solid on a grid of 4-5 cm cubes: a cube is solid when, along
each of the three axes, it lies between the first and the last surface of the model on that line. So a car's cabin is
solid (its glass and pillars close it), the air over its bonnet is not, nor the room under a table, in a bus shelter
or under a trailer. A skin with nothing under it (a heap, a tent) is solid down to the ground. The colliders go on the
same grid. Solid air is collider and no model; a hole is model and no collider. The worst distance of solid air is
how far its worst cube is from any model; a hole's is how thick it is where it is thickest (a thin arm that sticks
far out of its box is not a deep hole). Cards of grass, stains and lettering are no solid; chain link is solid to a
body and not to a shot.

**How the sweep works** (`sweep.js`). Standing spots: every 2 m, the ground and every collider top with headroom over
it, kept if a body can get there from open ground by walking, climbing a stair or dropping (so not the roofs of the
towers). From each, level rays in eight directions at 0.35, 1.0 and 1.55 m as a shot, and at 0.5 and 1.2 m as a
body. A ray is a fault when the colliders and the drawn world stop it more than 0.35 m apart *and* the spot it
stopped at is more than 0.35 m from anything drawn (or from any collider): a ray that clips the corner of a box an
inch proud of its model is not an invisible wall. What it does not cover is at the top of the file: trees and
boulders, the mine's drifts, the rails, rays that are not level.

## The workflow

**A new prop, or a changed model.**

1. Look at it: `node scripts/hitbox/sil.js <type>` (every variant: `<type>:1`), `npm run hitbox:overlay -- <type> --variants`.
2. Give it colliders that follow the silhouette, with `B(x0, x1, y0, y1, z0, z1)` / `W(half, y0, y1, z0, z1)`
   (`shared/propbox.js`): a body and what stands on it, each box named in a comment. Few boxes: a sedan is three, a
   truck six. `npm run hitbox:fit -- <type>` gives a start.
3. `npm run hitbox:measure -- --only <type> --where` until it is inside the bounds (`BOUNDS` in
   `scripts/test-hitbox.js`: 0.7 m of solid air at eye height, 0.5 m of hole). Look at the overlay again.
4. `node scripts/test-hitbox.js`. A prop that is meant to be as it is goes on `ALLOW` there, with its own looser bound
   and one line of why. Keep that list short.

**A place, a building, anything built of walls.** `npm run hitbox:sweep -- --world mainland --before origin/main`'s
worktree (or `--world island`), read what is new in the list, `/tp` to the worst of it. A box drawn with
`{ collide: false }` or tilted (`rx` / `rz`) has no collider: that is right for a roof slope or a slab of rubble, and
wrong for a wall.

## The rules

`scripts/test-hitbox.js` (in `npm test`) holds every one of these.

- **Vehicles.** A shot over a bonnet, a boot or a pickup's bed goes on; a shot into a cabin stops - glass stops a shot
  exactly as the pillar beside it does (it always did: the old box was solid to the roof; a building's window has no
  collider and is shot through, a vehicle's has). What hangs clear of the ground from side to side, half a metre
  and more, for a metre and more keeps the room under it: a shot goes under a trailer, a tender or an army truck
  between its axles, and not under a sedan or a van.
- **Nothing thinner than 0.45 m off the ground.** `server/nav.js` takes a box thinner than that with its top over
  half a metre for a deck (a pier, a ceiling), not a wall. Start an upper box inside the one under it instead.
- **Nothing hung where a jump reaches.** A collider whose underside is between 1.8 and 2.71 m over the prop's base
  pushes whoever jumps under it out sideways (`resolveBody` pushes across, never down). Hang it lower (it is then a
  wall, as a wing is) or not at all (a tent's roof over a walkway has no collider).
- **A wreck is one thing to strip.** A prop that gives scrap (`salvage`) is several boxes now and still gives its five
  hits a day once: every collider of it names the first (`col.main`, `wreckUnit` in `shared/wrecks.js`), and that
  one is what its record is kept under and what it is called on the wire (by its quantized centre and base, so no
  other collider of the prop may share those). `units` makes a prop more than one thing (a lorry: tractor and
  trailer); `units: 'each'` keeps the aircraft wrecks a thing a box, as they were.
- **A variant that stands differently has colliders of its own** (`vary`): a table thrown on its side, a plane down on
  its nose, a burnt-out trailer. `vary.n` is the model's own count of variants.
- **Changing a prop's colliders must not move the world.** World generation asks the colliders where a prop may
  stand and how it sits on a slope. A prop whose colliders were changed keeps what it was laid out by as `plan`
  (the box it had), and generation reads that (`worldkit.js`: `footprint`, `solidsOf`, `laid`). Check it:
  `node scripts/perf/world-hash.js --before origin/main --seeds 1-24` must say every world is identical. A *new*
  prop needs no plan.
- **It does change the world's fingerprint.** `worldHash` (`server/handoff.js`) hashes every static collider, so any
  change to a prop's boxes means a game saved by the old build is not restored by the new one (the save is dropped
  and that game ends as a deploy used to end them). Say so in the pull request.
- **Every collider has the same fields.** `makeBox` / `makeCyl` make them; never add a field to some colliders and
  not others (a `main` on wrecks only made every ray in the game twice as slow: V8 gives up on the property lookups).

## Left as it is, and why

- **Chain link stops a shot and a look** (`fence_chain`: the sweep's largest count, on both maps). Marking it
  `COL.NOBULLET` would let bullets and the dead's eyes through - and, by the rules those flags already have, the
  dead's claws (`Zombies.canReach`) and a survivor's reach into a container behind it (`canReach`). That is a change
  to how a fence defends, not to a hitbox: it is the owner's to make (one flag on the box in `shared/props.js`).
  The same goes for `razor_wire` and `concertina` (0.9 m high: a standing shot clears them anyway).
- **The open doors of `car_open`** have no collider, as before: a lane between two abandoned cars stays a lane, for
  survivors and for the dead's paths.
- **Light clutter has no collider**, as before (a shopping trolley, a pram, a school desk, an office chair, cones,
  luggage, a fallen pole): it is walked and shot through, so that no corridor or doorway is shut by it.
- **A campfire's ring is 0.5 m high** though its stones are 0.3: nobody stands in the flames.
- **Roof slopes, tilted slabs, fire escapes, cornices** are drawn without colliders (a tilted box cannot be one).
  The sweep counts them apart ("by design"). A bat's flight has its own roof boxes (`server/zombies.js`).
- **The quest plane** (`plane_wreck`): the ground under its wings and round its engines stays shut, and its
  tailplane's box still hangs at 1.98 m - a jump under it does push the jumper out. It was so before; moving it
  changes where the plane can be worked on, which wants playing.
- **The fallen lengths of tower in Port Calder** are tilted and collide as upright blocks (about a hundred faults
  by the cubic metre at their ends on seed 1337).

## What it costs

More boxes are more work for a ray and a step near a vehicle. Measured with `bench.js` (200,000 of each on the same
spots within 6.5 m of a prop, each build in its own process): flat on the island; on the mainland, where a street
is a row of cars, 7 to 20% more per call beside them, and the nav grid 11% longer to build. A tick of the server
with a night-4 horde: `npm run perf:server`.
