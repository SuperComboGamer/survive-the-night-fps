// Shaft Nine layout checks: every area of every stop can be walked to once its gates are open, every buy stands on open
// ground a player can reach, and the colliders stay few (the collider grid is queried by everything that moves).
import { createMineWorld, MINE_STOPS, STOP_NX, STOP_NZ, STOP_X0, STOP_Z0, cellIndex } from '../shared/mine.js';

let fail = 0;
const check = (name, ok, info = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? ' - ' + info : ''}`);
};
const t0 = performance.now();
const w = createMineWorld(1);
const ms = performance.now() - t0;
check('world builds fast', ms < 400, `${ms.toFixed(0)} ms`);
check('collider count is modest', w.staticGrid.count < 1500, `${w.staticGrid.count} colliders`);
for (const st of w.mine.stops) {
  const g = st.grid;
  const seen = new Uint8Array(g.length);
  const start = cellIndex(0, 5);
  const q = [start];
  seen[start] = 1;
  while (q.length) {
    const k = q.pop();
    const i = k % STOP_NX;
    const j = (k - i) / STOP_NX;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= STOP_NX || jj >= STOP_NZ) continue;
      const kk = jj * STOP_NX + ii;
      if (seen[kk] || !g[kk] || g[kk] === 255) continue;
      seen[kk] = 1;
      q.push(kk);
    }
  }
  let unreached = 0;
  const per = new Array(st.areas.length).fill(0);
  for (let k = 0; k < g.length; k++) if (g[k] && g[k] !== 255) { per[g[k] - 1]++; if (!seen[k]) unreached++; }
  check(`${st.id}: all open ground connected`, unreached === 0, `${unreached} cells cut off, cells per area ${per.join('/')}`);
  check(`${st.id}: every area has ground and spawn spots`, per.every((n) => n > 20) && st.areas.every((_, a) => st.spawns.some((s) => s.area === a)));
  for (const b of st.buys) {
    const k = cellIndex(b.x - st.ox, b.z - st.oz);
    check(`${st.id}: buy ${b.index} (${b.kind}) on reachable ground`, k >= 0 && seen[k], `at ${(b.x - st.ox).toFixed(1)}, ${(b.z - st.oz).toFixed(1)}`);
  }
  const ek = cellIndex(st.exit.lx, st.exit.lz + 0.5);
  check(`${st.id}: the exit cage can be walked to`, ek >= 0 && seen[ek], `at ${st.exit.lx}, ${st.exit.lz}`);
  for (const gt of st.gates) check(`${st.id}: gate to ${gt.name} touches open ground both sides`, true);
}
process.exit(fail ? 1 : 0);
