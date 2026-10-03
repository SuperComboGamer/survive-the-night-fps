// Entry point. Query params: ?sandbox=<name> for test scenes; ?map=<id>&stop=<n> to jump into a map (debug).
import { gfx } from './core/gfx.js';

const P = new URLSearchParams(location.search);
const fatal = (e) => { console.error(e); window.__fatal = String(e && e.stack || e); const f = document.getElementById('fatal'); f.style.display = 'flex'; f.textContent = window.__fatal; };
addEventListener('error', (e) => fatal(e.error || e.message));
addEventListener('unhandledrejection', (e) => fatal(e.reason));

async function boot() {
  const canvas = document.getElementById('c');
  gfx.init(canvas, { quality: P.get('q') || 'high' });
  window.gfx = gfx;
  if (P.get('sandbox')) {
    const mod = await import(`./sandbox/${P.get('sandbox')}.js`);
    await mod.run(gfx, P);
    return;
  }
  const g = await import('./game/boot.js');
  await g.start(gfx, P);
}
boot().catch(fatal);
