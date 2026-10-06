// The nunchucks' moves as a script of events on a clock, for the models sandboxes (?vm=57&nk=..., ?hold=57&nk=...) and
// the clip survey: the same events the game would give the rig (a move begins, its blows land, the heavy attack is
// wound up and let go), at the times the rules give them (shared/nunchaku.js).
//   &nk=guard | draw | idle | whip | backhand | eight | smash | lunge | sweep | retreat | heavy1 | heavy2 | heavy3
//       | combo (the light chain once) | combo2 (twice round) | flourish (the reload key's) | carry (a sprint, then stopping)
//   &hit=flesh|bone|wood|metal|dirt   each blow lands on that (default: every blow misses, and carries through)
import { NK_MOVES, NK_MOVE, NK } from '../../shared/nunchaku.js';

/**
 * -> { events: [{ t, swing?: move, hit?: { kind, power }, flourish?, set?: {...state} }], wind(t): the heavy
 *      wind-up clock at t (0: not winding), dur: how long the script runs, crouch: starts crouched }
 * t is seconds after the script starts.
 */
export function nkScript(name, hit = '') {
  const events = [];
  let windFrom = -1, windTo = -1, dur = 1, crouch = false;
  const swing = (t, m) => {
    const d = NK_MOVES[m];
    events.push({ t, swing: m });
    if (hit) d.hits.forEach((h) => events.push({ t: t + h, hit: { kind: hit, power: d.heavy ? 1 + 0.15 * d.heavy : d.damage > 60 ? 1.25 : 0.8 } }));
    return t + d.rate;
  };
  const chain = (moves) => {
    let t = 0;
    for (const m of moves) t = swing(t, m);
    dur = t + NK.window + 0.5;
  };
  switch (name) {
    case 'combo':
      chain([0, 1, 2, 3]);
      break;
    case 'combo2':
      chain([0, 1, 2, 3, 0, 1, 2, 3]);
      break;
    case 'guard':
    case 'draw':
      dur = 1;
      break;
    case 'idle':
      dur = 12;
      break;
    case 'flourish':
      events.push({ t: 0, flourish: true });
      dur = 7;
      break;
    case 'carry':
      events.push({ t: 0, set: { sprint: true, speed: 7 } }, { t: 1.2, set: { sprint: false, speed: 0 } });
      dur = 2.4;
      break;
    default: {
      const hv = /^heavy([123])$/.exec(name);
      if (hv) {
        const held = [0.2, 0.7, 1.4][+hv[1] - 1];
        windFrom = 0;
        windTo = held;
        dur = swing(held, NK_MOVE.HEAVY1 + +hv[1] - 1) + NK.window + 0.5;
        break;
      }
      const m = NK_MOVES.findIndex((x) => x.name === name);
      if (m < 0) throw new Error(`no nunchucks script '${name}'`);
      crouch = m === NK_MOVE.SWEEP;
      dur = swing(0, m) + NK.window + 0.5;
    }
  }
  events.sort((a, b) => a.t - b.t);
  return { events, dur, crouch, wind: (t) => (windFrom >= 0 && t >= windFrom - 1e-6 && t < windTo - 1e-6 ? t - windFrom + 1 / 120 : 0) };
}
