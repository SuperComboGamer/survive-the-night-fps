// Inclusive time per function of a .cpuprofile that profile.js saved (shots/perf/profile-<scene>.cpuprofile): how
// much of the busy time was spent in a function and everything it called. With --frames n: as ms per frame.
// usage: node scripts/perf/inclusive.js <file.cpuprofile> [--top 40] [--frames n] [--grep re]
import { readFileSync } from 'node:fs';
const [file, ...rest] = process.argv.slice(2);
const opt = (k, d) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : d);
const P = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map(P.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of P.nodes) for (const c of n.children || []) parent.set(c, n.id);
const self = new Map();
P.samples.forEach((id, i) => self.set(id, (self.get(id) || 0) + P.timeDeltas[i]));
const key = (n) => `${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
const incl = new Map();
let total = 0, idle = 0;
for (const [id, t] of self) {
  const n = byId.get(id);
  if (n.callFrame.functionName === '(idle)') {
    idle += t;
    continue;
  }
  total += t;
  const seen = new Set();
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    const k = key(byId.get(cur));
    if (seen.has(k)) continue; // (recursion: once)
    seen.add(k);
    incl.set(k, (incl.get(k) || 0) + t);
  }
}
const frames = +opt('--frames', 0);
const re = opt('--grep', null) ? new RegExp(opt('--grep')) : null;
console.log(`busy ${(total / 1000).toFixed(0)} ms, idle ${(idle / 1000).toFixed(0)} ms${frames ? `, ${(total / 1000 / frames).toFixed(2)} ms a frame over ${frames} frames` : ''}`);
for (const [k, v] of [...incl].filter(([k]) => !re || re.test(k)).sort((a, b) => b[1] - a[1]).slice(0, +opt('--top', 40))) console.log(`${((v / total) * 100).toFixed(1).padStart(5)}%${frames ? ` ${(v / 1000 / frames).toFixed(3).padStart(7)} ms` : ''}  ${k}`);
