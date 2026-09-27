// Syntax-checks every JS module (node --check) - quick CI sanity pass.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const roots = ['shared', 'server', 'client', 'scripts'];
let failed = 0;
let n = 0;
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) {
      n++;
      try {
        execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' });
      } catch (e) {
        failed++;
        console.log(`FAIL ${p}\n${e.stderr}`);
      }
    }
  }
};
roots.forEach(walk);
console.log(`${n - failed}/${n} files OK`);
process.exit(failed ? 1 : 0);
