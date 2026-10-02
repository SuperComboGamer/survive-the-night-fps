// What a melee swing can harvest from the world (trees, wrecks) and what a failed build or craft is short of.
// Pure - no DOM, no three.js - so scripts/sim-smoke.js can hold it against the server.
import { SLOT_MELEE } from '../../shared/constants.js';
import { ITEM, ITEM_DEFS, WEAPONS, RECIPES, LOOT_TABLES, CONT_TABLES } from '../../shared/defs.js';
import { raycastWorld, COL } from '../../shared/collision.js';
import { eyeHeight } from '../../shared/playersim.js';
import { qpos } from '../../shared/protocol.js';

// Mirrors Game.gatherHit (server/game.js), tree first as there. `gives`: what a hit is for - the first item comes
// with every hit, the second now and then; the rare extras (herbs, tape, wire, batteries) stay a surprise.
// `spent`: what the prompt says of one that has given all it gives in a day.
export const HARVEST = [
  { flag: COL.TREE, verb: 'chop', where: 'chop trees', gives: [ITEM.STICK, ITEM.WOOD], spent: 'Stripped bare · nothing left to chop until dawn' },
  { flag: COL.SALVAGE, verb: 'salvage', where: 'salvage wrecks', gives: [ITEM.SCRAP, ITEM.NAILS], spent: 'Picked clean · nothing left to salvage until dawn' },
];
// The server names a used-up tree or wreck by its collider's quantized x, y0, z (EVT.STRIPPED; y0 tells the wrecks
// of a stack apart). The key of one, for a Set of those.
export const strippedKey = (qx, qy, qz) => (qx + 32768) * 0x100000000 + (qy + 32768) * 0x10000 + (qz + 32768);
// Combat.melee (server/combat.js) traces the world this far past the weapon's range when the swing hits nobody
const SWING_PAD = 0.3;
// only the weapon in the melee slot swings (the hammer in the build slot places and repairs, it never hits)
const MIN_RANGE = Math.min(...Object.values(WEAPONS).filter((w) => w.melee && w.slot === SLOT_MELEE).map((w) => w.range));
const HARVESTABLE = HARVEST.reduce((flags, h) => flags | h.flag, 0);
const _ray = { t: -1, col: null, terrain: false };
const _near = [];

// The HARVEST entry a swing from player state `s` would land on, or null. It is the server's own trace: from the eye
// along the view, the carried melee weapon's range + SWING_PAD, stopped by whatever stands in the way - so a prompt
// built on it never offers a hit that falls short. With no melee weapon carried it assumes the shortest reach.
export function harvestAt(world, s) {
  const range = (WEAPONS[s.weapons[SLOT_MELEE]]?.range ?? MIN_RANGE) + SWING_PAD;
  // this runs every frame: mostly nothing harvestable is even within reach, and one grid lookup says so
  const near = world.staticGrid.query(s.x, s.z, range, _near);
  let any = false;
  for (let i = 0; i < near.length && !any; i++) any = (near[i].flags & HARVESTABLE) !== 0;
  if (!any) return null;
  const cp = Math.cos(s.pitch);
  raycastWorld(world, s.x, s.y + eyeHeight(s), s.z, -Math.sin(s.yaw) * cp, Math.sin(s.pitch), -Math.cos(s.yaw) * cp, range, _ray);
  const col = _ray.col;
  if (!col) return null;
  for (let i = 0; i < HARVEST.length; i++) if (col.flags & HARVEST[i].flag) return HARVEST[i];
  return null;
}

const itemName = (item) => ITEM_DEFS[item]?.name || 'materials';
const list = (words) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0] || '');
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// The interaction prompt for what `s` faces: what to do and what it yields, by what is in hand - or, of one in
// `stripped` (a Set of strippedKey), that there is nothing to be had. The few texts there are get built once each,
// so a frame pays for harvestAt and a map lookup.
const _prompts = new Map();
export function harvestPrompt(world, s, stripped) {
  const h = harvestAt(world, s);
  if (!h) return null;
  const col = _ray.col; // (the one harvestAt found)
  if (stripped?.has(strippedKey(qpos(col.x), qpos(col.y0), qpos(col.z)))) return h.spent;
  const weapon = s.weapons[SLOT_MELEE];
  const inHand = weapon && s.slot === SLOT_MELEE;
  const key = h.flag * 512 + weapon * 2 + (inHand ? 1 : 0);
  let text = _prompts.get(key);
  if (!text) {
    const what = `${h.verb} for ${list(h.gives.map(itemName))}`;
    if (inHand) text = `[LMB] ${cap(what)}`;
    else if (weapon) text = `[${SLOT_MELEE + 1}] Use the ${itemName(weapon)} to ${what}`;
    else text = `Needs a melee weapon to ${what}`;
    _prompts.set(key, text);
  }
  return text;
}

// Where a material nothing can be harvested for comes from, in a few words: raw materials are found (anything in
// the loot tables), the rest is crafted if there is a recipe for it. '' when there is nothing useful to say.
const looted = new Set();
for (const tables of [LOOT_TABLES, CONT_TABLES]) for (const k in tables) for (const row of tables[k]) looted.add(row[0]);
function foundOrCrafted(item) {
  if (ITEM_DEFS[item]?.cat === 'res' && looted.has(item)) return 'search containers';
  return RECIPES.some((r) => r.out === item) ? `craft ${itemName(item)} [I]` : '';
}

// What `counts` (item -> how many are carried) is short of for `cost` (item -> how many it takes), as lines to show:
// ['Need 2 more Planks, 3 more Nails', 'Chop trees and salvage wrecks with a melee weapon']. The second line, where
// the missing things come from, is left out when there is nothing useful to say; [] when nothing is short.
export function needLines(cost, counts) {
  const short = [];
  const harvest = [];
  const other = [];
  for (const k in cost) {
    const n = cost[k] - (counts[k] || 0);
    if (n <= 0) continue;
    short.push(`${n} more ${itemName(k)}`);
    const h = HARVEST.find((x) => x.gives.includes(+k));
    const src = h ? h.where : foundOrCrafted(+k);
    const into = h ? harvest : other;
    if (src && !into.includes(src)) into.push(src);
  }
  if (!short.length) return [];
  if (harvest.length) other.unshift(`${list(harvest)} with a melee weapon`);
  const lines = [`Need ${short.join(', ')}`];
  if (other.length) lines.push(other.map(cap).join(' · '));
  return lines;
}
