// Footprints of what stands and lies in the streets of Port Calder (as shared/props.js: size, boxes, cyls, desc).
import { B, W } from './propbox.js';

export const STREET_PROP_DEFS = {
  // ---- street furniture
  fire_hydrant: { size: [0.4, 0.8, 0.4], cyls: [[0, 0, 0.16, 0.75]], desc: 'a fire hydrant: barrel and bonnet, a hose cap each side and the pumper cap to -Z, faded red or yellow, rusting' },
  mail_dropbox: { size: [0.6, 1.3, 0.6], boxes: [[0, 0.65, 0, 0.6, 1.3, 0.6]], desc: 'the blue round-topped street collection box on four short legs, its chute to -Z, lettering faded, rust at the feet; one variant dented' },
  street_bench: { size: [1.8, 0.9, 0.65], boxes: [[0, 0.225, 0, 1.8, 0.45, 0.6]], desc: 'a bench along X facing -Z: cast-iron ends, wooden slats, some missing or snapped' },
  trash_bin: { size: [0.6, 1.05, 0.6], cyls: [[0, 0, 0.28, 1.0]], desc: 'a municipal litter bin (a slatted drum under a domed lid; or a wire one, its bag heaped over), rubbish at its foot' },
  newspaper_box: { size: [0.5, 1.15, 0.45], boxes: [[0, 0.575, 0, 0.5, 1.15, 0.45]], desc: 'a coin-operated newspaper box on a pedestal, front to -Z: the window broken, the door hanging down; red or blue' },
  phone_booth: {
    size: [1.0, 2.3, 1.0],
    boxes: [
      [0, 1.15, 0.47, 1.0, 2.3, 0.06], // the back
      [-0.47, 1.15, 0, 0.06, 2.3, 1.0],
      [0.47, 1.15, 0, 0.06, 2.3, 1.0],
    ],
    desc: 'a phone booth open to -Z (a survivor can step in): an aluminium frame, kick panels and glass on three sides (the right side smashed out), a light box round the top, the phone on the back wall with its handset hanging on the cord',
  },
  parking_meter: { size: [0.25, 1.45, 0.25], cyls: [[0, 0, 0.05, 1.4]], desc: 'a parking meter facing -Z, leaning a little: one head, or two on a yoke' },
  pole_leaning: { size: [2.4, 8.5, 2.0], cyls: [[0, 0, 0.18, 8]], desc: 'a wooden utility pole leaning toward +X, its crossarm (along Z) and a transformer can near the top, three wires hanging from the crossarm to the ground at +X and trailing off to -Z (the wires stop nobody)' },
  traffic_cones: { size: [2.0, 0.75, 2.0], desc: 'four or five traffic cones, some knocked over, and a barricade lamp on the ground' },
  glass_shards: { size: [2.4, 0.03, 2.4], desc: 'broken glass scattered flat on the ground, a few bits of window frame in it' },
  bicycle: { size: [1.8, 0.6, 0.9], desc: 'a rusty bicycle lying on its side along X; one variant with the front wheel gone and the back one down to its rim' },
  stroller: { size: [0.6, 1.05, 1.0], desc: 'a pram left standing, its handle to +Z: the hood torn back to a bare bow, a blanket hanging out of it' },
  skeleton: { size: [0.7, 0.9, 1.9], desc: 'human remains in rags, years old: on its back (head to +Z); sat slumped against whatever is behind it (its back upright at z = +0.25, legs out to -Z); face down, head to -Z, an arm reaching ahead' },
  // ---- the traffic that never left
  car_open: {
    size: [1.9, 1.45, 4.6],
    // (the doors stand open up to 0.9 m out each side, and stop nobody: a lane between two of these stays a lane)
    boxes: [W(0.93, 0, 0.85, -2.22, 2.22), W(0.9, 0.4, 1.12, -0.7, 1.12), W(0.83, 0.5, 1.38, -0.38, 0.95)],
    plan: { boxes: [[0, 0.72, 0, 1.9, 1.44, 4.5]] },
    salvage: true,
    desc: 'an abandoned sedan, nose to -Z, doors left standing open (they reach up to 0.9 m out past the footprint each side): a civilian car with bags on the roof; a faded yellow taxi; a black-and-white police car with a light bar and a push bumper; a civilian car with the boot open and cases spilled out behind it (as far as z = +2.9)',
  },
  city_bus: { size: [2.6, 3.2, 12.0], boxes: [W(1.29, 0, 2.95, -5.94, 5.93)], plan: { boxes: [[0, 1.55, 0, 2.6, 3.1, 11.9]] }, salvage: true, desc: 'a transit bus, flat front to -Z, its two double doors open on the +X side: most windows out, a faded stripe down it, down on flat tyres; two liveries' },
  box_truck: { size: [2.5, 3.3, 7.6], boxes: [W(1.15, 0, 1.0, -3.73, 3.73), W(1.15, 0.4, 1.55, -3.73, -3.3), W(1.15, 0.5, 2.45, -3.3, -1.88), W(1.23, 0.6, 3.18, -1.88, 3.73)], plan: { boxes: [[0, 1.6, 0, 2.5, 3.2, 7.5]] }, salvage: true, desc: 'a delivery truck, cab to -Z: a box body with a faded panel where the name was, the roll-up door at the back half open on cartons, a flat tyre' },
  van_wreck: { size: [2.0, 2.1, 5.0], boxes: [W(0.98, 0, 1.1, -2.48, 2.48), W(0.98, 0.4, 1.5, -2.1, -1.5), W(0.98, 0.5, 1.95, -1.62, 2.48)], plan: { boxes: [[0, 1.05, 0, 2.0, 2.1, 5.0]] }, salvage: true, desc: 'a panel van, nose to -Z, on its rims, the side door (+X) slid open on the load space; one variant burnt out (bare scorched steel, no glass)' },
  // ---- the army's last stand
  apc_wreck: {
    size: [2.9, 2.7, 7.2],
    boxes: [
      B(-1.4, 1.35, 0, 2.12, -2.4, 2.7), // the hull
      B(-1.4, 1.35, 0.1, 1.6, -3.5, -2.4), // the wedge of its nose, in two steps
      B(-1.4, 1.35, 0.5, 1.9, -3.1, -2.4),
      B(-0.5, 1.0, 1.6, 2.6, -1.6, -0.1), // the turret
      B(-1.0, 1.0, 0, 0.8, 2.7, 3.15), // the ramp, down
    ],
    plan: { boxes: [[0, 1.15, 0, 2.9, 2.3, 7.0]] },
    salvage: true,
    desc: 'a knocked-out eight-wheeled armoured personnel carrier, wedge nose to -Z: sloped olive hull, a small turret with its autocannon slewed and drooping, hatches open, the rear ramp down (+Z), one wheel burnt to the rim and the hull scorched above it',
  },
  army_truck: {
    size: [2.5, 3.3, 7.6],
    boxes: [
      W(1.24, 0, 1.25, -3.75, -2.3), // the front axle and the mudguards
      W(1.24, 0.6, 1.25, -2.3, 0.9), // the frame between the axles: a shot goes under it
      W(1.24, 0, 1.25, 0.9, 3.75), // the rear axles
      W(0.8, 0.7, 1.85, -3.75, -2.6), // the bonnet
      W(1.24, 0.75, 2.5, -2.6, -1.3), // the cab
      W(1.24, 0.8, 3.1, -1.1, 3.75), // the bed under its tilt
    ],
    // (the burnt one is down on its front rims, its cab lower)
    vary: { n: 2, 1: { boxes: [W(1.2, 0, 1.25, -3.75, 3.75), W(0.8, 0.7, 1.5, -3.75, -2.4), W(1.2, 0.75, 2.3, -2.4, -1.3), W(1.24, 0.8, 3.15, -1.1, 3.75)] } },
    plan: { boxes: [[0, 1.6, 0, 2.5, 3.2, 7.5]] },
    salvage: true, desc: 'a 6x6 army cargo truck, cab to -Z: a canvas tilt over bows (torn open on the -X side), the tailgate down, benches and jerry cans in the bed; one variant with the cab burnt out and down on its front rims',
  },
  sandbag_nest: {
    size: [4.2, 1.25, 3.2],
    boxes: [
      [-1.225, 0.6, -1.3, 1.75, 1.2, 0.6], // the front wall, either side of the firing notch
      [1.225, 0.6, -1.3, 1.75, 1.2, 0.6],
      [0, 0.4, -1.3, 0.7, 0.8, 0.6], // under the notch
      [-1.8, 0.6, 0.3, 0.6, 1.2, 2.6], // the side walls
      [1.8, 0.6, 0.3, 0.6, 1.2, 2.6],
    ],
    desc: 'a sandbag fighting position: a U of walls 1.2 m high open to +Z, the front wall (-Z) with a firing notch in its middle; an ammo can and spent brass inside, a torn tarp over one wall',
  },
  concertina: { size: [6.0, 1.0, 1.0], boxes: [[0, 0.45, 0, 6.0, 0.9, 0.9]], desc: 'six metres of triple concertina wire along X: two coils on the ground and one on top between steel pickets, rags caught in it' },
  floodlight_tower: {
    size: [1.8, 5.2, 2.6],
    boxes: [
      B(-0.65, 0.65, 0, 1.22, 0.15, 1.15), // the generator's housing (behind the mast)
      B(-0.6, 0.6, 0, 0.5, -0.7, 0.15), // the frame and the axle
      B(-0.78, 0.78, 4.6, 5.1, -0.15, 0.15), // the bar of lamps
    ],
    cyls: [[0, 0, 0.1, 5.2]],
    plan: { boxes: [[0, 0.6, 0, 1.6, 1.2, 2.4]], cyls: [[0, 0, 0.1, 5.2]] },
    desc: 'a portable diesel light tower on a single-axle trailer, tow hitch to -Z: a faded yellow generator housing, outriggers down, a telescoping mast with four dead floodlights on its bar (two smashed)',
  },
  checkpoint_sign: { size: [1.3, 1.7, 0.9], boxes: [[0, 0.8, 0, 1.3, 1.6, 0.5]], desc: 'a hinged A-frame sign of plywood facing -Z: a hazard-striped border, a stencilled panel, bullet holes, sandbags on its feet' },
  tank_trap: { size: [1.5, 1.4, 1.5], cyls: [[0, 0, 0.55, 1.2]], desc: 'a czech hedgehog: three steel I-beams welded crosswise, heavy rust' },
  triage_tent: {
    size: [5.0, 2.9, 7.0],
    boxes: [
      [-2.42, 1.0, 0, 0.12, 2.0, 7.0],
      [2.42, 1.0, 0, 0.12, 2.0, 7.0],
    ],
    desc: 'a white frame medical tent along Z, both ends open to walk through: red crosses on its walls and gables, the canvas sagging between the frames, one roof panel torn and hanging, guy ropes and pegs along the walls, stains',
  },
  field_cot: { size: [0.75, 0.7, 1.95], boxes: [[0, 0.22, 0, 0.7, 0.44, 1.9]], vary: { n: 3, 2: { boxes: [B(-0.2, 0.37, 0, 0.69, -0.95, 0.95)] } }, plan: { boxes: [[0, 0.22, 0, 0.7, 0.44, 1.9]] }, desc: 'a folding army cot along Z (head to -Z) with a stained blanket; one with the shape of a body under a sheet; one tipped over on its side' },
  iv_stand: { size: [0.6, 1.8, 1.8], desc: 'a wheeled IV pole with an empty bag and its tube; one variant fallen over, lying along +Z' },
};
