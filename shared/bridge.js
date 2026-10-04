// The bridge between the island and the mainland: an old steel through-truss bridge of SPANS spans on concrete
// piers, half broken. The car crosses it in the cutscene between the acts (shared/acts.js CROSSING), and from the
// bridgehead it is what the team sees behind them for the rest of the run. Nobody walks on it: it stands in the
// sea, mostly past the edge of the map, and the span nearest the mainland comes down behind the car.
//
// Here is only the plan, from the seed: where the spans and piers are, which span has lost a truss and half its
// deck, where the deck plates are missing, which wrecks stand on it, and the line a car threads through all of it.
// client/render/bridge.js builds the steel from it and client/game/cutscene.js drives the car along carAt().
import { mulberry32, smoothstep } from './rng.js';
import { WATER_LEVEL } from './constants.js';
import { PROPS } from './props.js';

export const BRIDGE = {
  SPANS: 8,
  SPAN: 64, // m from pier to pier
  PANEL: 8, // a truss panel: a vertical every this many metres
  DECK: 9.2, // the roadway between the trusses (m across)
  TRUSS: 9.5, // top chord over the deck
  PIER: 3.2, // a pier is this thick along the bridge
  LANE: 2.3, // a lane's middle is this far off the centre line
  FALL: 0.31, // how far the fallen span has turned about its pier (rad): its landward end in the water
};

// z: where it runs (it runs along x, west from the mainland). shore: x of the mainland's shoreline there.
// deckY: the height of the roadway, which is the height of the bluff it lands on.
// What is in the car's way is APART metres apart or more, and the car eases from one lane to the other over EASE:
// less than the gap two of them leave between them, so it is wholly in the clear lane all the way past each.
const APART = 38;
const EASE = 16;

export function planBridge({ seed, z, shore, deckY }) {
  const rng = mulberry32((seed ^ 0xb21d6e) >>> 0);
  const { SPANS, SPAN, LANE } = BRIDGE;
  const x1 = shore + 6; // the abutment: the landward end of the deck
  const x0 = x1 - SPANS * SPAN; // the island's end, out in the fog
  // span k runs from x1 - (k + 1) * SPAN to x1 - k * SPAN: span 0 is the one that falls. One span in the middle
  // third has lost its north or south truss, and the half of the deck that hung from it
  const broken = rng.int(3, 4);
  const lost = rng.chance(0.5) ? 1 : -1; // the side of the broken span that is gone (+1: +z)
  const spans = [];
  for (let k = 0; k < SPANS; k++) spans.push({ x0: x1 - (k + 1) * SPAN, x1: x1 - k * SPAN, state: k === 0 ? 'fallen' : k === broken ? 'broken' : 'whole', lost: k === broken ? lost : 0, sag: k === broken ? 0.9 : rng.range(0, 0.35) });
  // what is in the way. side: the lane it stands in (+1 / -1), 0: across the middle
  const blocks = []; // { x, side, len }
  const wrecks = [];
  const holes = [];
  let side = rng.chance(0.5) ? 1 : -1;
  const bs = spans[broken];
  const bx = (bs.x0 + bs.x1) / 2;
  for (let x = x0 + 70; x < x1 - SPAN - 20; x += rng.range(APART, APART + 16)) {
    // (the broken span's own gap is the obstacle there, and the car needs room to line up for it)
    if (Math.abs(x - bx) < SPAN / 2 + 7 + EASE + 9) continue;
    if (rng.chance(0.4)) {
      const len = rng.range(5, 9);
      holes.push({ x, lz: side * LANE, len, w: 3.6 });
      blocks.push({ x, side, len: len + 6 });
    } else {
      // a wreck stands in its lane, slewed (the long ones less: they would reach across the deck), wholly on its half
      // of the roadway and clear of the truss
      const type = ['car_wreck', 'car_wreck', 'pickup_truck', 'school_bus', 'ambulance'][rng.int(0, 4)];
      const [wide, , long] = PROPS[type].size;
      const slew = rng.range(-1, 1) * (long > 5.6 ? 0.06 : 0.4);
      const ry = Math.PI / 2 + slew + (rng.chance(0.5) ? Math.PI : 0);
      const reach = (wide / 2) * Math.cos(slew) + (long / 2) * Math.abs(Math.sin(slew)); // how far it reaches across
      const lz = side * Math.min(BRIDGE.DECK / 2 - 0.25 - reach, Math.max(reach + 0.15, LANE + rng.range(-0.2, 0.5)));
      wrecks.push({ type, x, lz, ry, burnt: rng.chance(0.5), seed: rng.int(0, 99) });
      blocks.push({ x, side, len: long + 6 });
    }
    side = -side;
  }
  // the broken span: the car keeps to the side that still has a truss, all the way across it
  blocks.push({ x: bx, side: lost, len: SPAN + 14 });
  blocks.sort((a, b) => a.x - b.x);

  // the car's lateral offset at x: in the lane away from whatever is in the way, easing across between them
  const laneAt = (x) => {
    let lz = 0;
    let w = 0;
    for (const b of blocks) {
      const d = Math.abs(x - b.x) - b.len / 2;
      const k = 1 - smoothstep(0, EASE, d);
      if (k <= 0) continue;
      lz += -b.side * LANE * k;
      w += k;
    }
    return w > 1 ? lz / w : lz;
  };
  const len = x1 - x0;
  // where the car is `s` metres from the island's end of the bridge: its position, and its heading (yaw: the
  // repo's, 0 faces -Z, so due east is -PI / 2)
  const carAt = (s, out = {}) => {
    const x = x0 + s;
    const lz = laneAt(x);
    const dl = (laneAt(x + 1) - laneAt(x - 1)) / 2;
    out.x = x;
    out.y = deckY + deckSag(x);
    out.z = z + lz;
    out.yaw = Math.atan2(-1, -dl);
    return out;
  };
  // how far the deck hangs below its line at x: each span sags a little between its piers, the broken one a lot
  const deckSag = (x) => {
    const sp = spans.find((s) => x >= s.x0 && x <= s.x1);
    if (!sp) return 0;
    const t = (x - sp.x0) / (sp.x1 - sp.x0);
    return -sp.sag * Math.sin(Math.PI * t);
  };
  return { x0, x1, z, deckY, len, water: WATER_LEVEL, spans, broken, lost, holes, wrecks, laneAt, deckSag, carAt };
}
