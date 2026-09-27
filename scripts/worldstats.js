// Prints world generation stats for a seed: node scripts/worldstats.js [seed]
import { createWorld } from '../shared/world.js';
import { ZONE_NAMES } from '../shared/defs.js';
const t0 = performance.now();
const w = createWorld(+(process.argv[2] || 12345));
const t1 = performance.now();
console.log('gen ms', (t1 - t0).toFixed(1));
console.log('trees', w.trees.length / 6, 'rocks', w.rocks.length / 6, 'bushes', w.bushes.length / 6);
console.log('parts', w.parts.length, 'props', w.props.length, 'loot', w.lootSpawns.length, 'containers', w.containers.length, 'res', w.resourceSpawns.length, 'horde', w.hordeSpawns.length);
console.log('colliders', w.staticGrid.count, 'partSpots', w.partSpots.length, 'openings', w.openings.length, 'sites', w.sites.length);
const types = {};
for (const s of w.sites) types[s.type] = (types[s.type] || 0) + 1;
console.log('site types', JSON.stringify(types));
let mn = 1e9, mx = -1e9; for (const h of w.heights) { mn = Math.min(mn, h); mx = Math.max(mx, h); }
console.log('height range', mn.toFixed(1), mx.toFixed(1));
for (const z of w.zones) console.log('zone', ZONE_NAMES[z.id].padEnd(22), z.x.toFixed(0).padStart(5), z.z.toFixed(0).padStart(5), 'h', z.h.toFixed(1), 'ry', z.ry.toFixed(2), 'spots', w.partSpots.filter((p) => p.zone === z.id).length, 'cont', w.containers.filter((c) => c.zone === z.id).length);
console.log('roads', w.roads.length, w.roads.map((r) => `${r.kind}:${r.length.toFixed(0)}`).join(' '));
console.log('car', JSON.stringify(w.car));
