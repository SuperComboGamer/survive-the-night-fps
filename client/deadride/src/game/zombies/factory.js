// Variant registry + geometry factory. registerVariants(mapId, defs) stores variant definitions; buildLook(def, look) builds ONE
// look (3 LODs packed into one set of typed arrays, index ranges per LOD) — pure data, so build workers (buildworker.js) and the
// IndexedDB cache can produce it; installLook() wraps arrays that arrive from a worker into the shared asset cache (zero-copy).
// getVariantAssets(def) is the synchronous path (sandbox / tools / fallback): builds whatever looks are still missing.
import { makeRng, strHash } from '../../core/util.js';
import { Outfit } from './parts.js';
import { finalizeArrays, geometryFromArrays } from './mesh.js';
import { buildBodyCage } from './body.js';

export const REGISTRY = { variants: new Map(), maps: new Map(), aliases: new Map() };

/** Register a map's zombie set. defs: [variantDef]. opts.aliases: {oldId: newId} */
export function registerVariants(mapId, defs = [], opts = {}) {
  const list = REGISTRY.maps.get(mapId) || [];
  for (const d of defs) {
    if (!d || typeof d !== 'object' || !d.id) continue; // (plain id strings in a map definition are ignored)
    const def = normalize(d, mapId); REGISTRY.variants.set(def.id, def); if (!list.includes(def.id)) list.push(def.id);
  }
  REGISTRY.maps.set(mapId, list);
  if (opts.aliases) for (const [a, b] of Object.entries(opts.aliases)) REGISTRY.aliases.set(a, b);
  return list;
}
/** id → variantDef. Unknown ids fall back to: alias → a variant of the current map (random) → same id prefix → first registered. */
export function resolveVariant(id, mapId = null) {
  if (REGISTRY.variants.has(id)) return REGISTRY.variants.get(id);
  const a = REGISTRY.aliases.get(id); if (a && REGISTRY.variants.has(a)) return REGISTRY.variants.get(a);
  const list = mapId && REGISTRY.maps.get(mapId); if (list && list.length) return REGISTRY.variants.get(list[(Math.random() * list.length) | 0]);
  for (const [k, v] of REGISTRY.variants) if (id && k.startsWith(String(id).split('_')[0])) return v;
  return REGISTRY.variants.values().next().value || null;
}
function normalize(d, mapId) {
  return {
    mapId, looks: 2, height: [1.62, 1.9], hp: 1, speedClasses: { walk: 1, run: 1, sprint: 1 }, voice: { f0: 95, formants: [600, 1100, 2500], rasp: 0.5, wet: 0.3, muffle: 0, kind: 'male' },
    body: {}, skin: {}, eyes: { glow: 0.0, color: 0xffa040, cataract: 0.7 }, hair: { color: 0x1a1512, amount: 0.8, hairline: 0.3, beard: 0.5, brows: 1, bald: 0 },
    layers: {}, idiosyncrasy: {}, attack: {}, ...d,
  };
}

/**
 * Build one look of a variant: {attrs:{position, normal, skinIndex, skinWeight, aCol, aMat, aMat2, aAux}, index, lods, verts, tris,
 * info, ms}. Plain data only (typed arrays + JSON-like info), deterministic for (def, look): the same bytes in a worker and here.
 * Each look builds its own body cage from ITS body params (looks may differ in build), LODs coarse → fine so the level-1
 * subdivision cached for LOD1 is reused by LOD0.
 */
export function buildLook(def, look) {
  const t0 = performance.now(); const seed = strHash(def.id) + look * 7919; const cc = new Map(); const bufs = [null, null, null]; let cage = null, info = null;
  for (let lod = 2; lod >= 0; lod--) {
    const rng = makeRng(seed); const o = new Outfit(lod, rng, def); if (cage) o._cageCache = cage; o._cc = cc;
    def.build?.(o, rng, look);
    if (!cage) { const bd = o._body; o._cageCache = cage = buildBodyCage({ girth: bd.girth, belly: bd.belly, muscle: bd.muscle, gaunt: bd.gaunt, fat: bd.fat, sex: bd.sex, age: bd.age, rng: makeRng(strHash(def.id) + 1) }); }
    bufs[lod] = o._build();
    if (lod === 0) info = { ...o.info, body: o._body, face: o.face, hairOverride: o._hair || null };
  }
  const fa = finalizeArrays(bufs); fa.info = plain(info); fa.ms = performance.now() - t0; return fa;
}
// info crosses a worker boundary / IndexedDB (structured clone): keep it plain data (drop functions, flatten class instances)
function plain(v, depth = 0) {
  if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
  if (depth > 8) return undefined; if (ArrayBuffer.isView(v)) return v;
  if (Array.isArray(v)) return v.map((x) => plain(x, depth + 1));
  if (v.isVector3 || v.isVector2) return v.toArray(); if (v.isColor) return v.getHex();
  const o = {}; for (const k in v) { const x = plain(v[k], depth + 1); if (x !== undefined) o[k] = x; } return o;
}

const cache = new Map(); // id → {def, geos: [look geometry | null], ms, complete}
const entry = (def) => { let a = cache.get(def.id); if (!a) { a = { def, geos: new Array(def.looks || 1).fill(null), ms: 0, complete: false }; cache.set(def.id, a); } return a; };
/** Synchronous path: build (once) every missing look of a variant → {def, geos:[{geometry, lods, verts, tris, info}], ms} */
export function getVariantAssets(def) {
  const a = entry(def); if (a.complete) return a;
  for (let look = 0; look < a.geos.length; look++) if (!a.geos[look]) { const fa = buildLook(def, look); a.geos[look] = geometryFromArrays(fa); a.ms += fa.ms; }
  a.complete = true; return a;
}
/** wrap a look that arrived from a build worker / the cache (typed arrays are used as-is) */
export function installLook(id, look, fa) {
  const def = REGISTRY.variants.get(id); if (!def) return null; const a = entry(def); if (look >= a.geos.length) return null;
  if (!a.geos[look]) { a.geos[look] = geometryFromArrays(fa); a.ms += fa.ms || 0; a.complete = a.geos.every(Boolean); }
  return a.geos[look];
}
/** looks of a variant that are ready now (never builds) */
export function readyLooks(id) { const a = cache.get(id); return a ? a.geos.filter(Boolean) : []; }
/** geometry memory of every built variant (bytes, all looks + LODs) */
export function assetStats() { let bytes = 0, verts = 0; const per = {}; for (const [id, a] of cache) { let b = 0; for (const g of a.geos) { if (!g) continue; const G = g.geometry; for (const k in G.attributes) b += G.attributes[k].array.byteLength; b += G.index.array.byteLength; verts += g.verts; } per[id] = { mb: +(b / 1048576).toFixed(2), ms: Math.round(a.ms), tris: a.geos.map((g) => (g ? g.tris.map((t) => Math.round(t)) : null)) }; bytes += b; } return { mb: +(bytes / 1048576).toFixed(1), verts, per }; }
export function clearAssetCache() { for (const a of cache.values()) for (const g of a.geos) g?.geometry.dispose(); cache.clear(); }
