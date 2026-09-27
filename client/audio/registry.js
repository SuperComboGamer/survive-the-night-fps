// Central list of every pre-rendered sound bank + a pure render entry point shared by the
// synthesis worker and the main-thread fallback.
import { SFX_DEFS } from './synth.js';
import { AMB_DEFS, MUSIC_DEFS, STINGER_DEFS } from './synth-amb.js';
import { mulberry32, hashString, forestIR, hallIR, chans } from './dsp.js';

export const ALL_DEFS = [...SFX_DEFS, ...AMB_DEFS, ...MUSIC_DEFS, ...STINGER_DEFS];
export const DEF_BY_BANK = new Map(ALL_DEFS.map((d) => [d.bank, d]));

// Render one variant. Returns { chans: Float32Array[], sr }.
// Seeds are deterministic per bank/variant so every client hears the same sounds.
export function renderJob(bank, i, ctxRate) {
  if (bank === 'ir_forest') return { chans: forestIR(ctxRate, 3, 7), sr: ctxRate };
  if (bank === 'ir_hall') return { chans: hallIR(ctxRate, 5, 11), sr: ctxRate };
  const d = DEF_BY_BANK.get(bank);
  if (!d) throw new Error('unknown sound bank ' + bank);
  const out = d.gen(d.sr, mulberry32(hashString(bank + ':' + i)), i);
  return { chans: chans(out), sr: d.sr };
}

// Ordered job list: impulse responses + core sounds first, then late (background) sounds.
export function jobList() {
  const core = [{ bank: 'ir_forest', i: 0 }, { bank: 'ir_hall', i: 0 }];
  const late = [];
  for (const d of ALL_DEFS) {
    for (let i = 0; i < d.n; i++) (d.group === 'late' ? late : core).push({ bank: d.bank, i });
  }
  return { core, late };
}
