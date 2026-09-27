// Icon sheet (standalone: only imports icons.js). ?new=1 shows only the iteration-2 additions, ?big=1 larger cells.
import { ITEM, ITEM_DEFS, STRUCT, STRUCT_DEFS, STRUCT_ORDER } from '../../shared/defs.js';
import { itemIcon, structIcon, glyph, GLYPH_NAMES } from '../ui/icons.js';

const q = new URLSearchParams(location.search);
const NEW_ONLY = q.get('new') === '1';
if (q.get('big') === '1') document.body.style.cssText += '--cell:220px;--h:96px;';
const NEW_ITEMS = [ITEM.FLARE, ITEM.SCHEM_SHOTGUN, ITEM.SCHEM_RIFLE, ITEM.SCHEM_KEVLAR, ITEM.SCHEM_EXPLOSIVES, ITEM.SCHEM_METAL];
const NEW_STRUCTS = [STRUCT.CAMPFIRE, STRUCT.WORKBENCH, STRUCT.DOOR];
const NEW_GLYPHS = ['compass', 'map', 'ping', 'wave', 'search', 'engine', 'fuel', 'downed', 'lock', 'unlock', 'blueprint', 'axe', 'container', 'flag', 'wrench', 'eyeOff', 'arrowRight'];

const cell = (svg, small, label, isNew) => `<div class="cell${isNew ? ' new' : ''}"><div class="row">${svg}<div class="small">${small}</div></div><span>${label}</span></div>`;
let html = '<h2>Items</h2><div class="grid">';
for (const id of Object.keys(ITEM_DEFS).map(Number)) {
  const isNew = NEW_ITEMS.includes(id);
  if (NEW_ONLY && !isNew) continue;
  html += cell(itemIcon(id), itemIcon(id), `${id} · ${ITEM_DEFS[id].name}`, isNew);
}
html += '</div><h2>Structures</h2><div class="grid">';
for (const t of STRUCT_ORDER) {
  const isNew = NEW_STRUCTS.includes(t);
  if (NEW_ONLY && !isNew) continue;
  html += cell(structIcon(t), structIcon(t), `${t} · ${STRUCT_DEFS[t].name}`, isNew);
}
html += '</div><h2>Glyphs</h2><div class="grid">';
for (const n of GLYPH_NAMES) {
  const isNew = NEW_GLYPHS.includes(n);
  if (NEW_ONLY && !isNew) continue;
  html += cell(glyph(n), glyph(n), n, isNew);
}
html += '</div>';
const missing = NEW_GLYPHS.filter((n) => !GLYPH_NAMES.includes(n));
if (missing.length) html += `<p style="color:#f66">missing glyphs: ${missing.join(', ')}</p>`;
document.getElementById('out').innerHTML = html;
