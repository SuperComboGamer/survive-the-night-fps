// Renders the baked field map for a seed (?seed=123&debug=1 shows sites, containers, part spots, doorways).
import { createWorld } from '../../shared/world.js';
import { ZONE_NAMES } from '../../shared/defs.js';
import { renderMapCanvas, mapX, mapY } from '../ui/mapcanvas.js';

const q = new URLSearchParams(location.search);
const seed = +(q.get('seed') || 12345);
const t0 = performance.now();
const world = createWorld(seed);
const t1 = performance.now();
const cv = renderMapCanvas(world);
const t2 = performance.now();
console.log(`world ${(t1 - t0).toFixed(0)}ms map ${(t2 - t1).toFixed(0)}ms`);
const wrap = document.getElementById('wrap');
wrap.appendChild(cv);
if (q.get('debug')) {
  const ov = document.createElement('canvas');
  ov.width = ov.height = 1280;
  wrap.appendChild(ov);
  const g = ov.getContext('2d');
  const dot = (x, z, r, c) => {
    g.fillStyle = c;
    g.beginPath();
    g.arc(mapX(x), mapY(z), r, 0, Math.PI * 2);
    g.fill();
  };
  for (const c of world.containers) dot(c.x, c.z, 2.2, '#d9a400');
  for (const p of world.partSpots) dot(p.x, p.z, 3.5, '#e0301e');
  for (const o of world.openings) dot(o.x, o.z, 2, '#1e7be0');
  for (const s of world.sites) {
    g.strokeStyle = '#8a1fd6';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(mapX(s.x), mapY(s.z), 7, 0, Math.PI * 2);
    g.stroke();
  }
  dot(world.car.x, world.car.z, 5, '#00ff66');
}
for (const z of world.zones) {
  const l = document.createElement('div');
  l.className = 'lab';
  l.textContent = ZONE_NAMES[z.id];
  l.style.left = mapX(z.x) + 'px';
  l.style.top = mapY(z.z) + 'px';
  wrap.appendChild(l);
}
