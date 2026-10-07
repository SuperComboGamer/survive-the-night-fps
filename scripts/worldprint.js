// The maps on record (scripts/worldprints.json): for a few seeds, the fingerprint of the island and of the mainland
// that a deploy goes by when it carries a running game over to the new server (server/handoff.js worldPrint, its
// `shape`: the colliders, the loot, container, supply and spawn spots, the places). A build that makes another map of
// a game's seed cannot restore that game: deploying it ends every game being played on that map.
//
// test-world.js and test-mainland.js compare the maps they build with this record and fail when one differs. That
// failure is the signal, before the merge, that the change ends running games. If the map is meant to change, make
// the record again with --update, commit it, and say so in the pull request's Risk section.
//
// usage: node scripts/worldprint.js            the maps of this tree against the record (exit 1 when one differs)
//        node scripts/worldprint.js --update   write this tree's maps as the record
import { writeFileSync } from 'node:fs';
import { worldFor } from '../shared/worlds.js';
import { WORLD } from '../shared/acts.js';
import { worldPrint } from '../server/handoff.js';
import { PRINTS_FILE, PRINT_SEEDS, recordedPrints, comparePrint, printsLine } from './worldcheck.js';

const update = process.argv.includes('--update');
const now = { island: {}, mainland: {} };
const onRecord = { n: 0, changed: [] };
for (const [map, act] of [
  ['island', WORLD.ISLAND],
  ['mainland', WORLD.MAINLAND],
]) {
  for (const seed of PRINT_SEEDS[map]) {
    const world = worldFor(seed, act);
    now[map][seed] = worldPrint(world).shape;
    if (!update) comparePrint(seed, world, onRecord);
  }
}

if (update) {
  let was = null;
  try {
    was = recordedPrints();
  } catch {}
  const changed = [];
  for (const map of Object.keys(now)) for (const seed of Object.keys(now[map])) if (was?.[map]?.[seed] !== now[map][seed]) changed.push(`${map} ${seed}`);
  const about = "The maps a deploy can carry a running game over: see scripts/worldprint.js. Do not edit by hand. A test that fails against this file means the change ends running games when it is deployed; 'node scripts/worldprint.js --update' records the new maps once that is meant, and the pull request's Risk section says so.";
  writeFileSync(PRINTS_FILE, JSON.stringify({ about, ...now }, null, 2) + '\n');
  if (!was) console.log(`recorded ${changed.length} maps`);
  else console.log(changed.length ? `recorded: ${changed.join(', ')} changed. Deploying this cannot carry over the games being played on those maps: say so in the pull request's Risk section.` : 'recorded: nothing changed');
  process.exit(0);
}
for (const c of onRecord.changed) console.log(`${c.map} of seed ${c.seed}: ${c.was} on record, ${c.now} now`);
const line = printsLine(onRecord);
console.log(line.text);
process.exit(line.ok ? 0 : 1);
