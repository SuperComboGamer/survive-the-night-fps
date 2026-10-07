// A prop with its colliders drawn over it, before and after, as a PNG (no browser): the model from the side and
// from three quarters, the colliders as tinted boxes with their edges, and the instrument's numbers under each.
// usage: node scripts/hitbox/overlay.js <type>[:variant] ... [--before <tree or props.js of the build to compare>] [--out shots/pr/hitbox-pass/overlay]
//        node scripts/hitbox/overlay.js --all vehicles | --all <a regular expression>
//   --before  another checkout (its shared/props.js gives the "before" colliders); without it only "now" is drawn
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PROPS, variantsOf, collidersOf, measure } from './lib.js';
import { collidersOf as collidersFor } from '../../shared/props.js';
import { Canvas, ortho, drawModel, drawColliders } from './draw.js';
import { parseArgs, REPO } from '../clip/lib.js';

export const VEHICLES = ['car', 'car_wreck', 'car_open', 'car_burnt', 'pickup_truck', 'van_wreck', 'box_truck', 'city_bus', 'school_bus', 'ambulance', 'camper', 'army_truck', 'semi_truck', 'fire_truck', 'dump_truck', 'fuel_truck', 'apc_wreck', 'tractor', 'baggage_cart', 'heli_wreck', 'light_plane', 'plane_wreck', 'airliner_wreck'];

const W = 560, H = 340;
function panel(model, cols, title, tint) {
  const cv = new Canvas(W * 2, H + 44);
  const b = model.box.slice();
  for (const c of cols) {
    b[0] = Math.min(b[0], c.box ? c.x0 : c.cx - c.r);
    b[3] = Math.max(b[3], c.box ? c.x1 : c.cx + c.r);
    b[1] = Math.min(b[1], c.y0);
    b[4] = Math.max(b[4], c.y1);
    b[2] = Math.min(b[2], c.box ? c.z0 : c.cz - c.r);
    b[5] = Math.max(b[5], c.box ? c.z1 : c.cz + c.r);
  }
  const at = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
  const size = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
  const views = [[Math.PI / 2, 0.06, Math.max((b[5] - b[2]) * (H / W) * 1.12, (b[4] - b[1]) * 1.25, 1)], [2.45, 0.42, size * 0.78]];
  views.forEach(([yaw, pitch, span], i) => {
    const sub = new Canvas(W, H, [30, 33, 38]);
    const cam = ortho(sub, at, yaw, pitch, span);
    // the ground it stands on
    const g = size * 0.8;
    const corners = [[at[0] - g, 0, at[2] - g], [at[0] + g, 0, at[2] - g], [at[0] + g, 0, at[2] + g], [at[0] - g, 0, at[2] + g]].map((p) => cam(...p).map((x, k) => (k === 2 ? x + 0.01 : x)));
    sub.tri(corners[0], corners[1], corners[2], [52, 56, 60]);
    sub.tri(corners[0], corners[2], corners[3], [52, 56, 60]);
    drawModel(sub, cam, model);
    drawColliders(sub, cam, cols, tint);
    cv.blit(sub, i * W, 0);
  });
  const r = measure(model, cols);
  cv.text(title, 8, 6, [255, 255, 255], 2, [0, 0, 0]);
  cv.text(`${cols.length} colliders   solid air ${r.shotAir.toFixed(2)} m3 (worst ${r.shotAirMax.toFixed(2)} m)   hole ${r.shotHole.toFixed(2)} m3 (thick ${r.shotHoleThick.toFixed(2)} m)`, 8, H + 6, [230, 230, 230], 2);
  cv.text(`walk: air ${r.moveAir.toFixed(2)} m2 (${r.moveAirMax.toFixed(2)} m)  hole ${r.moveHole.toFixed(2)} m2 (${r.moveHoleMax.toFixed(2)} m)   feet off the model by up to ${r.standMax.toFixed(2)} m`, 8, H + 24, [190, 190, 190], 2);
  return cv;
}

export async function overlay(type, vi, beforeDefs, out) {
  const models = variantsOf(type);
  const model = models[Math.min(vi, models.length - 1)];
  const now = collidersOf(collidersFor(type, vi));
  const rows = [];
  if (beforeDefs?.[type]) rows.push(panel(model, collidersOf(beforeDefs[type]), `${type} #${vi}  BEFORE`, [255, 70, 60]));
  rows.push(panel(model, now, `${type} #${vi}  ${beforeDefs ? 'AFTER' : 'NOW'}`, [70, 220, 110]));
  const cv = new Canvas(W * 2, rows.length * (H + 44) + (rows.length - 1) * 4, [0, 0, 0]);
  rows.forEach((r, i) => cv.blit(r, 0, i * (H + 48)));
  const file = join(out, `${type}${models.length > 1 ? '-' + vi : ''}.png`);
  cv.save(file);
  return file;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/hitbox/overlay.js')) {
  const args = parseArgs(process.argv.slice(2), { out: join(REPO, 'shots', 'pr', 'hitbox-pass', 'overlay') });
  let beforeDefs = null;
  if (args.before) {
    const f = resolve(String(args.before));
    beforeDefs = (await import(pathToFileURL(existsSync(join(f, 'shared', 'props.js')) ? join(f, 'shared', 'props.js') : f).href)).PROPS;
  }
  let list = args._.map(String);
  if (args.all) list = args.all === 'vehicles' ? VEHICLES : Object.keys(PROPS).filter((t) => new RegExp(String(args.all)).test(t));
  for (const what of list) {
    const [type, v] = what.split(':');
    if (!PROPS[type]) continue;
    const n = variantsOf(type).length;
    for (const vi of v !== undefined ? [+v] : args.variants ? [...Array(n).keys()] : [0]) console.log(await overlay(type, vi, beforeDefs, resolve(String(args.out))));
  }
}
