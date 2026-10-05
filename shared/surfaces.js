// What a blow lands on, and what it leaves there. One table for every hit on the world - a knife on a wall, a bat
// on a car, a bullet in a fence post, a grenade beside a barn: the surface that was struck (from the collider's tag,
// set where the world is built: worldkit.js), the kind of blow (from the weapon), and the mark, the burst of bits
// and the sound that pair makes. Pure data and pure functions: the client draws from it (render/marks.js,
// render/effects.js strike), scripts/test-wrecks.js holds it.
import { ITEM, STRUCT_DEFS } from './defs.js';
import { PROPS } from './props.js';
import { COL } from './collision.js';

export const SURF = { EARTH: 0, WOOD: 1, STONE: 2, METAL: 3, GLASS: 4, CLOTH: 5, RUBBER: 6 };
export const SURF_NAMES = ['earth', 'wood', 'stone', 'metal', 'glass', 'cloth', 'rubber'];

// How a weapon strikes. A bullet and a blast are blows too: they leave marks by the same table.
export const BLOW = { SLASH: 0, CHOP: 1, BLUNT: 2, HAMMER: 3, SHOT: 4, BLAST: 5 };
export const BLOW_NAMES = ['slash', 'chop', 'blunt', 'hammer', 'shot', 'blast'];
const BLOW_OF = { [ITEM.KNIFE]: BLOW.SLASH, [ITEM.MACHETE]: BLOW.CHOP, [ITEM.BAT]: BLOW.BLUNT, [ITEM.SPIKED_BAT]: BLOW.BLUNT, [ITEM.HAMMER]: BLOW.HAMMER };
export const blowOf = (weapon) => BLOW_OF[weapon] ?? BLOW.BLUNT;
// How hard it lands, 0..1: what a car rocks by, what a crate is nudged by, how far the bits fly. heavy: the slow swing
const FORCE = [0.16, 0.55, 0.8, 0.62, 0.1, 1];
export const blowForce = (blow, heavy = false) => Math.min(1, FORCE[blow] * (heavy ? 1.3 : 1));

// ---------------------------------------------------------------- what was struck
// the materials the world's walls, floors and roofs are built of (shared/worldkit.js Builder.box / cyl)
const MAT_SURF = {
  planks: SURF.WOOD, barn: SURF.WOOD, clapboard: SURF.WOOD, logwall: SURF.WOOD, dockwood: SURF.WOOD, trim: SURF.WOOD, sash: SURF.WOOD,
  door: SURF.WOOD, wood: SURF.WOOD, floorboards: SURF.WOOD, shingles: SURF.WOOD, charred: SURF.WOOD, bark: SURF.WOOD, hay: SURF.EARTH,
  concrete: SURF.STONE, brick: SURF.STONE, stone: SURF.STONE, plaster: SURF.STONE, gravestone: SURF.STONE, stone_rough: SURF.STONE,
  rock: SURF.STONE, roadpaint: SURF.STONE, gravel: SURF.STONE, lino: SURF.STONE, ceiling: SURF.STONE, roofing: SURF.STONE,
  tin: SURF.METAL, tin_rust: SURF.METAL, rust: SURF.METAL, metal: SURF.METAL, iron: SURF.METAL, steel: SURF.METAL, chrome: SURF.METAL,
  olive: SURF.METAL, paint: SURF.METAL, dark: SURF.METAL, taillight: SURF.METAL, emissive_red: SURF.METAL,
  glass: SURF.GLASS,
  canvas: SURF.CLOTH, canvas_mil: SURF.CLOTH, cloth: SURF.CLOTH, burlap: SURF.CLOTH, rope: SURF.CLOTH,
  earth: SURF.EARTH, dirt: SURF.EARTH, ash: SURF.EARTH,
  // what a prop's own model is made of (a blow on a prop is judged by the triangle it struck: render/wrecks.js)
  carpaint: SURF.METAL, aircraft: SURF.METAL, flat: SURF.METAL, wire: SURF.METAL, labels: SURF.METAL, stencil: SURF.METAL, plastic: SURF.METAL,
  tire: SURF.RUBBER, rubber: SURF.RUBBER, mattress: SURF.CLOTH, parachute: SURF.CLOTH, cardboard: SURF.WOOD, woodend: SURF.WOOD,
  bark_birch: SURF.WOOD, bark_dead: SURF.WOOD, pumpkin: SURF.EARTH, bone: SURF.STONE, flesh: SURF.EARTH, bottle: SURF.GLASS, bottle_brown: SURF.GLASS,
};
// a model's materials that are not a surface at all (cards of grass round a wreck, a stain): a blow goes through them
export const NO_SURFACE = new Set(['weeds', 'grass', 'bush', 'fern', 'leaves', 'pine', 'blood_decal', 'citygrime', 'citysign', 'chainlink', 'acid_glow']);
// ...and 'dark' is the black of an opening - a window with no glass in it, the gap round a door, a wheel arch: a
// blow there lands on whatever is behind it, or on nothing
export const NO_STRIKE = new Set([...NO_SURFACE, 'dark']);
export const surfaceOfMat = (mat) => MAT_SURF[mat] ?? SURF.STONE;

// A prop's surface, by what it is. Named ones first; the rest by the words in their type; a vehicle (anything that
// gives scrap) is metal.
const PROP_SURF = {
  tent: SURF.CLOTH, military_tent: SURF.CLOTH, triage_tent: SURF.CLOTH, sandbags: SURF.CLOTH, sandbag_nest: SURF.CLOTH, scarecrow: SURF.CLOTH,
  bed: SURF.CLOTH, double_bed: SURF.CLOTH, sofa: SURF.CLOTH, armchair: SURF.CLOTH, field_cot: SURF.CLOTH, hospital_bed: SURF.CLOTH,
  cell_bunk: SURF.CLOTH, cinema_seats: SURF.CLOTH, windsock: SURF.CLOTH, hay_round: SURF.EARTH, hay_square: SURF.EARTH,
  gravel_pile: SURF.EARTH, campfire: SURF.STONE, well: SURF.STONE, altar: SURF.STONE, gravestone: SURF.STONE, grave_cross: SURF.STONE,
  jersey_barrier: SURF.STONE, rubble_pile: SURF.STONE, rubble_slope: SURF.STONE, subway_entrance: SURF.STONE, bathtub: SURF.STONE,
  toilet: SURF.STONE, tank_trap: SURF.STONE, tire_pile: SURF.RUBBER, bus_shelter: SURF.GLASS, phone_booth: SURF.GLASS,
  display_fridge: SURF.GLASS, tv_set: SURF.GLASS, boat: SURF.WOOD, cart: SURF.WOOD, outhouse: SURF.WOOD, watchtower: SURF.WOOD,
  hunting_stand: SURF.WOOD, billboard: SURF.WOOD, power_pole: SURF.WOOD, pole_leaning: SURF.WOOD, dock_post: SURF.WOOD,
  lantern_post: SURF.WOOD, pew: SURF.WOOD, shelf: SURF.WOOD, bookshelf: SURF.WOOD, wardrobe: SURF.WOOD, dresser: SURF.WOOD,
  pallet: SURF.WOOD, woodpile: SURF.WOOD, barricade: SURF.WOOD, door_barricade: SURF.WOOD, kitchen_counter: SURF.WOOD,
  checkout_counter: SURF.WOOD, reception_desk: SURF.WOOD, office_desk: SURF.WOOD, street_bench: SURF.WOOD, fence: SURF.WOOD,
};
const WOOD_WORDS = /crate|table|chair|bench|log|wood|desk/;
const propSurf = {};
export function surfaceOfProp(type) {
  let s = propSurf[type];
  if (s === undefined) {
    s = PROP_SURF[type];
    if (s === undefined) s = type === 'military_crate' || type === 'waiting_chairs' ? SURF.METAL : WOOD_WORDS.test(type) ? SURF.WOOD : SURF.METAL;
    propSurf[type] = s;
  }
  return s;
}

// Things light enough for a blow to rock on their base and settle (they do not go anywhere: where a prop stands is
// the world's, and the server's). Their weight: 1 a barrel, more is stiffer.
export const LIGHT_PROPS = {
  barrel: 1, crate: 1.2, crate_small: 0.7, chair: 0.6, table: 1.3, road_sign: 0.8, mailbox: 0.8, trash_bin: 0.8, newspaper_box: 1,
  parking_meter: 1.2, pallet: 1, military_crate: 1.4, mail_dropbox: 1.6, fire_hydrant: 2.2, checkpoint_sign: 0.8, gas_pump: 2.4,
  street_bench: 1.6, picnic_table: 1.8, log_bench: 1.8, cart: 1.6, medical_cart: 0.8, gurney: 0.9, shop_gondola: 1.8, locker: 1.4,
  cabinet: 1.4, filing_cabinet: 1.3, fridge: 1.8, vending_machine: 2.4, stove: 1.8, dumpster: 2.6, boom_gate: 1.4, lantern_post: 1.5,
  scarecrow: 0.7, grave_cross: 1.6, tire_pile: 1.3, strongbox: 1.6, kitchen_table: 1.3, office_desk: 1.6, dresser: 1.5, wardrobe: 1.8,
  bookshelf: 1.6, shelf: 1.4, armchair: 1.4, sofa: 2, tv_set: 0.9, field_cot: 0.8, hospital_bed: 1.4, waiting_chairs: 1.2,
  traffic_light: 2.6, streetlight: 2.8, fence: 1.8, fence_chain: 1.2, satellite_dish: 2.4, windsock: 1.4,
};
for (const k of Object.keys(LIGHT_PROPS)) if (!PROPS[k]) delete LIGHT_PROPS[k];

/**
 * The surface a ray stopped on. col: the collider (null for the ground), terrain: it was the ground,
 * ground: the game's name for the ground there ('road', 'gravel', 'grass', ...: Game.surfaceAt), structOf(id): the
 * structure type of a built thing's entity id.
 */
export function surfaceOf(col, terrain, ground = 'grass', structOf = null) {
  if (!col || terrain) return ground === 'road' || ground === 'gravel' ? SURF.STONE : ground === 'wood' ? SURF.WOOD : SURF.EARTH;
  if (col.flags & COL.TREE) return SURF.WOOD;
  if (col.flags & COL.STRUCT) return STRUCT_DEFS[structOf ? structOf(col.id) : 0]?.metal ? SURF.METAL : SURF.WOOD;
  const tag = col.tag;
  if (typeof tag === 'string') return surfaceOfMat(tag);
  if (tag) return surfaceOfProp(tag.type);
  return SURF.STONE; // (a boulder, the mine's liner: what the world adds by hand is rock)
}

// ---------------------------------------------------------------- the mark, the bits and the sound
// The marks atlas (render/marks.js draws them, MARK_COLS x MARK_ROWS cells): a mark is one cell, laid on the
// surface w by h metres, its long side along the stroke (`along`) or at any angle (a dent, a hole).
export const MARK = {
  SLASH_WOOD: 0, GOUGE_WOOD: 1, BRUISE_WOOD: 2, SCRATCH_STONE: 3, CHIP_STONE: 4, SCRAPE_METAL: 5, DENT_METAL: 6, CUT_EARTH: 7,
  DIVOT_EARTH: 8, TEAR_CLOTH: 9, CRACK_GLASS: 10, HOLE: 11, SCORCH: 12, STAB: 13, GASH_METAL: 14, SCUFF_RUBBER: 15,
  HOLE_WOOD: 16, HOLE_STONE: 17, HOLE_METAL: 18, HOLE_GLASS: 19, SHARDS: 20, CRACK_PANE: 21, HOLE_BIG: 22, PITS: 23,
};
export const MARK_COLS = 4, MARK_ROWS = 6;
const M = (cell, w, h, along = true) => ({ cell, w, h, along });
// [surface][blow]: slash, chop, blunt, hammer, shot, blast
const MARKS = [
  /* earth  */ [M(MARK.CUT_EARTH, 0.5, 0.11), M(MARK.CUT_EARTH, 0.62, 0.16), M(MARK.DIVOT_EARTH, 0.5, 0.5, false), M(MARK.DIVOT_EARTH, 0.32, 0.32, false), M(MARK.DIVOT_EARTH, 0.17, 0.17, false), M(MARK.SCORCH, 2.2, 2.2, false)],
  /* wood   */ [M(MARK.SLASH_WOOD, 0.46, 0.09), M(MARK.GOUGE_WOOD, 0.5, 0.15), M(MARK.BRUISE_WOOD, 0.42, 0.42, false), M(MARK.BRUISE_WOOD, 0.24, 0.24, false), M(MARK.HOLE_WOOD, 0.15, 0.15, false), M(MARK.SCORCH, 1.6, 1.6, false)],
  /* stone  */ [M(MARK.SCRATCH_STONE, 0.44, 0.08), M(MARK.SCRATCH_STONE, 0.54, 0.12), M(MARK.CHIP_STONE, 0.34, 0.34, false), M(MARK.CHIP_STONE, 0.2, 0.2, false), M(MARK.HOLE_STONE, 0.17, 0.17, false), M(MARK.SCORCH, 1.8, 1.8, false)],
  /* metal  */ [M(MARK.SCRAPE_METAL, 0.44, 0.09), M(MARK.GASH_METAL, 0.48, 0.13), M(MARK.DENT_METAL, 0.5, 0.5, false), M(MARK.DENT_METAL, 0.27, 0.27, false), M(MARK.HOLE_METAL, 0.11, 0.11, false), M(MARK.SCORCH, 1.4, 1.4, false)],
  /* glass  */ [M(MARK.CRACK_GLASS, 0.3, 0.3, false), M(MARK.CRACK_GLASS, 0.44, 0.44, false), M(MARK.CRACK_GLASS, 0.6, 0.6, false), M(MARK.CRACK_GLASS, 0.4, 0.4, false), M(MARK.HOLE_GLASS, 0.3, 0.3, false), M(MARK.CRACK_GLASS, 0.8, 0.8, false)],
  /* cloth  */ [M(MARK.TEAR_CLOTH, 0.42, 0.1), M(MARK.TEAR_CLOTH, 0.56, 0.14), M(MARK.STAB, 0.2, 0.2, false), M(MARK.STAB, 0.14, 0.14, false), M(MARK.STAB, 0.09, 0.09, false), M(MARK.SCORCH, 1.6, 1.6, false)],
  /* rubber */ [M(MARK.STAB, 0.16, 0.16, false), M(MARK.TEAR_CLOTH, 0.3, 0.08), M(MARK.SCUFF_RUBBER, 0.26, 0.26, false), M(MARK.SCUFF_RUBBER, 0.16, 0.16, false), M(MARK.HOLE, 0.06, 0.06, false), M(MARK.SCORCH, 1.2, 1.2, false)],
];
export const markFor = (surf, blow) => MARKS[surf][blow];

// A bullet's hole, by the gun: how big next to a rifle's (1), and `ragged` for the round that tears a hole the size
// of a fist (the big cell on anything hard). A shotgun's pattern is its pellets': each leaves its own small hole.
const SHOT = { [ITEM.PISTOL]: 0.75, [ITEM.MP5]: 0.75, [ITEM.AK47]: 1.05, [ITEM.M4A1]: 1, [ITEM.HUNTING_RIFLE]: 1.25, [ITEM.SHOTGUN]: 0.55, [ITEM.DB_SHOTGUN]: 0.6, [ITEM.CROSSBOW]: 0.5, [ITEM.AT_RIFLE]: 3.2, 16: 1.35 /* the mounted gun */ };
export const shotScale = (weapon) => SHOT[weapon] ?? 1;
export const SHOT_RAGGED = 2.5; // from this scale up the hole is the ragged one
// An oblique shot leaves a graze: the hole drawn out along the way the bullet went, by 1 / cos of the angle, at most this
export const GRAZE_MAX = 3;
/**
 * The mark of a bullet from `weapon` on `surf`, struck at `cos` (|direction . normal|, 1: square on):
 * { cell, w (along the bullet's way across the surface), h, along (false: any angle will do) }. r: 0..1, this hole's
 * own draw - no two of a burst are the same size.
 */
export function shotMark(surf, weapon, cos = 1, r = 0.5, out = { cell: 0, w: 0, h: 0, along: false }) {
  const m = MARKS[surf][BLOW.SHOT];
  const k = shotScale(weapon);
  const ragged = k >= SHOT_RAGGED && (surf === SURF.WOOD || surf === SURF.STONE || surf === SURF.METAL);
  // (glass stars the same whatever struck it; the ragged hole is drawn bigger than its cell's hole is)
  const size = (surf === SURF.GLASS ? m.w * Math.min(1.5, 0.8 + k * 0.2) : m.w * (ragged ? k * 0.9 : k)) * (0.85 + 0.3 * r);
  const graze = Math.min(GRAZE_MAX, 1 / Math.max(0.05, cos));
  out.cell = ragged ? MARK.HOLE_BIG : m.cell;
  out.h = size;
  out.w = size * (surf === SURF.GLASS ? 1 : graze);
  out.along = graze > 1.25 && surf !== SURF.GLASS;
  return out;
}
// what a blast leaves on what stands round it: a scorch, and a peppering of pits
export const PIT_MARK = M(MARK.PITS, 0.5, 0.5, false);

// What flies off: kind 'chips' (splinters, grit, flakes: little solid bits that fall and lie), 'sparks', 'dust',
// 'clod' (a lump of turf), 'shards', 'threads'. n: how many at full force.
const BITS = [
  /* earth  */ { bits: 'clod', n: 7, dust: 0.8, sparks: 0 },
  /* wood   */ { bits: 'splinter', n: 9, dust: 0.35, sparks: 0 },
  /* stone  */ { bits: 'grit', n: 8, dust: 1, sparks: 0.15 },
  /* metal  */ { bits: 'flake', n: 6, dust: 0.3, sparks: 1 },
  /* glass  */ { bits: 'shard', n: 5, dust: 0, sparks: 0 },
  /* cloth  */ { bits: 'thread', n: 4, dust: 0.5, sparks: 0 },
  /* rubber */ { bits: 'none', n: 0, dust: 0.3, sparks: 0 },
];
export const bitsFor = (surf) => BITS[surf];

// The sound of the blow: a bank of client/audio/synth-strike.js by surface and blow (SOUND ids in defs.js, STRIKE_*).
// [surface][blow] -> the key of STRIKE_SOUND (client/audio/audio.js maps it)
const SOUNDS = [
  /* earth  */ ['earth_cut', 'earth_cut', 'earth_thud', 'earth_thud', 'earth_thud', 'earth_thud'],
  /* wood   */ ['wood_slash', 'wood_chop', 'wood_thud', 'wood_knock', 'wood_knock', 'wood_thud'],
  /* stone  */ ['stone_scrape', 'stone_chink', 'stone_crack', 'stone_chink', 'stone_chink', 'stone_crack'],
  /* metal  */ ['metal_tink', 'metal_clang', 'metal_thud', 'metal_bang', 'metal_tink', 'metal_thud'],
  /* glass  */ ['glass_tick', 'glass_tick', 'glass_tick', 'glass_tick', 'glass_tick', 'glass_tick'],
  /* cloth  */ ['cloth_rip', 'cloth_rip', 'cloth_whump', 'cloth_whump', 'cloth_whump', 'cloth_whump'],
  /* rubber */ ['tyre_stab', 'tyre_stab', 'tyre_thump', 'tyre_thump', 'tyre_stab', 'tyre_thump'],
];
export const soundFor = (surf, blow) => SOUNDS[surf][blow];
export const STRIKE_SOUNDS = [...new Set(SOUNDS.flat())];
