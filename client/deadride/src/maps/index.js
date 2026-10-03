// Map registry (lazy). Each entry: id, module loader.
export const MAPS = [
  { id: 'shaft-nine', load: () => import('./shaft-nine/index.js') },
  { id: 'whiteout', load: () => import('./whiteout/index.js') },
  { id: 'last-ferry', load: () => import('./last-ferry/index.js') },
  { id: 'after-hours', load: () => import('./after-hours/index.js') },
];
export async function loadMap(id) { const e = MAPS.find((m) => m.id === id); if (!e) throw new Error('unknown map ' + id); return (await e.load()).default; }
