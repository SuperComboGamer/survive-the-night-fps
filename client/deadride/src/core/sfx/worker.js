// Synthesis worker: builds library sounds off the main thread so loading never stalls a frame (module worker, no DOM).
//   main -> worker: {t:'init', sr}  {t:'job', id, name, i, remote:{fn,args}, opts}
//   worker -> main: {t:'ready'}     {t:'done', id, chs:[Float32Array...], sr} (buffers transferred)  or {t:'done', id, error}
// fn 'lib' = a sound installed by installAll() (same registry as the main thread, identical seeds -> identical audio); other fns rebuild dynamic material from plain data.
import * as dsp from '../dsp.js';
import { Library, makeShimCtx } from './library.js';
import { installAll } from './index.js';
import { bedSpec } from './beds.js';
import { buildVoice } from './voices.js';
import { renderPhrase } from './music.js';

let lib = null;
// pure modules that register external sounds through registerSounds(audio) (weapon sounds): loaded here too, so those generators (100-300 ms each on the main thread) also run off it
const EXT_MODULES = ['../../game/weapons/sounds.js'];
async function loadExternal() {
  for (const u of EXT_MODULES) { try { const m = await import(u), reg = m.registerSounds || m.default; if (typeof reg === 'function') reg({ lib, ready: true, register: (n, g) => lib.register(n, g), has: (n) => lib.has(n), get: () => null }); } catch (e) { /* absent or not worker-safe: those sounds simply stay on the main thread */ } }
  return lib.names().filter((n) => { const d = lib.defs.get(n); return d && d.external; });
}
const MAKERS = {
  bed: (a) => bedSpec(a.def).make,
  voice: (a) => (K, i) => buildVoice(K, a.P, a.cat, i),
  phrase: (a) => () => renderPhrase(a.sr, a.opts),
  ir: (a) => (K) => dsp.irGen(K.sr, a.spec),
  noise: (a) => (K) => { const L = 6, xf = 0.6; return K.makeLoop(K.noise(L + xf, a.color), xf); },
};
self.onmessage = (e) => {
  const m = e.data;
  if (m.t === 'init') { lib = new Library(makeShimCtx(m.sr)); installAll(lib); loadExternal().then((ext) => self.postMessage({ t: 'ready', ext })); return; }
  if (m.t !== 'job') return;
  try {
    const d = m.remote.fn === 'lib' ? lib.defs.get(m.name) : { name: m.name, n: 1, ...m.opts, make: MAKERS[m.remote.fn](m.remote.args) };
    if (!d) throw new Error('unknown sound ' + m.name);
    const t0 = performance.now(), out = lib.produce(d, m.i);
    if (out.ext) self.postMessage({ t: 'done', id: m.id, ext: out.ext, ms: performance.now() - t0 }, out.ext.flatMap((e) => e.chs.map((a) => a.buffer)));
    else self.postMessage({ t: 'done', id: m.id, chs: out.chs, sr: out.sr, ms: performance.now() - t0 }, out.chs.map((a) => a.buffer));
  } catch (err) { self.postMessage({ t: 'done', id: m.id, error: String((err && err.stack) || err) }); }
};
