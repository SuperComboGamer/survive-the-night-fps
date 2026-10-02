// Prop footprints shared by world generation (server collision) and client models.
// Local space: origin at ground level, center of footprint; FRONT faces -Z; y up.
// size: overall visual bounding box [sx, sy, sz] (meters) the model should roughly fill.
// boxes: collision boxes [cx, cy, cz, sx, sy, sz] in local space (cy = box center height).
// cyls:  collision cylinders [cx, cz, radius, height].
// A box/cyl top is walkable (players can stand on it) if they can step/jump onto it.
// salvage: true -> hitting it with a melee weapon yields scrap (limited per day).

export const PROPS = {
  car: { size: [1.9, 1.45, 4.6], boxes: [[0, 0.72, 0, 1.9, 1.44, 4.5]], desc: 'broken-down rusty sedan, hood propped open, one wheel missing (on a jack/blocks), shattered windows. The quest car at camp.' },
  car_wreck: { size: [1.9, 1.5, 4.5], boxes: [[0, 0.75, 0, 1.9, 1.5, 4.4]], salvage: true, desc: 'abandoned rusted car, variant colors, doors open, weeds' },
  pickup_truck: { size: [2.1, 1.9, 5.4], boxes: [[0, 0.95, 0, 2.1, 1.9, 5.3]], salvage: true, desc: 'old farm pickup truck, rust, flat tire' },
  campfire: { size: [1.9, 0.55, 1.9], cyls: [[0, 0, 0.85, 0.5]], desc: 'ring of stones with charred logs in teepee (flames are added by the renderer at y~0.3)' },
  tent: { size: [2.4, 1.5, 2.8], boxes: [[0, 0.75, 0, 2.4, 1.5, 2.8]], desc: 'torn camping tent, dirty canvas, one side sagging' },
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
      [0, 1.3, -1.5, 2.8, 2.6, 7.0],
      [0, 1.4, 5.0, 0.8, 1.0, 6.0],
    ],
    desc: 'crashed military helicopter lying tilted on its side, broken rotor blades on the ground, scorched, tail boom broken toward +Z',
  },
  military_tent: { size: [4, 2.6, 6], boxes: [[0, 1.3, 0, 4, 2.6, 6]], desc: 'olive military field tent, open flap facing -Z' },
  boat: { size: [1.4, 0.7, 4], boxes: [[0, 0.35, 0, 1.3, 0.7, 3.9]], desc: 'old wooden rowboat, peeling paint' },
  gas_pump: { size: [0.8, 1.9, 0.6], boxes: [[0, 0.95, 0, 0.8, 1.9, 0.6]], desc: '1970s gas pump, faded red, hose' },
  gravestone: { size: [0.6, 0.9, 0.22], boxes: [[0, 0.45, 0, 0.6, 0.9, 0.22]], desc: 'weathered gravestone (variants: rounded, cross top, broken/leaning)' },
  grave_cross: { size: [0.6, 1.4, 0.1], boxes: [[0, 0.7, 0, 0.12, 1.4, 0.12]], desc: 'wooden grave cross, crooked' },
  fence: { size: [3, 1.1, 0.12], boxes: [[0, 0.55, 0, 3, 1.1, 0.14]], desc: 'weathered post-and-rail wooden fence segment along X (posts at x=+-1.5), a rail may be broken' },
  tractor: { size: [2, 2.6, 3.8], boxes: [[0, 1.1, 0, 2, 2.2, 3.8]], salvage: true, desc: 'rusted old farm tractor, big rear wheels, front faces -Z' },
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
    desc: 'farm water tower: 4 steel legs with cross bracing, wooden/metal tank on top from y=8 to 12',
  },
  watchtower: {
    size: [4, 11, 4],
    boxes: [
      [-1.7, 4, -1.7, 0.35, 8, 0.35],
      [1.7, 4, -1.7, 0.35, 8, 0.35],
      [-1.7, 4, 1.7, 0.35, 8, 0.35],
      [1.7, 4, 1.7, 0.35, 8, 0.35],
    ],
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
  fuel_tank: { size: [2.2, 2.2, 5], boxes: [[0, 1.1, 0, 2.2, 2.2, 5]], desc: 'cylindrical above-ground fuel tank lying along Z on cradles' },
  radio_mast: { size: [1.2, 16, 1.2], boxes: [[0, 8, 0, 0.8, 16, 0.8]], desc: 'lattice radio antenna mast with red (dead) light on top' },
  generator: { size: [1.4, 1.1, 0.9], boxes: [[0, 0.55, 0, 1.4, 1.1, 0.9]], salvage: true, desc: 'portable generator, rusty' },
  cart: { size: [1.6, 1.2, 2.6], boxes: [[0, 0.6, 0, 1.6, 1.2, 2.6]], desc: 'old wooden hay cart with two wheels' },

  // ---- iteration 2: searchable containers (the world spawns a container entity in front of these)
  duffel_bag: { size: [0.8, 0.34, 0.4], desc: 'dirty olive/black duffel bag lying on the ground, strap, half unzipped (no collision)' },
  locker: { size: [0.95, 1.9, 0.5], boxes: [[0, 0.95, 0, 0.95, 1.9, 0.5]], desc: 'pair of dented steel lockers (2 doors) with vents, one door ajar; front faces -Z' },
  cabinet: { size: [1.2, 0.9, 0.55], boxes: [[0, 0.45, 0, 1.2, 0.9, 0.55]], desc: 'low wooden kitchen / supply cabinet with drawers and 2 doors, worn paint; front faces -Z' },
  toolbox: { size: [0.55, 0.3, 0.28], desc: 'red metal toolbox with a handle, rusty corners (no collision)' },
  fridge: { size: [0.8, 1.8, 0.72], boxes: [[0, 0.9, 0, 0.8, 1.8, 0.72]], desc: 'old stained off-white refrigerator, 2 doors, handle on the front (-Z)' },
  medicine_cabinet: { size: [0.9, 1.8, 0.45], boxes: [[0, 0.9, 0, 0.9, 1.8, 0.45]], desc: 'tall white enamelled steel medicine cabinet, glazed doors over a drawer base, a red cross on it; front faces -Z' },
  drug_locker: { size: [0.8, 1.25, 0.6], boxes: [[0, 0.625, 0, 0.8, 1.25, 0.6]], desc: 'squat grey steel controlled-drugs locker, heavy door with a wheel handle and two locks, standing ajar; front faces -Z' },
  wheelchair: { size: [0.65, 0.95, 1.0], desc: 'folding hospital wheelchair, vinyl seat, big spoked wheels (no collision)' },
  log_pile: { size: [4.2, 1.3, 2.4], boxes: [[0, 0.62, 0, 4.2, 1.25, 2.3]], desc: 'pile of felled tree trunks stacked along X (bark, cut ends visible), chocked with stakes' },

  // ---- iteration 2: new places & roadside dressing
  jersey_barrier: { size: [3, 0.85, 0.6], boxes: [[0, 0.42, 0, 3, 0.85, 0.6]], desc: 'concrete highway jersey barrier along X, stained, chipped, faded stripes' },
  camper: { size: [2.4, 3.0, 6.6], boxes: [[0, 1.5, 0, 2.4, 3.0, 6.5]], salvage: true, desc: 'abandoned 1980s RV / camper van, cab at -Z, beige with brown stripes, flat tires, curtains' },
  ambulance: { size: [2.2, 2.7, 5.8], boxes: [[0, 1.35, 0, 2.2, 2.7, 5.7]], salvage: true, desc: 'wrecked box ambulance, cab at -Z, white with an orange stripe and red crosses, dead light bar, one rear door hanging open, flat tires' },
  school_bus: { size: [2.6, 3.1, 10.5], boxes: [[0, 1.55, 0, 2.6, 3.1, 10.4]], salvage: true, desc: 'rusted yellow school bus, front at -Z, broken windows, flat tires, slightly sunk' },
  dump_truck: { size: [2.6, 3.2, 7.2], boxes: [[0, 1.6, 0, 2.6, 3.2, 7.1]], salvage: true, desc: 'rusty quarry dump truck, cab at -Z, big bed at the back, huge tires' },
  boom_gate: { size: [4.6, 1.2, 0.4], cyls: [[-2.1, 0, 0.18, 1.2]], desc: 'checkpoint boom barrier: a post at x=-2.1 with a red/white striped arm along +X at y~1.0 (arm has no collision)' },
  saw_table: { size: [1.6, 1.1, 3.4], boxes: [[0, 0.5, 0, 1.6, 1.0, 3.4]], desc: 'sawmill log carriage / saw table: steel frame table along Z with a big circular saw blade sticking out the middle' },
  gravel_pile: { size: [5, 2.2, 5], cyls: [[0, 0, 2.0, 1.6]], desc: 'conical pile of grey gravel / crushed rock (quarry)' },
  hunting_stand: {
    size: [1.7, 4.4, 1.7],
    boxes: [
      [-0.7, 1.6, -0.7, 0.14, 3.2, 0.14],
      [0.7, 1.6, -0.7, 0.14, 3.2, 0.14],
      [-0.7, 1.6, 0.7, 0.14, 3.2, 0.14],
      [0.7, 1.6, 0.7, 0.14, 3.2, 0.14],
    ],
    desc: 'wooden hunting tree stand: 4 legs, platform at y=3.2 with a camo-tarp covered rail, ladder on the -Z side',
  },
  billboard: { size: [5.6, 6.5, 0.5], cyls: [[-2, 0, 0.16, 6.5], [2, 0, 0.16, 6.5]], desc: 'faded roadside billboard on two wooden posts (sign board 5.4x2.6 at y 3.6-6.2, torn paper, facing -Z)' },
  motel_sign: { size: [2.6, 7, 0.5], cyls: [[0, 0, 0.18, 7]], desc: 'tall vintage motel sign on a steel pole: arrow-shaped board reading MOTEL, dead bulbs, rust' },
  satellite_dish: { size: [2.6, 3.2, 2.6], cyls: [[0, 0, 0.35, 1.6]], desc: 'large white satellite dish on a concrete base, tilted up toward -Z' },
  fence_chain: { size: [3, 2.2, 0.1], boxes: [[0, 1.1, 0, 3, 2.2, 0.12]], desc: 'chain-link fence segment along X, posts at x=+-1.5, sagging mesh, barbed wire on top' },

  // ---- the chapel bell and the Relay Station's radio (shared/fixtures.js)
  church_bell: { size: [2.3, 1.5, 1.1], desc: 'church bell as it hangs in a belfry: lip at y=0, crown bolted into a timber headstock along X at y~0.96 (2.3 long, to the posts either side), clapper, rope wheel at the -X end (no collision)' },
  radio_set: { size: [1.0, 2.5, 0.6], boxes: [[0, 0.43, 0, 1.0, 0.86, 0.56]], desc: 'field radio on a steel equipment cabinet: olive set with a tuning dial, knobs, speaker and a red power lamp, handset off its hook on a coiled cord, whip antenna; front faces -Z' },
  // the mounted gun's stand (shared/mountedgun.js finds the nest by it; the gun on top is an entity). The collider
  // is the legs only, low enough that a round from the gunner's eye passes over it
  mg_tripod: { size: [1.5, 1.2, 1.5], cyls: [[0, 0, 0.22, 0.6]], desc: 'tall steel machine-gun tripod, the pintle head at y=1.18 with nothing on it, front leg toward -Z, two olive ammo cans and spent brass at its feet' },
};

// props whose static collider can be salvaged for scrap
export const SALVAGE_PROPS = Object.keys(PROPS).filter((k) => PROPS[k].salvage);
