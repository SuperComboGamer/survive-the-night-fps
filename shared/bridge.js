// The bridge between the island and the mainland: an old steel through-truss bridge of SPANS spans on concrete
// piers, half broken. The car crosses it in the cutscene between the acts (shared/acts.js CROSSING), and from the
// bridgehead it is what the team sees behind them for the rest of the run. Nobody walks on it: it stands in the
// sea, mostly past the edge of the map, and the span nearest the mainland comes down behind the car.
//
// Here is only the plan, from the seed: where the spans and piers are, which span has lost a truss and half its
// deck, which has its top steel down across one lane, where the deck plates are missing, which wrecks stand on it
// (the whole length of it: nobody got across), and the line a car threads through all of it.
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
//
// What is in the car's way comes in clusters - a wreck or two and a hole, all in one lane - and the car takes the
// other lane past each. It eases from lane to lane over EASE metres, and two clusters leave GAP or more of clear
// deck between them (more than EASE), so it is wholly in the clear lane all the way past every one of them.
const EASE = 16;
const GAP = 18;
const MARGIN = 3; // a cluster is given this much room at either end of what is in it
const WIDE = 3.4; // a wreck wider than this (the jackknifed lorry) takes more than its lane: the car keeps to the
const KERB_LANE = 2.95; // kerb past it, this far off the centre line
export const DAMAGED = [2, 5]; // the panels of the damaged span whose top steel is down on the deck (from, to)
// what stands on the deck, and how often: [prop, weight, at most this many on the bridge]
const WRECKS = [['car_wreck', 3, 99], ['car_burnt', 3, 99], ['pickup_truck', 1.2, 99], ['ambulance', 0.8, 2], ['school_bus', 0.8, 1], ['semi_truck', 0.9, 1]];

export function planBridge({ seed, z, shore, deckY }) {
  const rng = mulberry32((seed ^ 0xb21d6e) >>> 0);
  const { SPANS, SPAN, LANE, PANEL, DECK } = BRIDGE;
  const x1 = shore + 6; // the abutment: the landward end of the deck
  const x0 = x1 - SPANS * SPAN; // the island's end, out in the fog
  // span k runs from x1 - (k + 1) * SPAN to x1 - k * SPAN: span 0 is the one that falls. One span in the middle
  // third has lost its north or south truss, and the half of the deck that hung from it ('broken'); two spans on
  // towards the island another has had the top steel of one side come down across that side of its deck
  // ('damaged': its lost is the side that fell). Every span has a diagonal or two gone (snapped: [panel, side]).
  const broken = rng.int(3, 4);
  const lost = rng.chance(0.5) ? 1 : -1; // the side of the broken span that is gone (+1: +z)
  const damaged = broken + 2;
  const fell = rng.chance(0.5) ? 1 : -1;
  const spans = [];
  for (let k = 0; k < SPANS; k++) {
    const state = k === 0 ? 'fallen' : k === broken ? 'broken' : k === damaged ? 'damaged' : 'whole';
    const snapped = [];
    for (let n = rng.int(0, 2); n > 0; n--) snapped.push([rng.int(1, SPAN / PANEL - 2), rng.chance(0.5) ? 1 : -1]);
    spans.push({ x0: x1 - (k + 1) * SPAN, x1: x1 - k * SPAN, state, lost: k === broken ? lost : k === damaged ? fell : 0, sag: k === broken ? 0.9 : k === damaged ? 0.6 : rng.range(0, 0.35), snapped });
  }
  // what is in the way. side: the lane it stands in (+1 / -1)
  const blocks = []; // { x, side, len }
  const wrecks = [];
  const holes = [];
  const bs = spans[broken];
  const ds = spans[damaged];
  // the two spans that are obstacles themselves: the car keeps to the side that still has its truss (its steel up)
  const own = [
    { x: (bs.x0 + bs.x1) / 2, side: lost, len: SPAN + 14 },
    { x: ds.x0 + ((DAMAGED[0] + DAMAGED[1]) / 2) * PANEL, side: fell, len: (DAMAGED[1] - DAMAGED[0]) * PANEL + 8 },
  ];
  const count = {};
  // (a prop this build has no model of is left out of the draw)
  const drawWreck = () => {
    const list = WRECKS.filter(([type, , most]) => PROPS[type] && (count[type] || 0) < most);
    let r = rng() * list.reduce((sum, e) => sum + e[1], 0);
    for (const [type, wt] of list) if ((r -= wt) <= 0) return type;
    return list[0][0];
  };
  let side = rng.chance(0.5) ? 1 : -1;
  for (let at = x0 + 26 + rng.range(0, 10); ; ) {
    // a cluster: one to three things in a row in this lane
    const items = [];
    let x = at;
    for (let n = rng.int(2, 4); n > 0; n--) {
      const hole = rng.chance(0.22);
      const type = drawWreck();
      const long = hole ? rng.range(5, 9) : PROPS[type].size[2];
      const slew = rng.range(-1, 1) * (hole || PROPS[type].size[0] <= WIDE ? (long > 5.6 ? 0.06 : 0.4) : 0);
      items.push({ hole, type, long, slew, turned: rng.chance(0.5), off: rng.range(-0.2, 0.5), seed: rng.int(0, 99), x: x + long / 2 });
      x += long + rng.range(2.5, 6);
    }
    const end = items[items.length - 1].x + items[items.length - 1].long / 2;
    if (end + MARGIN > x1 - SPAN - GAP) break;
    // (not where a span is its own obstacle, nor so near one that the car could not change lanes between them)
    const hit = own.find((o) => at - MARGIN - GAP < o.x + o.len / 2 && end + MARGIN + GAP > o.x - o.len / 2);
    if (hit) {
      at = hit.x + hit.len / 2 + GAP + MARGIN + rng.range(0, 6);
      continue;
    }
    let lane = LANE;
    for (const it of items) {
      if (it.hole) holes.push({ x: it.x, lz: side * LANE, len: it.long, w: 3.6 });
      else if (PROPS[it.type].size[0] > WIDE) {
        // (hard against its own truss, and still over the centre line)
        wrecks.push({ type: it.type, x: it.x, lz: side * (DECK / 2 - 0.1 - PROPS[it.type].size[0] / 2), ry: Math.PI / 2 + (it.turned ? Math.PI : 0), burnt: false, seed: it.seed });
        count[it.type] = (count[it.type] || 0) + 1;
        lane = KERB_LANE;
      }
      else {
        // a wreck stands in its lane, slewed (the long ones less: they would reach across the deck), wholly on its
        // half of the roadway and clear of the truss
        const wide = PROPS[it.type].size[0];
        const reach = (wide / 2) * Math.cos(it.slew) + (it.long / 2) * Math.abs(Math.sin(it.slew)); // how far it reaches across
        const lz = side * Math.min(DECK / 2 - 0.25 - reach, Math.max(reach + 0.15, LANE + it.off));
        wrecks.push({ type: it.type, x: it.x, lz, ry: Math.PI / 2 + it.slew + (it.turned ? Math.PI : 0), burnt: it.type === 'car_burnt', seed: it.seed });
        count[it.type] = (count[it.type] || 0) + 1;
      }
    }
    blocks.push({ x: (at + end) / 2, side, len: end - at + MARGIN * 2, lane });
    side = -side;
    at = end + MARGIN * 2 + GAP + rng.range(0, 5);
  }
  blocks.push(...own);
  blocks.sort((p, q) => p.x - q.x);

  // the car's lateral offset at x: in the lane away from whatever is in the way, easing across between them
  const laneAt = (x) => {
    let lz = 0;
    let w = 0;
    for (const b of blocks) {
      const d = Math.abs(x - b.x) - b.len / 2;
      const k = 1 - smoothstep(0, EASE, d);
      if (k <= 0) continue;
      lz += -b.side * (b.lane || LANE) * k;
      w += k;
    }
    return w > 1 ? lz / w : lz;
  };
  // Along the kerbs as well, wherever the car is not on that side of the roadway: cars left against the rail, and
  // plates gone that the water shows through. The whole length of the deck is like this: nobody got across.
  const KERB = DECK / 2 - DECK / 8; // the middle of the plate by the kerb
  const KERBSIDE = ['car_wreck', 'car_burnt', 'car_burnt', 'pickup_truck']; // (what is narrow enough to be passed there)
  for (let x = x0 + 12; x < x1 - SPAN - 6; x += rng.range(7, 15)) {
    const sd = rng.chance(0.5) ? 1 : -1;
    const wreck = rng.chance(0.5);
    const type = KERBSIDE[rng.int(0, KERBSIDE.length - 1)];
    const long = wreck ? PROPS[type].size[2] : rng.range(2, 6);
    const slew = rng.range(-0.05, 0.05);
    const turned = rng.chance(0.5);
    const wseed = rng.int(0, 99);
    const sp = spans.find((q) => x >= q.x0 && x <= q.x1);
    if (!sp || sp.state === 'broken') continue;
    // (clear of the car's line for the whole of its length, and of what is on that side already)
    let clear = true;
    for (let dx = -long / 2 - 3; dx <= long / 2 + 3 && clear; dx += 1) clear = sd * laneAt(x + dx) <= 0.05;
    if (!clear) continue;
    if (wrecks.some((w) => Math.sign(w.lz) === sd && Math.abs(w.x - x) < PROPS[w.type].size[2] / 2 + long / 2 + 1.5)) continue;
    if (holes.some((h) => Math.sign(h.lz) === sd && Math.abs(h.x - x) < h.len / 2 + long / 2 + 1)) continue;
    if (wreck && sp.state !== 'damaged') {
      const wide = PROPS[type].size[0];
      const reach = (wide / 2) * Math.cos(slew) + (long / 2) * Math.abs(Math.sin(slew));
      wrecks.push({ type, x, lz: sd * (DECK / 2 - 0.25 - reach), ry: Math.PI / 2 + slew + (turned ? Math.PI : 0), burnt: type === 'car_burnt', seed: wseed });
    } else if (!wreck) holes.push({ x, lz: sd * KERB, len: long, w: DECK / 4 });
  }
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
  return { x0, x1, z, deckY, len, water: WATER_LEVEL, spans, broken, lost, damaged, holes, wrecks, laneAt, deckSag, carAt };
}
