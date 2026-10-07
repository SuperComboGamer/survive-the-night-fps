// (working aid) what stands near a spot: node scripts/hitbox/here.js <island|mainland> <seed> <x> <z> [r]
import { worldFor } from '../../shared/worlds.js';
const [map, seed, X, Z, R = 3] = process.argv.slice(2);
const w = worldFor(+seed, map === 'mainland' ? 2 : 1);
const x = +X, z = +Z, r = +R;
console.log('ground', w.heightAt(x, z).toFixed(2), 'zone', w.zoneAt?.(x, z));
for (const p of w.props) if (Math.hypot(p.x - x, p.z - z) < r + 2) console.log(`prop ${p.type} at ${p.x.toFixed(1)} ${p.y.toFixed(2)} ${p.z.toFixed(1)} ry ${p.ry.toFixed(2)} seed ${p.seed}`);
const cols = w.staticGrid.query(x, z, r, []);
const has = (p) => cols.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 0.02 && Math.abs((c.y0 + c.y1) / 2 - p.y) < 0.02);
for (const p of w.parts) if (Math.hypot(p.x - x, p.z - z) < r + Math.max(p.sx, p.sz) / 2) console.log(`part ${p.shape} ${p.mat}${p.hidden ? ' HIDDEN' : ''} at ${p.x.toFixed(1)} ${p.y.toFixed(2)} ${p.z.toFixed(1)} size ${p.sx.toFixed(2)} ${p.sy.toFixed(2)} ${p.sz.toFixed(2)} rot ${(p.rx || 0).toFixed(2)} ${(p.ry || 0).toFixed(2)} ${(p.rz || 0).toFixed(2)} ${has(p) ? 'collides' : 'NO COLLIDER'}`);
for (const c of cols) if (typeof c.tag !== 'object' || !c.tag) console.log(`col ${c.tag} at ${c.x.toFixed(1)} ${c.z.toFixed(1)} y ${c.y0.toFixed(2)}..${c.y1.toFixed(2)} half ${c.hx.toFixed(2)} ${c.hz.toFixed(2)} flags ${c.flags}`);
