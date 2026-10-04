// Ground items: does every item rest on the ground as it lies there? Builds each one with createPickup
// (client/render/models/pickups.js, the model the game drops at y = ground) and reports its lowest point: below
// -4 mm it is sunk into the ground, above 8 mm it floats. (Parts of one item inside each other need a look: render
// them with the props sandbox, see docs/object-clipping.md.)
//
// usage: node scripts/clip/pickups.js [--root <tree>] [--item stick,grenade] [--json]
// npm run clip:pickups
import './dom-stub.js';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { parseArgs, list, REPO } from './lib.js';

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root || REPO);
const THREE = await import(pathToFileURL(join(root, 'node_modules', 'three', 'build', 'three.module.js')).href);
const { createPickup } = await import(pathToFileURL(join(root, 'client', 'render', 'models', 'pickups.js')).href);
const { ITEM } = await import(pathToFileURL(join(root, 'shared', 'defs.js')).href);
export const SINK = -4, FLOAT = 8; // mm

const out = [];
for (const [key, id] of Object.entries(ITEM)) {
  if (!id) continue;
  const name = key.toLowerCase();
  if (list(args.item) && !list(args.item).some((s) => name.includes(s))) continue;
  const g = createPickup(id);
  g.updateMatrixWorld(true);
  let min = Infinity, max = -Infinity;
  const v = new THREE.Vector3();
  g.traverse((m) => {
    if (!m.isMesh || !m.visible) return;
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      min = Math.min(min, v.y);
      max = Math.max(max, v.y);
    }
  });
  out.push({ id, name, lowest: +(min * 1000).toFixed(1), top: +(max * 1000).toFixed(0) });
}
if (args.json) console.log(JSON.stringify(out));
else {
  for (const o of out) console.log(`${String(o.id).padStart(3)} ${o.name.padEnd(18)} lowest ${String(o.lowest).padStart(7)} mm   top ${String(o.top).padStart(4)} mm  ${o.lowest < SINK ? 'SINKS' : o.lowest > FLOAT ? 'FLOATS' : ''}`);
  const bad = out.filter((o) => o.lowest < SINK || o.lowest > FLOAT);
  console.log(`\n${out.length} ground items, ${bad.length} sunk or floating${bad.length ? ': ' + bad.map((o) => o.name).join(', ') : ''}`);
  process.exitCode = bad.length ? 1 : 0;
}
