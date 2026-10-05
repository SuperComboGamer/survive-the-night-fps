// How a search box matches items: the backpack's and the recipes' (crafting.js) score names the same way.
import { ITEM, ITEM_DEFS } from '../../shared/defs.js';

// An item answers to its display name and its ITEM key, so "wood" finds Planks and "pipebomb" finds Pipe Bomb.
const ITEM_KEY = Object.fromEntries(Object.entries(ITEM).map(([k, v]) => [v, k]));
export const norm = (s) => String(s).toLowerCase().replace(/[\s_-]+/g, ' ').trim();

// 5 exact · 4 whole word · 3 prefix · 2 word prefix · 1 substring (or every word somewhere) · 0 none
export function termScore(text, q) {
  const t = norm(text);
  if (t === q) return 5;
  const padded = ' ' + t + ' ';
  if (padded.includes(' ' + q + ' ')) return 4;
  if (t.startsWith(q)) return 3;
  if (padded.includes(' ' + q)) return 2;
  if (t.includes(q) || (q.includes(' ') && q.split(' ').every((w) => t.includes(w)))) return 1;
  return 0;
}

// q: already norm()ed
export const itemScore = (id, q) => Math.max(termScore(ITEM_DEFS[id]?.name || '', q), termScore(ITEM_KEY[id] || '', q));
