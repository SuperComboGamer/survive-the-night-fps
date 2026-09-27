// Node-side sanity check for every procedural sound: `node client/audio/selftest.js [--verbose]`
// Verifies no NaN/Infinity, peak <= 1, non-silent RMS, sane durations, seamless loops, and reports render time.
import { ALL_DEFS, renderJob, jobList } from './registry.js';

const verbose = typeof process !== 'undefined' && process.argv.includes('--verbose');
let failures = 0;
let total = 0;
const fail = (msg) => {
  failures++;
  console.log('FAIL', msg);
};

const { core, late } = jobList();
for (const [group, jobs] of [['core', core], ['late', late]]) {
  let gt = 0;
  for (const { bank, i } of jobs) {
    const t0 = performance.now();
    const { chans, sr } = renderJob(bank, i, 48000);
    const dt = performance.now() - t0;
    gt += dt;
    let peak = 0;
    let sum = 0;
    let bad = 0;
    let n = 0;
    for (const c of chans) {
      for (let k = 0; k < c.length; k++) {
        const v = c[k];
        if (!Number.isFinite(v)) bad++;
        const a = Math.abs(v);
        if (a > peak) peak = a;
        sum += v * v;
      }
      n += c.length;
    }
    const rms = Math.sqrt(sum / Math.max(1, n));
    const dur = chans[0].length / sr;
    const name = `${bank}#${i}`;
    if (bad) fail(`${name}: ${bad} non-finite samples`);
    if (peak > 1.0001) fail(`${name}: peak ${peak.toFixed(3)} > 1`);
    if (rms < 0.004) fail(`${name}: nearly silent (rms ${rms.toFixed(4)})`);
    if (!(dur > 0.01 && dur < 15)) fail(`${name}: odd duration ${dur}`);
    if (bank.startsWith('loop_') || bank.startsWith('bed_')) {
      // seamless: jump between last and first sample should be similar to typical sample-to-sample step
      for (const c of chans) {
        let step = 0;
        for (let k = 1; k < c.length; k++) step += Math.abs(c[k] - c[k - 1]);
        step /= c.length - 1;
        const jump = Math.abs(c[0] - c[c.length - 1]);
        if (jump > step * 12 + 0.02) fail(`${name}: loop seam jump ${jump.toFixed(4)} vs avg step ${step.toFixed(4)}`);
      }
    }
    if (dt > 250) console.log(`WARN ${name}: render took ${dt.toFixed(0)}ms (> 250ms per sound; machine busy?)`);
    if (verbose) console.log(`${name.padEnd(22)} ${dt.toFixed(1).padStart(6)}ms ${dur.toFixed(2)}s ch${chans.length} sr${sr} peak ${peak.toFixed(3)} rms ${rms.toFixed(3)}`);
  }
  total += gt;
  console.log(`${group}: ${jobs.length} buffers rendered in ${gt.toFixed(0)}ms`);
}
console.log(`banks: ${ALL_DEFS.length}, total render ${total.toFixed(0)}ms, failures: ${failures}`);
if (failures && typeof process !== 'undefined') process.exitCode = 1;
