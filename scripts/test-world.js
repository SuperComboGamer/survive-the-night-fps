// World layout test: the hand-authored places, as a survivor meets them.
// A place is laid out once in shared/world.js and stamped onto every map that has it, so a wall drawn across a
// doorway or a street drawn through a house is there on every one of them. This generates a few valleys and checks,
// for every named place on them:
//   - each doorway can be walked through, both ways, by the real player simulation
//   - each container, floor-loot point and supply spot can be used from somewhere a survivor can walk to from the
//     place's front gate, by the server's own rules (within reach, a clear line from the eye)
//   - none of them is inside something solid, where it can be taken but not seen
//   - no road runs into a building
//   - no solid prop stands in another (a street lamp up through a wreck, a crate through a shed's wall), anywhere on
//     the map, nor a tree or a boulder in one or in a wall (sandbag walls are laid overlapping on purpose)
// Roadside and woodland sites are not checked: they are scattered at random, this is about the authored layouts.
// usage: node scripts/test-world.js [seed ...]
import { createWorld } from '../shared/world.js';
import { createMainland } from '../shared/mainland.js';
import { PLACES } from '../shared/layout.js';
import { ZONE_NAMES } from '../shared/defs.js';
import { checkWorld, comparePrint, printsLine } from './worldcheck.js';

// Between them these four valleys have every place (the test fails if one is missing).
const SEEDS = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [1, 2, 8, 9];
// ...and the mainland of two of them (act 2: the same checks on its places - the city, the ironworks, the airfield)
const MAINLANDS = process.argv.length > 2 ? [] : [1, 2];

// Known failures: what the checks below find wrong today that is being fixed somewhere else. A failure listed here
// is printed but does not fail the test. An entry is a place, a check and the spot in the place's own frame.
// e.g. { place: ZONE.DOCK, check: 'reach', at: [-0.6, 44.5], why: 'the pier deck stops short of its end' }
const KNOWN = [];

// ---------------------------------------------------------------- run
const t0 = performance.now();
const found = new Map(); // failures by place, check and spot: the same authored mistake is one entry however many maps have it
const mapsWith = {}; // place -> how many of the maps have it
const counts = { door: 0, reach: 0, solid: 0, road: 0, props: 0, schem: 0 };

const round = (v) => Math.round(v * 10) / 10 + 0;
// (and each is still the map on record for its seed: one that is not ends the games being played on it at the deploy)
const onRecord = { n: 0, changed: [] };
const look = (seed, world) => {
  comparePrint(seed, world, onRecord);
  checkWorld(world, seed, { found, mapsWith, counts });
};
for (const seed of SEEDS) look(seed, createWorld(seed));
for (const seed of MAINLANDS) look(seed, createMainland(seed));
const prints = printsLine(onRecord);

// ---------------------------------------------------------------- report
const missing = Object.keys(PLACES).filter((id) => !mapsWith[id]).map((id) => ZONE_NAMES[id]);
const known = (f) => KNOWN.find((k) => k.place === f.place && k.check === f.check && Math.hypot(k.at[0] - f.at[0], k.at[1] - f.at[1]) < 0.1);
const all = [...found.values()];
const fresh = all.filter((f) => !known(f));
const line = (f) => `${ZONE_NAMES[f.place]}: ${f.text}, at (${round(f.at[0])}, ${round(f.at[1])}) in the place's frame, on ${f.seeds.length} of ${mapsWith[f.place]} maps (${f.where})`;
console.log(`world layout: ${Object.values(mapsWith).reduce((a, b) => a + b, 0)} places in ${SEEDS.length} valleys (seeds ${SEEDS.join(', ')})${MAINLANDS.length ? ` and ${MAINLANDS.length} mainlands (seeds ${MAINLANDS.join(', ')})` : ''}`);
for (const [check, what] of [
  ['door', 'doorways can be walked through both ways'],
  ['reach', 'containers, floor-loot points and supply spots can be reached on foot from the front gate'],
  ['solid', 'of them are clear of anything solid'],
  ['road', 'walls and posts stand clear of the middle of every road'],
  ['props', 'pairs of solids that could meet (props, trees, boulders, walls) stand clear of each other'],
  ['schem', 'containers a schematic can be hidden in stand in the place it would be rumoured in'],
]) {
  const bad = fresh.filter((f) => f.check === check);
  const old = all.filter((f) => f.check === check && known(f));
  console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${counts[check]} ${what}${bad.length ? ', except:' : old.length ? ` (except the ${old.length} known failures below)` : ''}`);
  for (const f of bad) console.log(`        ${line(f)}`);
}
if (missing.length) console.log(`FAIL  every place is on one of the maps: not ${missing.join(', ')} (pick more seeds)`);
console.log(prints.text);
for (const k of KNOWN) {
  const f = all.find((x) => known(x) === k);
  if (f) console.log(`known   ${line(f)}: ${k.why}`);
  else console.log(`note    the known failure at ${ZONE_NAMES[k.place]} (${k.at.join(', ')}) no longer fails: delete its entry from KNOWN in scripts/test-world.js`);
}
const ok = !fresh.length && !missing.length && prints.ok;
console.log(`${ok ? 'world layout OK' : 'world layout FAILED'}  (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(ok ? 0 : 1);
