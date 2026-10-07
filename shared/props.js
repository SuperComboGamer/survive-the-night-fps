// Prop footprints shared by world generation (server collision) and client models.
// Local space: origin at ground level, center of footprint; FRONT faces -Z; y up.
// size: overall visual bounding box [sx, sy, sz] (meters) the model should roughly fill.
// boxes: collision boxes [cx, cy, cz, sx, sy, sz] in local space (cy = box center height).
// cyls:  collision cylinders [cx, cz, radius, height] (and, for one that does not stand on the ground, its base: a
//        fifth number).
// A box/cyl top is walkable (players can stand on it) if they can step/jump onto it.
// salvage: true -> hitting it with a melee weapon yields scrap (limited per day).
//
// The colliders follow the model, and scripts/test-hitbox.js holds them to it (docs/hitboxes.md): a shot over a
// bonnet goes on, a shot into the cabin stops. So most things are several boxes. What goes with that:
// plan:   { boxes, cyls } - what the world is LAID OUT by (worldkit.js: how a prop is seated on a slope, what may
//         stand beside it), when that is not the colliders themselves. It is the one box the prop had before its
//         colliders were made to follow the model: changing `boxes` then moves nothing in any valley. A new prop
//         needs none.
// vary:   { n: how many variants the model has (createProp draws seed % n), <variant>: { boxes, cyls } } - colliders
//         of their own for a variant that stands differently (a table thrown on its side, a plane down on its nose).
// units:  for a wreck that gives scrap: which of its colliders are one thing to strip (a number per box, then per
//         cylinder). Without it the whole prop is one: a car is stripped once, whichever of its boxes is struck. A
//         lorry is two (the tractor, the trailer). 'each': every collider its own, as the aircraft wrecks always were.
// Rules the tests hold: a box of a vehicle is 0.45 m thick or more (server/nav.js takes anything thinner for a deck
// to walk under); no two colliders of one prop share a centre and a base (a wreck is named on the wire by those).

import { STREET_PROP_DEFS } from './props-street.js';
import { B, W } from './propbox.js';
import { INTERIOR_PROP_DEFS } from './props-interior.js';

export const PROPS = {
  car: {
    size: [1.9, 1.45, 4.6],
    // (its bonnet stands propped open, to 2 m: a sheet with no collider - the car is what a survivor reaches for)
    boxes: [
      W(0.95, 0, 0.95, -2.3, 2.29), // the body: bonnet, sills and boot
      W(0.9, 0.4, 1.22, -1.05, 1.14), // the scuttle and the feet of the screens
      W(0.83, 0.5, 1.5, -0.45, 0.96), // the roof
    ],
    plan: { boxes: [[0, 0.72, 0, 1.9, 1.44, 4.5]] },
    desc: 'broken-down rusty sedan, hood propped open, one wheel missing (on a jack/blocks), shattered windows. The quest car at camp.',
  },
  // (the mainland, act 2: shared/mainland.js)
  plane_wreck: {
    size: [15.8, 4.6, 12],
    boxes: [
      B(-0.8, 0.8, 0, 2.8, -5.8, 2.0), // the fuselage, down to the ground under it
      B(-0.8, 0.8, 1.0, 2.9, 2.0, 5.5), // ...and the tail cone, which is clear of it
      [0, 1.3, -0.72, 2.4, 0.7, 2.5], // the wing, where it leaves the fuselage
      [-2.4, 1.05, -1.7, 2.4, 2.1, 5.2], // each engine, the main wheel under it, and the ground beside it under
      [2.4, 1.05, -1.7, 2.4, 2.1, 5.2], // the wing (the cowling set down, the fuel drums)
      B(1.75, 3.25, 0.2, 2.8, -4.3, -3.85), // the disc of the propeller that is still on (the right one)
      [-4.65, 1.575, -0.72, 2.1, 0.65, 2.4], // the wings outboard of the engines, in two steps: they rise to the tips
      [4.65, 1.575, -0.72, 2.1, 0.65, 2.4],
      [-6.725, 1.785, -0.875, 2.05, 0.55, 1.75],
      [6.725, 1.785, -0.875, 2.05, 0.55, 1.75],
      [0, 2.25, 4.68, 5.5, 0.55, 1.6], // the tailplane
      [0, 3.55, 4.12, 0.4, 1.95, 3.05], // the fin
      [-1.2, 1.15, 1.19, 0.85, 2.3, 0.75], // the cabin door, down on its cables as the steps
      [0, 2.95, -1.62, 0.1, 0.35, 0.3], // the radio's mast on the roof (its wire to the fin is not solid)
    ],
    plan: {
      boxes: [
        [0, 1.4, -0.15, 1.6, 2.8, 11.3],
        [0, 1.3, -0.72, 2.4, 0.7, 2.5],
        [-2.4, 1.4, -1.7, 2.4, 2.8, 5.2],
        [2.4, 1.4, -1.7, 2.4, 2.8, 5.2],
        [-4.65, 1.575, -0.72, 2.1, 0.65, 2.4],
        [4.65, 1.575, -0.72, 2.1, 0.65, 2.4],
        [-6.725, 1.785, -0.875, 2.05, 0.55, 1.75],
        [6.725, 1.785, -0.875, 2.05, 0.55, 1.75],
        [0, 2.25, 4.68, 5.5, 0.55, 1.6],
        [0, 3.55, 4.12, 0.4, 1.95, 3.05],
        [-1.2, 1.15, 1.19, 0.85, 2.3, 0.75],
        [0, 2.95, -1.62, 0.1, 0.35, 0.3],
      ],
    },
    desc: 'a grounded twin-engine light transport (an eight-seater of the 1960s: a long nose, a low wing with dihedral, a flat-six in a nacelle faired into each wing, the main wheels under the nacelles and a nose wheel, a swept fin), nose to -Z: bare metal gone dull, a faded blue cheat line, black de-icing boots, a raked windscreen, four cabin windows a side, flaps and elevators hanging. The left engine is bare (its cowling in two halves on the ground beside it) and has no propeller, the left main tyre is flat, an access panel hangs open under the nose, the cabin door is down as its steps; chocks, a step ladder and a tool tray. The quest plane at Calder Field: what is fitted to it shows (createQuestPlane in models/aircraft.js).',
  },
  fuel_truck: {
    size: [2.5, 2.9, 7.6],
    boxes: [
      W(1.23, 0, 1.0, -3.78, -2.1), // the front axle under the cab
      W(1.23, 0.8, 1.3, -2.1, 0.7), // the frame between the axles: a shot goes under it
      W(1.23, 0, 1.3, 0.7, 3.75), // the rear axles
      W(1.23, 0.5, 2.6, -3.78, -2.2), // the cab
      W(1.2, 0.85, 2.55, -2.05, 3.4), // the tank
      W(0.8, 1.5, 2.85, -2.05, 3.3), // (the round of its top)
    ],
    plan: { boxes: [[0, 1.45, 0, 2.5, 2.9, 7.6]] },
    salvage: true,
    desc: 'an airfield fuel bowser, cab to -Z: a square cab and a long elliptical tank, faded yellow, FLAMMABLE stencils, a hose reel and a coiled hose at the back, one flat tyre',
  },
  light_plane: {
    size: [11.0, 3.7, 8.5],
    // (variant 0: down on its nose, the tail in the air)
    boxes: [
      W(0.6, 0, 1.45, -4.1, -2.6), // the nose, on the ground
      W(0.62, 0, 2.2, -2.6, -0.1), // the cabin
      W(0.45, 0.8, 2.15, -0.1, 1.3), // the tail cone, rising
      W(0.45, 1.25, 2.45, 1.3, 2.6),
      W(0.3, 1.7, 3.6, 2.4, 3.8), // the fin
      W(2.0, 1.74, 2.2, 2.6, 3.8), // the tailplane
      B(-5.5, 5.5, 1.7, 2.2, -2.6, -0.75), // the wing
      [0, 0.35, -0.7, 2.8, 0.7, 1.1], // the main wheels on their legs
      [-1.16, 1.05, -1.2, 1.08, 0.8, 0.6], // the wing's struts, in two steps a side
      [1.16, 1.05, -1.2, 1.08, 0.8, 0.6],
      [-2.25, 1.6, -1.2, 1.1, 0.8, 0.6],
      [2.25, 1.6, -1.2, 1.1, 0.8, 0.6],
    ],
    vary: {
      n: 2,
      // (variant 1: level on three flat tyres, the right wing tip crumpled down)
      1: {
        boxes: [
          W(0.6, 0.3, 1.5, -4.0, -3.2), // the bare engine
          W(0.6, 0, 1.52, -3.2, -2.6), // the nose wheel under the firewall
          W(0.62, 0, 2.2, -2.6, 0.3), // the cabin
          W(0.45, 0.5, 1.75, 0.3, 2.9), // the tail cone
          W(0.25, 1.0, 2.7, 2.7, 3.8), // the fin
          W(1.9, 1.2, 1.66, 2.7, 3.8), // the tailplane
          B(-5.5, 4.7, 1.74, 2.2, -2.25, -0.25), // the wing
          B(4.7, 5.3, 1.2, 2.05, -1.9, -0.4), // (its right tip, crumpled down)
          [0, 0.35, -0.7, 2.8, 0.7, 1.1],
          [-1.16, 1.05, -1.2, 1.08, 0.8, 0.6],
          [1.16, 1.05, -1.2, 1.08, 0.8, 0.6],
          [-2.25, 1.6, -1.2, 1.1, 0.8, 0.6],
          [2.25, 1.6, -1.2, 1.1, 0.8, 0.6],
        ],
      },
    },
    units: 'each',
    plan: {
      boxes: [
        [0, 1.1, -1.45, 1.24, 2.2, 5.4],
        [0, 1.55, 2.8, 0.9, 1.6, 3.1],
        [0, 2.52, 3.32, 0.5, 2.25, 2.05],
        [0, 1.8, 3.4, 3.6, 1.2, 1.5],
        [0, 2.1, -1.12, 11.04, 0.8, 2.1],
        [4.75, 1.65, -1.0, 1.15, 1.0, 1.9],
        [0, 0.35, -0.7, 2.8, 0.7, 1.1],
        [-1.16, 1.05, -1.2, 1.08, 0.8, 0.6],
        [1.16, 1.05, -1.2, 1.08, 0.8, 0.6],
        [-2.25, 1.6, -1.2, 1.1, 0.8, 0.6],
        [2.25, 1.6, -1.2, 1.1, 0.8, 0.6],
      ],
    },
    salvage: true,
    desc: 'the wreck of a four-seat high-wing light aircraft (a strut-braced wing on the cabin roof, a flat-four behind a two-blade propeller, a swept fin, three wheels), nose to -Z: white gone grey with a stripe down its side, the windscreen broken, weeds through it. Variant 0 (red stripe) is down on a collapsed nose leg and a bent propeller, tail in the air, flaps down; variant 1 (blue stripe) sits level on three flat tyres, its cowling gone from round the engine, the right wing tip crumpled',
  },
  rubble_pile: { size: [5.2, 1.7, 5.2], cyls: [[0, 0, 2.1, 0.5], [0, 0, 1.5, 0.95], [0, 0, 0.8, 1.25]], plan: { cyls: [[0, 0, 2.3, 1.4]] }, desc: 'a heap of what a building came down as: broken concrete slabs at all angles, bricks, bent rebar standing out of it, dust' },
  car_burnt: {
    size: [1.9, 1.4, 4.5],
    boxes: [W(0.95, 0, 0.84, -2.29, 2.29), W(0.9, 0.4, 1.12, -0.74, 1.14), W(0.83, 0.5, 1.37, -0.4, 0.96)], // (as car_wreck)
    plan: { boxes: [[0, 0.7, 0, 1.9, 1.4, 4.4]] },
    salvage: true, desc: 'a burnt-out car: bare scorched steel, no glass, no tyres (down on its rims), the paint gone to rust and soot',
  },
  traffic_light: { size: [0.5, 5.4, 3.2], cyls: [[0, 0, 0.14, 5.4]], desc: 'a traffic light: a pole with an arm out over the street (-Z) and a three-lamp head hanging from it, all dead; a second head on the pole' },
  bus_shelter: {
    size: [3.6, 2.5, 1.5],
    boxes: [
      [0, 1.2, 0.68, 3.6, 2.4, 0.1],
      [-1.75, 1.2, 0.05, 0.1, 2.4, 1.2],
      [1.75, 1.2, 0.05, 0.1, 2.4, 1.2],
      B(-0.9, 0.9, 0, 0.45, 0.05, 0.63), // the bench (stepped onto, as a street bench is)
    ],
    plan: {
      boxes: [
        [0, 1.2, 0.68, 3.6, 2.4, 0.1],
        [-1.75, 1.2, 0.05, 0.1, 2.4, 1.2],
        [1.75, 1.2, 0.05, 0.1, 2.4, 1.2],
      ],
    },
    desc: 'a bus shelter, open to -Z: a steel frame, a back and two end panes (one smashed), a flat roof, a bench along the back',
  },
  // ---- what years of nobody leave in a street (no collider: walked over), and what blocks one
  litter: { size: [3, 0.15, 3], desc: 'rubbish blown flat on the ground: papers, cans, bottles, a shoe, a split bag' },
  debris: { size: [2.6, 0.45, 2.6], desc: 'bricks, broken lumps of concrete and a bent bar in a patch of grit, low enough to step over' },
  rubble_slope: {
    size: [7, 2.4, 7],
    // six steps a survivor can take (0.4 m each: under STEP_HEIGHT), so the heap can be walked up from any side.
    // Round ones, as the mound is: square steps stood half a metre proud of it at their corners
    cyls: [0, 1, 2, 3, 4, 5].map((k) => [0, 0, 3.5 - 0.55 * k, 0.4 * (k + 1)]),
    plan: { boxes: [0, 1, 2, 3, 4, 5].map((k) => [0, 0.2 * (k + 1), 0, 7 - 1.1 * k, 0.4 * (k + 1), 7 - 1.1 * k]) },
    desc: 'a big mound of rubble that can be walked up: grit and dust with slabs, lumps of concrete and bricks lying in it, a floor slab down one side, rebar standing out of the top',
  },
  ivy: { size: [3.2, 5, 0.35], desc: 'a mat of ivy against a wall (its back at local z = 0, growing out to z = -0.3): stems from the ground, thick low down, ragged at the top; one variant dead and brown' },
  shopping_cart: { size: [0.6, 1.0, 1.0], desc: 'a wire supermarket trolley; one variant on its side' },
  suitcases: { size: [1.3, 0.6, 0.9], desc: 'abandoned luggage: two cases and a holdall, one case burst open with clothes round it' },
  razor_wire: { size: [3, 0.9, 0.9], boxes: [[0, 0.45, 0, 3, 0.9, 0.9]], desc: 'a coil of concertina wire strung along X between two stakes' },
  barricade: { size: [3.2, 1.5, 1.1], boxes: [B(-1.52, 1.5, 0, 1.15, -0.56, 0.12), B(0.15, 1.35, 0.3, 1.47, -0.45, -0.05), B(-1.5, 1.5, 0, 0.95, 0.12, 0.42)], plan: { boxes: [[0, 0.75, 0, 3.2, 1.5, 1.1]] }, desc: 'a barricade of furniture along X: a table on its side, a door, a mattress, chairs and planks jammed together' },
  fallen_sign: { size: [3, 0.35, 1.1], desc: 'the sign board of a shop lying face up where it fell, faded letters, broken glass' },
  pole_down: { size: [9, 0.9, 2.2], desc: 'a power pole lying along X on the ground, its crossarm and insulators, snapped wires trailing' },
  dumpster_tipped: { size: [1.4, 1.25, 1.9], boxes: [[0, 0.625, 0, 1.4, 1.25, 1.9]], desc: 'a dumpster on its side, mouth to -X, its lids and its rubbish on the ground in front' },
  semi_truck: {
    size: [5.8, 3.9, 17],
    boxes: [
      B(-0.2, 2.45, 0, 3.9, -4.2, -1.8), // the trailer: its nose on the tractor's rear axles, the landing legs
      B(-0.2, 2.45, 1.0, 3.9, -1.8, 5.3), // ...the box between them and the bogie: a shot goes under it
      B(-0.2, 2.45, 0, 3.9, 5.3, 8.47), // ...and over the bogie
      B(-1.75, -0.25, 0, 2.3, -8.45, -8.0), // the tractor, slewed to its left: its bonnet, in three steps
      B(-2.3, 0, 0, 2.3, -8.0, -7.25),
      B(-2.65, 0.6, 0, 2.3, -7.25, -6.4),
      B(-1.0, 0.5, 0.6, 3.4, -7.4, -6.75), // ...its cab and sleeper, in four
      B(-2.0, 1.1, 0.3, 3.4, -6.75, -5.75),
      B(-1.5, 1.6, 0, 3.5, -5.75, -4.75),
      B(-1.0, 0.3, 0, 3.5, -4.75, -4.2),
      B(0.9, 2.1, 0, 1.15, -5.25, -4.2), // ...and the end of its frame
    ],
    // (the burnt one: its trailer is down to the floor and the ribs, with the front wall and the door frame standing)
    vary: {
      n: 2,
      1: {
        boxes: [
          B(-0.2, 2.45, 0, 1.75, -3.8, -1.8),
          B(-0.2, 2.45, 1.0, 1.75, -1.8, 5.3),
          B(-0.2, 2.45, 0, 1.75, 5.3, 8.2),
          B(-1.75, -0.25, 0, 2.3, -8.45, -8.0),
          B(-2.3, 0, 0, 2.3, -8.0, -7.25),
          B(-2.65, 0.6, 0, 2.3, -7.25, -6.4),
          B(-1.0, 0.5, 0.6, 3.4, -7.4, -6.75),
          B(-2.0, 1.1, 0.3, 3.4, -6.75, -5.75),
          B(-1.5, 1.6, 0, 3.5, -5.75, -4.75),
          B(-1.0, 0.3, 0, 3.5, -4.75, -4.2),
          B(0.9, 2.1, 0, 1.15, -5.25, -4.2),
          B(-0.2, 2.45, 0, 3.85, -4.2, -3.8),
          B(-0.2, 2.45, 0, 3.85, 8.2, 8.47),
        ],
      },
    },
    units: [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0], // (stripped as two things, as before: the trailer, the tractor)
    plan: {
      boxes: [
        [1.1, 2, 2.25, 2.6, 4, 12.5], // the trailer, along Z
        [0, 2, -5.05, 5.8, 4, 6.9], // the tractor, slewed to its left
      ],
    },
    salvage: true,
    desc: 'a jack-knifed articulated lorry: a box trailer along Z and the tractor turned out at its nose (-Z) to the -X side; one variant burnt out (the trailer down to its ribs)',
  },
  awning: { size: [3.4, 1.0, 1.3], desc: 'a torn shop awning: origin where it is fixed to the wall (the wall is local z = 0), its bent frame and strips of canvas hanging out towards -Z and down' },
  subway_entrance: {
    size: [3.6, 3.6, 6.4],
    // (open to -Z: the first steps can be stood on, down to the gate)
    boxes: [
      B(-1.8, -1.45, 0, 1.15, -3.2, 3.2), // the kerb and railing down each side
      B(1.45, 1.8, 0, 1.15, -3.2, 3.2),
      B(-1.8, 1.8, 0, 1.15, 2.8, 3.2), // ...and across the back
      B(-1.45, 1.45, 0, 1.1, -0.95, -0.6), // the roll gate
      B(-1.45, 1.45, 0, 0.78, -0.6, 2.8), // the rubble behind it
      B(-1.45, 1.45, 0, 0.4, -3.2, -2.3), // the steps in front of the gate
      B(-1.45, 1.45, 0, 0.22, -2.3, -0.95),
    ],
    cyls: [[1.65, -3.05, 0.08, 3.6]],
    plan: { boxes: [[0, 0.575, 0, 3.6, 1.15, 6.4]], cyls: [[1.65, -3.05, 0.08, 3.6]] },
    desc: 'a way down to the underground, shut: a kerb and railings round the stairwell on three sides, open to -Z, the stair choked with rubble behind a rusted roll gate, a post with a red M roundel at the front corner',
  },
  shipping_container: { size: [2.44, 2.6, 6.06], boxes: [[0, 1.3, 0, 2.44, 2.6, 6.06]], desc: 'a 20 ft shipping container along Z, doors at +Z, corrugated and rusted; three colours, one with a door ajar' },
  power_transformer: { size: [2.4, 2.8, 1.9], boxes: [W(1.2, 0, 0.3, -0.95, 0.95), W(0.9, 0, 1.92, -0.95, 0.8), W(1.2, 0.1, 1.8, -0.75, 0.45), W(0.6, 1.0, 2.76, -0.4, 0.2)], plan: { boxes: [[0, 1.4, 0, 2.4, 2.8, 1.9]] }, desc: 'a substation transformer on a plinth: a steel tank, cooling fins down both sides, three ceramic bushings on top' },
  school_desk: { size: [0.85, 0.8, 0.95], desc: 'a school desk and its chair; one variant overturned' },
  // ---- Calder Field
  baggage_cart: { size: [1.5, 1.5, 2.8], boxes: [W(0.7, 0, 0.88, -1.3, 1.15), W(0.7, 0.4, 1.5, -1.36, -1.14), W(0.7, 0.4, 1.5, 0.94, 1.2)], plan: { boxes: [[0, 0.75, 0, 1.5, 1.5, 2.8]] }, desc: 'an airport baggage cart, tow bar to -Z, a few cases on it' },
  fire_truck: {
    size: [2.6, 3.3, 8.2],
    boxes: [
      W(1.26, 0, 1.2, -4.15, -2.3), // the front axle and the bumper
      W(1.26, 0.9, 1.4, -2.3, 0.7), // the frame between the axles: a shot goes under it
      W(1.26, 0, 1.2, 0.7, 3.92), // the rear axles
      W(1.26, 0.95, 3.25, -4.0, 3.92), // the cab and the body
    ],
    plan: { boxes: [[0, 1.65, 0, 2.6, 3.3, 8.2]] },
    salvage: true, desc: 'an airport crash tender, cab to -Z: six wheels, faded red over yellow, roller-shutter lockers, a monitor and ladders on the roof',
  },
  windsock: { size: [1.0, 6.2, 0.6], cyls: [[0, 0, 0.08, 6]], desc: 'a windsock on a 6 m pole, limp and torn' },
  runway_light: { size: [0.3, 0.4, 0.3], desc: 'a low runway edge light; one variant with its lens smashed' },
  airliner_wreck: {
    size: [26, 6.6, 28.5],
    boxes: [
      [0, 1.3, -6.0, 2.9, 2.6, 16.6], // the front of the fuselage, nose to -Z
      [-1.8, 1.15, -10.4, 0.9, 2.3, 2.4], // its open door and the slide
      B(-12.4, -1.4, 0, 0.95, -2.6, -0.4), // the left wing, still on it, swept back in three steps
      B(-9.9, -1.4, 0, 0.96, -3.6, -2.6),
      B(-4.2, -1.4, 0, 1.0, -4.6, -3.6),
      [-4.6, 0.72, -4.7, 1.5, 1.44, 3.5], // ...and its engine
      [3.88, 1.55, 4.51, 3.7, 3.1, 3.7], // the tail section, slewed off behind to the +X side
      [5.24, 1.55, 6.72, 3.7, 3.1, 3.7],
      [6.6, 1.55, 8.94, 3.7, 3.1, 3.7],
      [8.06, 1.55, 11.33, 3.7, 3.1, 3.7],
      B(8.6, 11.9, 1.15, 2.95, 8.3, 9.9), // its tailplane: the right half, up
      B(7.0, 9.6, 1.16, 2.7, 8.9, 10.7),
      B(3.4, 6.6, 0.9, 1.85, 10.4, 13.7), // ...and the left, down
      B(5.7, 7.4, 2.75, 5.0, 8.9, 10.6), // its fin, in two steps
      B(6.6, 8.6, 2.76, 5.5, 10.4, 12.2),
      B(8.6, 13.1, 0, 0.6, -5.6, -4.4), // the right wing, torn off, flat on the ground: aslant, in five strips
      B(5.6, 12.2, 0, 0.7, -4.4, -3.4),
      B(2.6, 11.2, 0, 0.75, -3.4, -2.4),
      B(1.6, 8.6, 0, 0.76, -2.4, -1.4),
      B(1.6, 6.2, 0, 0.7, -1.4, 0.4),
      [6.2, 0.75, -9.4, 3.2, 1.5, 2.6], // the engine it carried
      [0.9, 0.55, 2.9, 4.2, 1.1, 2.4], // seats and torn skin thrown down at the break
    ],
    units: 'each',
    plan: {
      boxes: [
        [0, 1.3, -6.0, 2.9, 2.6, 16.6],
        [-1.8, 1.15, -10.4, 0.9, 2.3, 2.4],
        [-6.8, 0.6, -2.4, 11.2, 1.2, 4.4],
        [-4.6, 0.72, -4.7, 1.5, 1.44, 3.5],
        [3.88, 1.55, 4.51, 3.7, 3.1, 3.7],
        [5.24, 1.55, 6.72, 3.7, 3.1, 3.7],
        [6.6, 1.55, 8.94, 3.7, 3.1, 3.7],
        [8.06, 1.55, 11.33, 3.7, 3.1, 3.7],
        [7.5, 2.1, 10.5, 9.6, 1.9, 7.2],
        [7.0, 4.3, 10.3, 4.2, 3.3, 5.2],
        [5.45, 0.35, -1.7, 6.1, 0.7, 5.5],
        [9.93, 0.35, -4.16, 6.3, 0.7, 5.6],
        [6.2, 0.75, -9.4, 3.2, 1.5, 2.6],
        [0.9, 0.55, 2.9, 4.2, 1.1, 2.4],
      ],
    },
    salvage: true,
    desc: 'the wreck of a fifty-seat twin-jet airliner that came down short: the front fuselage on its belly nose to -Z with the left wing and engine still on it, broken open behind the wing; the tail section slewed off to the +X side behind, fin and tailplane on it; the right wing torn off and lying flat on the +X side, an engine thrown clear ahead of it; scorched, seats and torn skin on burnt ground at the break',
  },
  car_wreck: {
    size: [1.9, 1.5, 4.5],
    boxes: [
      W(0.95, 0, 0.88, -2.29, 2.29), // the body: bonnet, sills and boot (a shot over the bonnet or the boot goes on)
      W(0.9, 0.4, 1.14, -0.74, 1.14), // the scuttle and the feet of the two screens
      W(0.83, 0.5, 1.37, -0.4, 0.96), // the roof on its pillars (the glass stops a shot as the steel does)
    ],
    plan: { boxes: [[0, 0.75, 0, 1.9, 1.5, 4.4]] },
    salvage: true,
    desc: 'abandoned rusted car, variant colors, doors open, weeds',
  },
  pickup_truck: {
    size: [2.1, 1.9, 5.4],
    boxes: [
      W(1.02, 0, 0.86, -2.79, 2.78), // the frame, up to the floor of the bed
      W(1.0, 0.4, 1.17, -2.79, -1.05), // the bonnet
      W(1.0, 0.5, 1.93, -1.0, 0.48), // the cab
      B(-1.02, -0.86, 0.45, 1.3, 0.48, 2.78), // the sides of the bed
      B(0.86, 1.02, 0.45, 1.3, 0.48, 2.78),
      W(1.02, 0.35, 1.3, 2.62, 2.78), // the tailgate
    ],
    plan: { boxes: [[0, 0.95, 0, 2.1, 1.9, 5.3]] },
    salvage: true,
    desc: 'old farm pickup truck, rust, flat tire',
  },
  campfire: { size: [1.9, 0.55, 1.9], cyls: [[0, 0, 0.85, 0.5]], desc: 'ring of stones with charred logs in teepee (flames are added by the renderer at y~0.3)' },
  tent: { size: [2.4, 1.5, 2.8], boxes: [W(1.05, 0, 0.5, -1.38, 1.33), W(0.8, 0, 0.95, -1.38, 1.33), W(0.4, 0, 1.47, -1.38, 1.33)], plan: { boxes: [[0, 0.75, 0, 2.4, 1.5, 2.8]] }, desc: 'torn camping tent, dirty canvas, one side sagging' },
  log_bench: { size: [0.5, 0.45, 2.2], boxes: [[0, 0.22, 0, 0.5, 0.45, 2.2]], desc: 'a fallen log used as a bench' },
  hay_round: { size: [1.5, 1.5, 1.3], boxes: [[0, 0.75, 0, 1.4, 1.5, 1.3]], desc: 'round hay bale lying on its side (cylinder axis along X)' },
  hay_square: { size: [1.2, 0.6, 0.6], boxes: [[0, 0.3, 0, 1.2, 0.6, 0.6]], desc: 'rectangular hay bale with twine' },
  crate: { size: [1, 1, 1], boxes: [[0, 0.5, 0, 1, 1, 1]], desc: 'wooden shipping crate' },
  crate_small: { size: [0.6, 0.6, 0.6], boxes: [[0, 0.3, 0, 0.6, 0.6, 0.6]], desc: 'small wooden box' },
  military_crate: { size: [1.4, 0.7, 0.8], boxes: [[0, 0.35, 0, 1.4, 0.7, 0.8]], desc: 'olive drab ammo crate with stencil marks' },
  strongbox: { size: [0.9, 0.62, 0.56], boxes: [[0, 0.31, 0, 0.9, 0.62, 0.56]], desc: 'iron-bound steel strongbox, its padlock hanging open' },
  barrel: { size: [0.7, 1.0, 0.7], cyls: [[0, 0, 0.35, 1.0]], desc: 'rusty metal oil drum (variant: red/blue/rust)' },
  sandbags: { size: [2.4, 0.9, 0.7], boxes: [[0, 0.45, 0, 2.4, 0.9, 0.7]], desc: 'stacked sandbag wall, slightly curved' },
  heli_wreck: {
    salvage: true,
    size: [3.2, 3.2, 13],
    boxes: [
      B(-1.0, 1.0, 0, 2.62, -4.8, 0.8), // the cabin, over on its side
      B(-2.0, 1.5, 0, 1.75, -4.6, 0.3), // its flanks and the stub wings
      B(-0.5, 0.5, 0.4, 1.8, -5.6, -4.8), // the nose
      B(-0.4, 1.4, 0.5, 2.45, 0.8, 2.0), // the root of the tail boom
      B(0, 1.0, 1.2, 1.95, 2.0, 5.0), // the boom, in the air
      B(0.4, 1.1, 0, 0.95, 5.0, 6.9), // ...where it broke and came down
      B(0.4, 1.5, 0.5, 2.3, 6.8, 7.85), // the fin
    ],
    units: [0, 0, 0, 1, 1, 1, 1], // (stripped as two things, as before: the cabin, the tail)
    plan: {
      boxes: [
        [0, 1.3, -1.5, 2.8, 2.6, 7.0],
        [0, 1.4, 5.0, 0.8, 1.0, 6.0],
      ],
    },
    desc: 'crashed military helicopter lying tilted on its side, broken rotor blades on the ground, scorched, tail boom broken toward +Z',
  },
  military_tent: { size: [4, 2.6, 6], boxes: [W(2.01, 0, 1.82, -3.07, 2.9), W(1.3, 0.4, 2.15, -3.07, 2.9), W(0.6, 0.5, 2.52, -3.07, 2.9)], plan: { boxes: [[0, 1.3, 0, 4, 2.6, 6]] }, desc: 'olive military field tent, open flap facing -Z' },
  boat: { size: [1.4, 0.7, 4], boxes: [[0, 0.35, 0, 1.3, 0.7, 3.9]], desc: 'old wooden rowboat, peeling paint' },
  gas_pump: { size: [0.8, 1.9, 0.6], boxes: [[0, 0.95, 0, 0.8, 1.9, 0.6]], desc: '1970s gas pump, faded red, hose' },
  gravestone: { size: [0.6, 0.9, 0.22], boxes: [[0, 0.45, 0, 0.6, 0.9, 0.22]], desc: 'weathered gravestone (variants: rounded, cross top, broken/leaning)' },
  grave_cross: { size: [0.6, 1.4, 0.1], boxes: [[0, 0.7, 0, 0.12, 1.4, 0.12]], desc: 'wooden grave cross, crooked' },
  fence: { size: [3, 1.1, 0.12], boxes: [[0, 0.55, 0, 3, 1.1, 0.14]], desc: 'weathered post-and-rail wooden fence segment along X (posts at x=+-1.5), a rail may be broken' },
  tractor: {
    size: [2, 2.6, 3.8],
    boxes: [
      W(0.5, 0, 1.5, -1.8, 0), // the engine under its hood
      W(1.0, 0.05, 0.9, -1.8, -0.95), // the front wheels
      W(1.0, 0.1, 1.6, -0.05, 1.45), // the rear wheels and the mudguards
      W(0.3, 0.6, 1.85, 0.2, 1.1), // the seat
      W(0.8, 0.7, 2.3, 1.1, 1.4), // the roll bar
    ],
    plan: { boxes: [[0, 1.1, 0, 2, 2.2, 3.8]] },
    salvage: true, desc: 'rusted old farm tractor, big rear wheels, front faces -Z',
  },
  picnic_table: { size: [1.8, 0.8, 1.6], boxes: [[0, 0.4, 0, 1.8, 0.8, 1.6]], desc: 'wooden picnic table with benches' },
  outhouse: { size: [1.2, 2.3, 1.2], boxes: [[0, 1.15, 0, 1.2, 2.3, 1.2]], desc: 'wooden outhouse with moon cutout door facing -Z' },
  water_tower: {
    size: [4, 12, 4],
    boxes: [
      [-1.6, 4, -1.6, 0.3, 8, 0.3],
      [1.6, 4, -1.6, 0.3, 8, 0.3],
      [-1.6, 4, 1.6, 0.3, 8, 0.3],
      [1.6, 4, 1.6, 0.3, 8, 0.3],
    ],
    cyls: [[0, 0, 2.05, 4, 8]], // the tank (it stops a shot, and a bat)
    plan: {
      boxes: [
        [-1.6, 4, -1.6, 0.3, 8, 0.3],
        [1.6, 4, -1.6, 0.3, 8, 0.3],
        [-1.6, 4, 1.6, 0.3, 8, 0.3],
        [1.6, 4, 1.6, 0.3, 8, 0.3],
      ],
    },
    desc: 'farm water tower: 4 steel legs with cross bracing, wooden/metal tank on top from y=8 to 12',
  },
  watchtower: {
    size: [4, 11, 4],
    boxes: [
      [-1.7, 4, -1.7, 0.35, 8, 0.35],
      [1.7, 4, -1.7, 0.35, 8, 0.35],
      [-1.7, 4, 1.7, 0.35, 8, 0.35],
      [1.7, 4, 1.7, 0.35, 8, 0.35],
      B(-2.15, 2.15, 8, 10.3, -2.2, 2.15), // the cabin
      B(-1.2, 1.2, 10.3, 11.1, -1.2, 1.2), // ...and its roof
    ],
    plan: {
      boxes: [
        [-1.7, 4, -1.7, 0.35, 8, 0.35],
        [1.7, 4, -1.7, 0.35, 8, 0.35],
        [-1.7, 4, 1.7, 0.35, 8, 0.35],
        [1.7, 4, 1.7, 0.35, 8, 0.35],
      ],
    },
    desc: 'fire lookout tower: timber legs with X bracing, small cabin with windows and a pyramid roof on top (floor at y=8)',
  },
  power_pole: { size: [0.3, 9, 2], cyls: [[0, 0, 0.18, 9]], desc: 'wooden utility pole with crossbar near the top (crossbar along X), insulators' },
  streetlight: { size: [0.3, 6, 1.6], cyls: [[0, 0, 0.12, 6]], desc: 'broken street lamp, arm points toward -Z, bulb smashed' },
  road_sign: { size: [0.9, 2.4, 0.1], cyls: [[0, 0, 0.06, 2.4]], desc: 'bent road sign on a post, rusty, bullet holes' },
  dumpster: { size: [1.9, 1.4, 1.2], boxes: [[0, 0.7, 0, 1.9, 1.4, 1.2]], desc: 'green rusty dumpster, lid half open' },
  well: { size: [1.6, 2.2, 1.6], cyls: [[0, 0, 0.8, 0.9]], desc: 'old stone well with a small wooden roof and crank' },
  woodpile: { size: [2.2, 1.1, 1.0], boxes: [[0, 0.55, 0, 2.2, 1.1, 1.0]], desc: 'stacked split firewood logs' },
  scarecrow: { size: [1.4, 2.2, 0.4], cyls: [[0, 0, 0.1, 2.2]], desc: 'creepy scarecrow on a post: burlap sack head with stitched face, tattered clothes, arms on a crossbar' },
  shelf: { size: [1.8, 2.0, 0.5], boxes: [[0, 1.0, 0, 1.8, 2.0, 0.5]], desc: 'metal/wood shelving unit with junk (cans, boxes)' },
  bed: { size: [1.0, 0.6, 2.0], boxes: [[0, 0.3, 0, 1.0, 0.6, 2.0]], desc: 'old stained mattress on a metal bed frame' },
  table: { size: [1.5, 0.8, 0.9], boxes: [[0, 0.4, 0, 1.5, 0.8, 0.9]], desc: 'wooden table' },
  chair: { size: [0.5, 0.9, 0.5], boxes: [[0, 0.25, 0, 0.45, 0.5, 0.45]], desc: 'wooden chair (maybe tipped)' },
  pallet: { size: [1.2, 0.15, 1.0], boxes: [[0, 0.07, 0, 1.2, 0.15, 1.0]], desc: 'wooden pallet' },
  tire_pile: { size: [1.4, 0.8, 1.4], cyls: [[0, 0, 0.65, 0.8]], desc: 'stack of old tires' },
  pew: { size: [2.6, 0.95, 0.6], boxes: [[0, 0.45, 0, 2.6, 0.9, 0.55]], desc: 'wooden church pew facing -Z' },
  altar: { size: [1.8, 1.0, 0.8], boxes: [[0, 0.5, 0, 1.8, 1.0, 0.8]], desc: 'stone altar with a dirty cloth and candles' },
  corpse: { size: [0.6, 0.3, 1.8], desc: 'dead body lying face down in torn clothes with blood (no collision)' },
  body_bag: { size: [0.6, 0.3, 1.9], desc: 'black body bag (no collision)' },
  lantern_post: { size: [0.2, 2.0, 0.4], cyls: [[0, 0, 0.08, 2.0]], desc: 'wooden post with a hanging (dead) lantern' },
  mailbox: { size: [0.3, 1.2, 0.5], cyls: [[0, 0, 0.06, 1.2]], desc: 'rusty rural mailbox on a post' },
  pumpkin: { size: [0.5, 0.4, 0.5], desc: 'rotting pumpkin (no collision)' },
  bones: { size: [0.8, 0.2, 0.8], desc: 'scattered bones and a skull (no collision)' },
  dock_post: { size: [0.3, 2.5, 0.3], cyls: [[0, 0, 0.15, 2.5]], desc: 'mooring post' },
  fuel_tank: { size: [2.2, 2.2, 5], boxes: [W(1.03, 0.25, 1.95, -2.6, 2.5), W(0.62, 1.0, 2.45, -2.6, 2.5), W(1.03, 0, 0.5, -2.2, -1.4), W(1.03, 0, 0.5, 0.6, 1.4)], plan: { boxes: [[0, 1.1, 0, 2.2, 2.2, 5]] }, desc: 'cylindrical above-ground fuel tank lying along Z on cradles' },
  radio_mast: { size: [1.2, 16, 1.2], boxes: [[0, 8, 0, 0.8, 16, 0.8]], desc: 'lattice radio antenna mast with red (dead) light on top' },
  generator: { size: [1.4, 1.1, 0.9], boxes: [[0, 0.55, 0, 1.4, 1.1, 0.9]], salvage: true, desc: 'portable generator, rusty' },
  cart: { size: [1.6, 1.2, 2.6], boxes: [B(-0.83, 0.83, 0.45, 1.1, -1.3, 1.05), B(-0.9, -0.7, 0, 0.9, -0.7, 0.45), B(0.7, 0.9, 0, 0.9, -0.7, 0.45)], plan: { boxes: [[0, 0.6, 0, 1.6, 1.2, 2.6]] }, desc: 'old wooden hay cart with two wheels' },

  // ---- iteration 2: searchable containers (the world spawns a container entity in front of these)
  duffel_bag: { size: [0.8, 0.34, 0.4], desc: 'dirty olive/black duffel bag lying on the ground, strap, half unzipped (no collision)' },
  locker: { size: [0.95, 1.9, 0.5], boxes: [[0, 0.95, 0, 0.95, 1.9, 0.5]], desc: 'pair of dented steel lockers (2 doors) with vents, one door ajar; front faces -Z' },
  cabinet: { size: [1.2, 0.9, 0.55], boxes: [[0, 0.45, 0, 1.2, 0.9, 0.55]], desc: 'low wooden kitchen / supply cabinet with drawers and 2 doors, worn paint; front faces -Z' },
  toolbox: { size: [0.55, 0.3, 0.28], desc: 'red metal toolbox with a handle, rusty corners (no collision)' },
  fridge: { size: [0.8, 1.8, 0.72], boxes: [[0, 0.9, 0, 0.8, 1.8, 0.72]], desc: 'old stained off-white refrigerator, 2 doors, handle on the front (-Z)' },
  medicine_cabinet: { size: [0.9, 1.8, 0.45], boxes: [[0, 0.9, 0, 0.9, 1.8, 0.45]], desc: 'tall white enamelled steel medicine cabinet, glazed doors over a drawer base, a red cross on it; front faces -Z' },
  drug_locker: { size: [0.8, 1.25, 0.6], boxes: [[0, 0.625, 0, 0.8, 1.25, 0.6]], desc: 'squat grey steel controlled-drugs locker, heavy door with a wheel handle and two locks, standing ajar; front faces -Z' },
  wheelchair: { size: [0.65, 0.95, 1.0], desc: 'folding hospital wheelchair, vinyl seat, big spoked wheels (no collision)' },
  log_pile: { size: [4.2, 1.3, 2.4], boxes: [W(2.15, 0, 0.6, -1.2, 1.2), W(2.15, 0.1, 1.27, -0.75, 0.75)], plan: { boxes: [[0, 0.62, 0, 4.2, 1.25, 2.3]] }, desc: 'pile of felled tree trunks stacked along X (bark, cut ends visible), chocked with stakes' },

  // ---- iteration 2: new places & roadside dressing
  jersey_barrier: { size: [3, 0.85, 0.6], boxes: [[0, 0.42, 0, 3, 0.85, 0.6]], desc: 'concrete highway jersey barrier along X, stained, chipped, faded stripes' },
  camper: { size: [2.4, 3.0, 6.6], boxes: [W(1.2, 0, 1.0, -3.36, 3.4), W(1.2, 0.4, 2.82, -2.8, 3.4)], plan: { boxes: [[0, 1.5, 0, 2.4, 3.0, 6.5]] }, salvage: true, desc: 'abandoned 1980s RV / camper van, cab at -Z, beige with brown stripes, flat tires, curtains' },
  ambulance: { size: [2.2, 2.7, 5.8], boxes: [W(1.05, 0, 1.1, -2.92, 2.95), W(1.05, 0.4, 1.9, -2.1, -0.85), W(1.05, 0.5, 2.65, -0.85, 2.95)], plan: { boxes: [[0, 1.35, 0, 2.2, 2.7, 5.7]] }, salvage: true, desc: 'wrecked box ambulance, cab at -Z, white with an orange stripe and red crosses, dead light bar, one rear door hanging open, flat tires' },
  school_bus: { size: [2.6, 3.1, 10.5], boxes: [W(1.37, 0, 1.5, -5.36, 5.36), W(1.37, 0.4, 2.92, -4.25, 5.36)], plan: { boxes: [[0, 1.55, 0, 2.6, 3.1, 10.4]] }, salvage: true, desc: 'rusted yellow school bus, front at -Z, broken windows, flat tires, slightly sunk' },
  dump_truck: {
    size: [2.6, 3.2, 7.2],
    boxes: [
      W(1.4, 0, 1.3, -3.78, -1.6), // the front wheels
      W(1.4, 0.8, 1.3, -1.6, 0.95), // the frame between the axles: a shot goes under it
      W(1.4, 0, 1.3, 0.95, 2.65), // the rear wheels
      W(1.4, 0.82, 1.3, 2.65, 3.61), // (the tail of the frame, clear of the ground)
      W(1.3, 0.6, 1.9, -3.78, -2.6), // the bonnet
      W(1.4, 0.65, 3.15, -2.6, -0.85), // the cab under the bed's guard
      W(1.4, 0.7, 1.6, -0.85, 3.6), // the bed and what is in it
      B(-1.4, -1.2, 1.0, 3.0, -0.85, 3.6), // its sides
      B(1.2, 1.4, 1.0, 3.0, -0.85, 3.6),
    ],
    plan: { boxes: [[0, 1.6, 0, 2.6, 3.2, 7.1]] },
    salvage: true, desc: 'rusty quarry dump truck, cab at -Z, big bed at the back, huge tires',
  },
  boom_gate: { size: [4.6, 1.2, 0.4], cyls: [[-2.1, 0, 0.18, 1.2]], desc: 'checkpoint boom barrier: a post at x=-2.1 with a red/white striped arm along +X at y~1.0 (arm has no collision)' },
  saw_table: { size: [1.6, 1.1, 3.4], boxes: [[0, 0.5, 0, 1.6, 1.0, 3.4]], desc: 'sawmill log carriage / saw table: steel frame table along Z with a big circular saw blade sticking out the middle' },
  gravel_pile: { size: [5, 2.2, 5], cyls: [[0, 0, 2.6, 0.5], [0, 0, 2.0, 1.0], [0, 0, 1.3, 1.5], [0, 0, 0.7, 2.0]], plan: { cyls: [[0, 0, 2.0, 1.6]] }, desc: 'conical pile of grey gravel / crushed rock (quarry)' },
  hunting_stand: {
    size: [1.7, 4.4, 1.7],
    boxes: [
      [-0.7, 1.6, -0.7, 0.14, 3.2, 0.14],
      [0.7, 1.6, -0.7, 0.14, 3.2, 0.14],
      [-0.7, 1.6, 0.7, 0.14, 3.2, 0.14],
      [0.7, 1.6, 0.7, 0.14, 3.2, 0.14],
      B(-0.82, 0.82, 3.2, 3.7, -0.95, 0.8), // the platform
    ],
    plan: {
      boxes: [
        [-0.7, 1.6, -0.7, 0.14, 3.2, 0.14],
        [0.7, 1.6, -0.7, 0.14, 3.2, 0.14],
        [-0.7, 1.6, 0.7, 0.14, 3.2, 0.14],
        [0.7, 1.6, 0.7, 0.14, 3.2, 0.14],
      ],
    },
    desc: 'wooden hunting tree stand: 4 legs, platform at y=3.2 with a camo-tarp covered rail, ladder on the -Z side',
  },
  billboard: { size: [5.6, 6.5, 0.5], cyls: [[-2, 0, 0.16, 6.5], [2, 0, 0.16, 6.5]], desc: 'faded roadside billboard on two wooden posts (sign board 5.4x2.6 at y 3.6-6.2, torn paper, facing -Z)' },
  motel_sign: { size: [2.6, 7, 0.5], cyls: [[0, 0, 0.18, 7]], desc: 'tall vintage motel sign on a steel pole: arrow-shaped board reading MOTEL, dead bulbs, rust' },
  satellite_dish: { size: [2.6, 3.2, 2.6], cyls: [[0, 0, 0.35, 1.6]], desc: 'large white satellite dish on a concrete base, tilted up toward -Z' },
  fence_chain: { size: [3, 2.2, 0.1], boxes: [[0, 1.1, 0, 3, 2.2, 0.12]], desc: 'chain-link fence segment along X, posts at x=+-1.5, sagging mesh, barbed wire on top' },

  // ---- the chapel bell and the Relay Station's radio (shared/fixtures.js)
  church_bell: { size: [2.3, 1.5, 1.1], desc: 'church bell as it hangs in a belfry: lip at y=0, crown bolted into a timber headstock along X at y~0.96 (2.3 long, to the posts either side), clapper, rope wheel at the -X end (no collision)' },
  radio_set: { size: [1.0, 2.5, 0.6], boxes: [[0, 0.43, 0, 1.0, 0.86, 0.56]], desc: 'field radio on a steel equipment cabinet: olive set with a tuning dial, knobs, speaker and a red power lamp, handset off its hook on a coiled cord, whip antenna; front faces -Z' },
  // the mounted gun's nest (shared/mountedgun.js finds it by this prop): what lies there. The gun and its tripod are
  // an entity that can be carried off, so nothing here collides
  // the city's street furniture and what is in its rooms (files of their own)
  ...STREET_PROP_DEFS,
  ...INTERIOR_PROP_DEFS,
  mg_tripod: { size: [1.5, 0.4, 1.5], desc: 'where a machine-gun tripod stands (the tripod itself is not part of it): three olive ammo cans to the right of the spot and spent brass thrown out on the ground' },
};

// props whose static collider can be salvaged for scrap
export const SALVAGE_PROPS = Object.keys(PROPS).filter((k) => PROPS[k].salvage);

// The colliders of a prop as it is drawn for `seed`: { boxes, cyls } (its variant's own, where it has them).
const NONE = [];
export function collidersOf(type, seed = 0) {
  const def = PROPS[type];
  if (!def) return null;
  const vary = def.vary;
  const own = vary ? vary[(((seed | 0) % vary.n) + vary.n) % vary.n] : null;
  return own || def;
}
// What the world is laid out by: { boxes, cyls } (see `plan` above).
export function planOf(type) {
  const def = PROPS[type];
  return def ? def.plan || def : null;
}
// Which thing-to-strip collider number k of a prop belongs to (boxes first, then cylinders): see `units` above.
export function unitOf(type, k) {
  const u = PROPS[type]?.units;
  return u === 'each' ? k : u ? u[k] || 0 : 0;
}
export const boxesOf = (c) => c?.boxes || NONE;
export const cylsOf = (c) => c?.cyls || NONE;
