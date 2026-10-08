// The wardrobe: every part a survivor can be made of, and every colour, in one list. The character creator
// (client/ui/creator.js) is drawn from it, the dice roll from it (shared/appearance.js randomLook), the server checks a
// custom survivor against it (appearance.js decode / normalize) and the tests and clip sweeps go through all of it
// (coveringLooks). The models are built by client/render/models/people.js from the look object
// client/render/models/looks.js lookFromAppearance makes from it.
//
// TO ADD A PART (a hairstyle, a hat, a top, a vest, a pair of shoes, a piece of kit): build it in people.js as the
// roster's parts are, then add one line to its field below with the next unused `id` (never one in `retired`). The
// creator shows it, both dice can roll it and the server accepts it. scripts/test-characters.js fails until both halves
// are there: a part name people.js compares that no field lists, or a listed part that changes nothing.
// TO ADD A COLOUR: add a swatch with the next unused id to its palette (the order on screen is the order here).
// TO ADD A FIELD: append it with the next unused `wire` index and a `default`. Older saves and older clients get the
// default.
// TO REMOVE a part, a colour or a field: delete it and put its id in the `retired` list beside it (a field's wire index
// in RETIRED_WIRE), so that it is never used for something else. Saved survivors that had it fall back to the field's
// default (or its first option) and are told so; an old id on the wire becomes the default too.
//
// Ids are on the wire (C2S.JOIN, S2C.LOOKS) and names are what a browser keeps (client/ui/customs.js): change neither.
// Labels, the order on screen and the rules may change freely.
//
// A field:
//   key, wire (its place in the encoded look), section, label, kind: 'pick' | 'swatch' | 'slider', default
//   path         where the value goes in the look object (people.js's schema, at the top of that file)
//   pick         options: [{ id, name, label, ...rules }]
//   swatch       palette (a key of PALETTES), none: 'label' (id 0 is "none"; noneOdds: how much likelier the dice
//                make it none than a colour, all colours together), same: { field, label } (id 0 is "the
//                same colour as that field"), only: [swatch names] (a part of the palette)
//   slider       range: [lo, hi], steps (on the wire: 0..steps)
//   when         { field, in: [names] } | { field, not: [names] } | { field, has: 'prop' }: the field matters (and
//                is shown) only while that holds; [several]: all of them; { any: [several] }: one of them
//   prefer       (a swatch) the palette tags the dice like for it
// An option's rules (all optional):
//   offer: false       people.js builds it but the creator does not offer it (the dead's, or not ready)
//   allow: { field: [names] }     while this is chosen, that field may only be one of these
//   excludes: { field: [names] }  ...and may not be one of these ('*': anything but none)
//   defaults: { field: name }     what that field becomes when a rule forces it to change
//   look: { ... }      merged into the look object (looks.js lookFromAppearance)
//   paint: { ... }     painted onto the head (looks.js headPaint: buzz, ...)
//   weight             how often the dice pick it (default 1; 0: never rolled, still offered)
//   roll: { field: k } the dice weigh that field's non-none options by k afterwards (a feminine body: few beards)
//   prefer: { field: [tags] }  the dice like these colours for that field afterwards (a hi-vis vest: hi-vis)
//   sets: { field: value }     (the body) where the creator puts these sliders when it is picked
//   trim               (hats) which part takes the trim colour: 'band' | 'front' | 'bill'
//   size               (hair) { path, range, label }: the length / size slider moves this

export const SECTIONS = [
  { key: 'body', label: 'Body' },
  { key: 'face', label: 'Face' },
  { key: 'hair', label: 'Hair & hat' },
  { key: 'clothes', label: 'Clothes' },
  { key: 'gear', label: 'Gear' },
];

// tags (the dice's sense of what goes together): earth / neutral / denim / dark / bright / hivis / light
export const PALETTES = {
  skin: {
    retired: [],
    swatches: [
      { id: 11, name: 'porcelain', label: 'Porcelain', hex: 0xf2d6c0 },
      { id: 9, name: 'fair', label: 'Fair', hex: 0xeec8ac },
      { id: 6, name: 'light', label: 'Light', hex: 0xe0b894 },
      { id: 8, name: 'rosy', label: 'Rosy', hex: 0xdeaa86 },
      { id: 5, name: 'peach', label: 'Peach', hex: 0xdcae92 },
      { id: 4, name: 'warm', label: 'Warm', hex: 0xd6a080 },
      { id: 1, name: 'tan', label: 'Tan', hex: 0xcf9c78 },
      { id: 12, name: 'golden', label: 'Golden', hex: 0xc48a64 },
      { id: 2, name: 'olive', label: 'Olive', hex: 0xb07a58 },
      { id: 10, name: 'bronze', label: 'Bronze', hex: 0xa86e4a },
      { id: 13, name: 'brown', label: 'Brown', hex: 0x8a5a3e },
      { id: 3, name: 'umber', label: 'Umber', hex: 0x6e4632 },
      { id: 7, name: 'deep', label: 'Deep', hex: 0x6a4230 },
      { id: 14, name: 'ebony', label: 'Ebony', hex: 0x4e3024 },
    ],
  },
  eyes: {
    retired: [],
    swatches: [
      { id: 6, name: 'black', label: 'Near black', hex: 0x1a1008 },
      { id: 3, name: 'dark', label: 'Dark brown', hex: 0x1e140c },
      { id: 7, name: 'umber', label: 'Umber', hex: 0x1e120a },
      { id: 10, name: 'coffee', label: 'Coffee', hex: 0x2a1a0e },
      { id: 2, name: 'brown', label: 'Brown', hex: 0x3a2618 },
      { id: 5, name: 'amber', label: 'Amber', hex: 0x4a3a2a },
      { id: 1, name: 'hazel', label: 'Hazel', hex: 0x4a5a40 },
      { id: 9, name: 'green', label: 'Green', hex: 0x4a7a5a },
      { id: 4, name: 'grey', label: 'Grey', hex: 0x5a7080 },
      { id: 8, name: 'blue', label: 'Blue', hex: 0x5a6a7a },
      { id: 11, name: 'sky', label: 'Pale blue', hex: 0x6a8aa8 },
    ],
  },
  // brow: the eyebrows that go with the hair
  hair: {
    retired: [],
    swatches: [
      { id: 2, name: 'black', label: 'Black', hex: 0x2e2018, brow: 0x22180e },
      { id: 6, name: 'jet', label: 'Jet', hex: 0x282220, brow: 0x1e1a18 },
      { id: 7, name: 'ink', label: 'Ink', hex: 0x241c16, brow: 0x1a1410 },
      { id: 10, name: 'raven', label: 'Raven', hex: 0x261e1a, brow: 0x1e1814 },
      { id: 3, name: 'espresso', label: 'Espresso', hex: 0x2a221c, brow: 0x221a14 },
      { id: 5, name: 'dark', label: 'Dark brown', hex: 0x3e2e20, brow: 0x3e2e20 },
      { id: 1, name: 'brown', label: 'Brown', hex: 0x6a5642, brow: 0x4a3a2a },
      { id: 14, name: 'auburn', label: 'Auburn', hex: 0x6a2e1a, brow: 0x52241a },
      { id: 8, name: 'red', label: 'Red', hex: 0x8a4a24, brow: 0x7a3e20 },
      { id: 9, name: 'strawberry', label: 'Strawberry', hex: 0xc07c3c, brow: 0x9a5a2a },
      { id: 11, name: 'blonde', label: 'Blonde', hex: 0xc8a868, brow: 0x8a7048 },
      { id: 12, name: 'platinum', label: 'Platinum', hex: 0xd8d0c0, brow: 0xa8a090 },
      { id: 4, name: 'grey', label: 'Grey', hex: 0xa8a49c, brow: 0x9a968e },
      { id: 13, name: 'white', label: 'White', hex: 0xe0ddd6, brow: 0xb0aca4 },
      { id: 15, name: 'ash', label: 'Ash', hex: 0x5a4834, brow: 0x4a3a2a },
      { id: 16, name: 'silver', label: 'Silver', hex: 0xb4b0a8, brow: 0x9a968e },
      { id: 17, name: 'ginger', label: 'Ginger', hex: 0x8c4624, brow: 0x7a3e20 },
    ],
  },
  // cloth: tops, trousers, vests, hats
  dye: {
    retired: [],
    swatches: [
      { id: 8, name: 'black', label: 'Black', hex: 0x262626, tags: ['dark', 'neutral'] },
      { id: 37, name: 'charcoal', label: 'Charcoal', hex: 0x3a3a38, tags: ['dark', 'neutral'] },
      { id: 18, name: 'grey', label: 'Grey', hex: 0x5a5e62, tags: ['neutral'] },
      { id: 19, name: 'ash', label: 'Ash grey', hex: 0x6c6c6a, tags: ['neutral'] },
      { id: 20, name: 'slate', label: 'Slate', hex: 0x5c6470, tags: ['neutral'] },
      { id: 30, name: 'cream', label: 'Cream', hex: 0xe2ded2, tags: ['light', 'neutral'] },
      { id: 31, name: 'bone', label: 'Bone', hex: 0xe8e4d8, tags: ['light', 'neutral'] },
      { id: 1, name: 'khaki', label: 'Khaki', hex: 0x9a8a5e, tags: ['earth'] },
      { id: 13, name: 'sand', label: 'Sand', hex: 0x9a8a66, tags: ['earth'] },
      { id: 26, name: 'straw', label: 'Straw', hex: 0xc8b07a, tags: ['earth', 'light'] },
      { id: 7, name: 'canvas', label: 'Canvas', hex: 0x8e6c44, tags: ['earth'] },
      { id: 23, name: 'felt', label: 'Felt brown', hex: 0x6e5c3c, tags: ['earth'] },
      { id: 15, name: 'brown', label: 'Brown', hex: 0x5c4c36, tags: ['earth'] },
      { id: 24, name: 'leather', label: 'Dark brown', hex: 0x5a3a20, tags: ['earth', 'dark'] },
      { id: 25, name: 'umber', label: 'Umber', hex: 0x2a2018, tags: ['earth', 'dark'] },
      { id: 2, name: 'olive', label: 'Olive', hex: 0x4c5438, tags: ['earth'] },
      { id: 14, name: 'moss', label: 'Moss', hex: 0x6a6444, tags: ['earth'] },
      { id: 34, name: 'forest', label: 'Forest', hex: 0x2e4a32, tags: ['dark'] },
      { id: 4, name: 'teal', label: 'Teal', hex: 0x2f8584, tags: ['bright'] },
      { id: 3, name: 'navy', label: 'Navy', hex: 0x2e3e5c, tags: ['dark', 'denim'] },
      { id: 12, name: 'midnight', label: 'Midnight', hex: 0x2e3a56, tags: ['dark'] },
      { id: 27, name: 'royal', label: 'Ink blue', hex: 0x2c3c5e, tags: ['dark'] },
      { id: 6, name: 'denim', label: 'Denim', hex: 0x3c5276, tags: ['denim'] },
      { id: 9, name: 'jeans', label: 'Jeans', hex: 0x36486c, tags: ['denim'] },
      { id: 17, name: 'rinse', label: 'Dark jeans', hex: 0x3a4a6a, tags: ['denim'] },
      { id: 11, name: 'faded', label: 'Faded jeans', hex: 0x6680a4, tags: ['denim'] },
      { id: 5, name: 'flannel', label: 'Barn red', hex: 0x9c2c24, tags: ['bright'] },
      { id: 28, name: 'red', label: 'Red', hex: 0xa82c22, tags: ['bright'] },
      { id: 16, name: 'shell', label: 'Signal red', hex: 0xb83a2c, tags: ['bright'] },
      { id: 10, name: 'maroon', label: 'Maroon', hex: 0x7c2c3a, tags: ['dark'] },
      { id: 35, name: 'plum', label: 'Plum', hex: 0x4a2e48, tags: ['dark'] },
      { id: 36, name: 'mustard', label: 'Mustard', hex: 0xb08a2a, tags: ['bright', 'earth'] },
      { id: 21, name: 'blaze', label: 'Blaze orange', hex: 0xe8621e, tags: ['hivis'] },
      { id: 22, name: 'orange', label: 'Orange', hex: 0xdc5a1c, tags: ['hivis'] },
      { id: 32, name: 'rust', label: 'Rust', hex: 0xc8501a, tags: ['bright'] },
      { id: 29, name: 'hardhat', label: 'Safety yellow', hex: 0xe2b21a, tags: ['hivis'] },
      { id: 33, name: 'lime', label: 'Hi-vis lime', hex: 0xc6e032, tags: ['hivis'] },
    ],
  },
  // belts, gloves, boots and shoes
  leather: {
    retired: [],
    swatches: [
      { id: 1, name: 'black', label: 'Black', hex: 0x161412, tags: ['dark'] },
      { id: 2, name: 'jet', label: 'Jet', hex: 0x141210, tags: ['dark'] },
      { id: 3, name: 'espresso', label: 'Espresso', hex: 0x2a1e14, tags: ['dark'] },
      { id: 4, name: 'dark', label: 'Dark brown', hex: 0x3a2a1a, tags: ['dark'] },
      { id: 5, name: 'saddle', label: 'Saddle', hex: 0x3a2818, tags: ['earth'] },
      { id: 6, name: 'chestnut', label: 'Chestnut', hex: 0x3a2c20, tags: ['earth'] },
      { id: 7, name: 'brown', label: 'Brown', hex: 0x4a3220, tags: ['earth'] },
      { id: 8, name: 'walnut', label: 'Walnut', hex: 0x4a3020, tags: ['earth'] },
      { id: 9, name: 'mocha', label: 'Mocha', hex: 0x4a3522, tags: ['earth'] },
      { id: 10, name: 'tobacco', label: 'Tobacco', hex: 0x5a4028, tags: ['earth'] },
      { id: 11, name: 'trail', label: 'Trail brown', hex: 0x6a4a30, tags: ['earth'] },
      { id: 12, name: 'tan', label: 'Tan', hex: 0x9a7040, tags: ['earth'] },
      { id: 13, name: 'buff', label: 'Buff', hex: 0x9a8458, tags: ['earth'] },
      { id: 14, name: 'white', label: 'White', hex: 0xe6e4de, tags: ['light'] },
      { id: 15, name: 'chalk', label: 'Chalk', hex: 0xdedcd4, tags: ['light'] },
      { id: 16, name: 'grey', label: 'Grey', hex: 0x7a7a78, tags: ['neutral'] },
      { id: 17, name: 'navy', label: 'Navy', hex: 0x2c3448, tags: ['dark'] },
      { id: 18, name: 'red', label: 'Red', hex: 0x9a2a22, tags: ['bright'] },
    ],
  },
  // small bright things: lanyards, glasses frames, patches
  accent: {
    retired: [],
    swatches: [
      { id: 1, name: 'black', label: 'Black', hex: 0x1a1a1a },
      { id: 2, name: 'blue', label: 'Blue', hex: 0x2a4a8a },
      { id: 3, name: 'white', label: 'White', hex: 0xe8e4d8 },
      { id: 4, name: 'red', label: 'Red', hex: 0x9a2a2a },
      { id: 5, name: 'gold', label: 'Gold', hex: 0xb09040 },
      { id: 6, name: 'silver', label: 'Silver', hex: 0x9a9aa0 },
      { id: 7, name: 'green', label: 'Green', hex: 0x3a6a3a },
      { id: 8, name: 'tortoise', label: 'Tortoiseshell', hex: 0x5a3a20 },
    ],
  },
};

// the cloth a garment is cut from: an atlas region of client/render/models/charTextures.js (CR) each
const FABRICS = [
  { id: 1, name: 'cotton', label: 'Cotton', region: 'COTTON' },
  { id: 2, name: 'twill', label: 'Twill', region: 'TWILL' },
  { id: 3, name: 'denim', label: 'Denim', region: 'DENIM' },
  { id: 4, name: 'plaid', label: 'Plaid', region: 'PLAID' },
  { id: 5, name: 'canvas', label: 'Canvas', region: 'CANVAS' },
  { id: 6, name: 'fleece', label: 'Fleece', region: 'FLEECE' },
  { id: 7, name: 'camo', label: 'Camo', region: 'CAMO' },
];
const NONE_ON = (label, rules = {}) => [
  { id: 0, name: 'none', label: 'None', weight: 4 },
  { id: 1, name: 'on', label, ...rules },
];
const S = (key, wire, section, label, range, def, path, more = {}) => ({ key, wire, section, label, kind: 'slider', range, steps: 40, default: def, path, ...more });

export const FIELDS = [
  // ---------------------------------------------------------------- body (the sliders stay inside the roster's range:
  // the hitbox (shared/hitbox.js) is one shape for everyone, and what is held and worn was fitted on these bodies)
  {
    key: 'body', wire: 0, section: 'body', label: 'Body', kind: 'pick', default: 'm', path: 'sex', retired: [],
    options: [
      { id: 0, name: 'm', label: 'Masculine', sets: { bust: 0, features: 0 } },
      { id: 1, name: 'f', label: 'Feminine', sets: { bust: 0.55, features: 1 }, roll: { beard: 0.04, stubble: 0.04 } },
    ],
  },
  S('height', 1, 'body', 'Height', [0.945, 1.04], 0.995, 'frame.height'),
  S('head', 2, 'body', 'Head size', [0.97, 1.04], 1, 'frame.head'),
  S('build', 3, 'body', 'Build', [0.9, 1.2], 1, 'build.w'),
  S('shoulders', 4, 'body', 'Shoulders', [0.94, 1.08], 1, 'build.sh'),
  S('hips', 5, 'body', 'Hips', [0.96, 1.08], 1, 'build.hips'),
  S('belly', 6, 'body', 'Belly', [0, 0.6], 0, 'build.belly'),
  S('bust', 7, 'body', 'Chest', [0, 0.7], 0, 'build.bust'),
  S('arms', 8, 'body', 'Arms', [0.88, 1.14], 1, 'build.arm'),
  S('legs', 9, 'body', 'Legs', [0.92, 1.16], 1, 'build.leg'),
  S('neck', 10, 'body', 'Neck', [0.95, 1.25], 1, 'build.neck'),
  // ---------------------------------------------------------------- face
  { key: 'skin', wire: 11, section: 'face', label: 'Skin', kind: 'swatch', palette: 'skin', default: 'tan', path: 'skin' },
  { key: 'eyes', wire: 12, section: 'face', label: 'Eyes', kind: 'swatch', palette: 'eyes', default: 'brown', path: 'eye' },
  S('features', 13, 'face', 'Features (strong - soft)', [0, 1], 0, 'face.fem'),
  S('faceWidth', 14, 'face', 'Face width', [0.94, 1.08], 1, 'face.w'),
  S('jaw', 15, 'face', 'Jaw', [0.9, 1.2], 1, 'face.jaw'),
  S('chin', 16, 'face', 'Chin', [0.88, 1.1], 1, 'face.chin'),
  S('brow', 17, 'face', 'Brow', [0.7, 1.2], 1, 'face.brow'),
  S('cheeks', 18, 'face', 'Cheekbones', [0.95, 1.2], 1, 'face.cheek'),
  S('lips', 19, 'face', 'Lips', [0.8, 1.35], 1, 'face.lips'),
  S('nose', 20, 'face', 'Nose', [0.75, 1.15], 1, 'face.nose'),
  S('noseLength', 21, 'face', 'Nose length', [0.9, 1.15], 1, 'face.noseL'),
  S('noseWidth', 22, 'face', 'Nose width', [0.9, 1.5], 1, 'face.noseW'),
  S('ears', 23, 'face', 'Ears', [0.9, 1.12], 1, 'face.ear'),
  S('gaunt', 24, 'face', 'Hollow cheeks', [0, 0.35], 0, 'face.gaunt'),
  { key: 'freckles', wire: 25, section: 'face', label: 'Freckles', kind: 'pick', default: 'none', retired: [], options: NONE_ON('Freckles') },
  S('age', 26, 'face', 'Lines', [0, 1], 0, null),
  // ---------------------------------------------------------------- hair and hat
  {
    key: 'hair', wire: 27, section: 'hair', label: 'Hair', kind: 'pick', default: 'short', path: 'hair.style', retired: [],
    options: [
      { id: 0, name: 'none', label: 'Shaved', weight: 0.4 },
      { id: 1, name: 'short', label: 'Short', weight: 3 },
      { id: 2, name: 'buzz', label: 'Buzzed', paint: { buzz: 0.85 } },
      { id: 3, name: 'fade', label: 'Fade', paint: { buzz: 0.75 } },
      { id: 4, name: 'crop', label: 'Crop', paint: { buzz: 0.55 } },
      { id: 5, name: 'bob', label: 'Bob' },
      { id: 6, name: 'long', label: 'Long', offer: false }, // (the dead's: it hangs where the worn pack sits)
      { id: 7, name: 'ponytail', label: 'Ponytail', size: { path: 'hair.length', range: [0.16, 0.26], label: 'Length' } },
      { id: 8, name: 'bun', label: 'Bun', size: { path: 'hair.size', range: [0.9, 1.25], label: 'Bun size' }, excludes: { hat: ['*'] } }, // (it sits above every hat's band)
      { id: 9, name: 'braid', label: 'Braid', size: { path: 'hair.length', range: [0.16, 0.27], label: 'Length' }, excludes: { collar: ['jacket'] } }, // (down through a jacket's turned-out collar on a small body: a high one, as Jess wears, is clear)
      { id: 10, name: 'balding', label: 'Balding', weight: 0.6 },
      { id: 11, name: 'patchy', label: 'Patchy', offer: false }, // (the dead's: torn out in clumps)
    ],
  },
  { key: 'hairColor', wire: 28, section: 'hair', label: 'Hair colour', kind: 'swatch', palette: 'hair', default: 'brown', path: 'hair.color', when: { field: 'hair', not: ['none'] } },
  S('hairSize', 29, 'hair', 'Length', [0, 1], 0.5, null, { when: { field: 'hair', has: 'size' } }),
  {
    key: 'beard', wire: 30, section: 'hair', label: 'Beard', kind: 'pick', default: 'none', path: 'beard.style', retired: [],
    options: [
      { id: 0, name: 'none', label: 'None', weight: 4 },
      { id: 1, name: 'mustache', label: 'Mustache' },
      { id: 2, name: 'goatee', label: 'Goatee' },
      { id: 3, name: 'short', label: 'Short' },
      { id: 4, name: 'full', label: 'Full' },
      { id: 5, name: 'stubble', label: 'Stubble', offer: false }, // (painted: the stubble field below)
    ],
  },
  { key: 'beardColor', wire: 31, section: 'hair', label: 'Beard colour', kind: 'swatch', palette: 'hair', default: 'same', same: { field: 'hairColor', label: 'Same as hair' }, path: 'beard.color', when: { field: 'beard', not: ['none'] } },
  {
    key: 'stubble', wire: 32, section: 'hair', label: 'Stubble', kind: 'pick', default: 'none', retired: [],
    options: [
      { id: 0, name: 'none', label: 'Clean', weight: 3 },
      { id: 1, name: 'light', label: 'Light', paint: { stubbleK: 0.18 } },
      { id: 2, name: 'heavy', label: 'Heavy', paint: { stubbleK: 0.3 } },
    ],
  },
  {
    key: 'hat', wire: 33, section: 'hair', label: 'Hat', kind: 'pick', default: 'none', path: 'hat.kind', retired: [],
    options: [
      { id: 0, name: 'none', label: 'None', weight: 5 },
      { id: 1, name: 'cap', label: 'Cap', trim: 'bill' },
      { id: 2, name: 'trucker', label: 'Trucker', trim: 'front' },
      { id: 3, name: 'beanie', label: 'Beanie' },
      { id: 4, name: 'ranger', label: 'Ranger', trim: 'band' },
      { id: 5, name: 'cowboy', label: 'Cowboy', trim: 'band' },
      { id: 6, name: 'hardhat', label: 'Hard hat' },
      { id: 7, name: 'bandana', label: 'Bandana' },
    ],
  },
  { key: 'hatColor', wire: 34, section: 'hair', label: 'Hat colour', kind: 'swatch', palette: 'dye', default: 'navy', path: 'hat.color', when: { field: 'hat', not: ['none'] } },
  { key: 'hatTrim', wire: 35, section: 'hair', label: 'Trim', kind: 'swatch', palette: 'dye', default: 'none', none: 'Plain', noneOdds: 1, when: { field: 'hat', has: 'trim' } },
  // ---------------------------------------------------------------- clothes
  {
    key: 'top', wire: 36, section: 'clothes', label: 'Top', kind: 'pick', default: 'tee', path: 'top.kind', retired: [],
    options: [
      { id: 1, name: 'tee', label: 'T-shirt', weight: 2, allow: { sleeves: ['short', 'long', 'none'], collar: ['crew', 'v'], front: ['closed'], pockets: ['none'], fabric: ['cotton'] }, defaults: { sleeves: 'short', collar: 'crew', front: 'closed', pockets: 'none', fabric: 'cotton', fit: 'regular' } },
      { id: 2, name: 'shirt', label: 'Work shirt', weight: 1.5, allow: { sleeves: ['long', 'rolled', 'short'], collar: ['shirt'], front: ['buttons', 'zip'], fabric: ['twill', 'cotton', 'denim', 'canvas'] }, defaults: { sleeves: 'rolled', collar: 'shirt', front: 'buttons', fabric: 'twill' } },
      { id: 3, name: 'flannel', label: 'Flannel', allow: { sleeves: ['long', 'rolled'], collar: ['shirt'], front: ['buttons'], fabric: ['plaid'] }, defaults: { sleeves: 'long', collar: 'shirt', front: 'buttons', fabric: 'plaid' } }, // (a shirt, in plaid)
      { id: 4, name: 'jacket', label: 'Jacket', weight: 2, allow: { sleeves: ['long'], collar: ['jacket', 'high'], front: ['zip', 'open'], fit: ['regular', 'long'], fabric: ['canvas', 'cotton', 'camo', 'twill', 'denim'] }, defaults: { sleeves: 'long', collar: 'jacket', front: 'zip', fabric: 'canvas', fit: 'regular' } },
      { id: 5, name: 'hoodie', label: 'Hoodie', allow: { sleeves: ['long'], collar: ['hood'], front: ['closed'], pockets: ['none'], fit: ['regular', 'long'], fabric: ['fleece', 'cotton'] }, defaults: { sleeves: 'long', collar: 'hood', front: 'closed', pockets: 'none', fabric: 'fleece', fit: 'long' }, excludes: { hair: ['ponytail', 'braid'] } }, // (the hood down behind the neck is where a tail of hair hangs: scripts/clip/outfits.js)
      { id: 6, name: 'fleece', label: 'Fleece', allow: { sleeves: ['long'], collar: ['high'], front: ['zip', 'closed'], pockets: ['none'], fit: ['regular', 'long'], fabric: ['fleece'] }, defaults: { sleeves: 'long', collar: 'high', front: 'zip', pockets: 'none', fabric: 'fleece' } },
      { id: 7, name: 'tank', label: 'Tank top', offer: false },
      { id: 8, name: 'coat', label: 'Long coat', offer: false },
    ],
  },
  { key: 'topColor', wire: 37, section: 'clothes', label: 'Top colour', kind: 'swatch', palette: 'dye', default: 'grey', path: 'top.color' },
  { key: 'fabric', wire: 38, section: 'clothes', label: 'Fabric', kind: 'pick', default: 'cotton', path: 'top.region', retired: [], options: FABRICS },
  {
    key: 'sleeves', wire: 39, section: 'clothes', label: 'Sleeves', kind: 'pick', default: 'long', path: 'top.sleeves', retired: [],
    options: [
      { id: 1, name: 'long', label: 'Long' },
      { id: 2, name: 'rolled', label: 'Rolled' },
      { id: 3, name: 'short', label: 'Short' },
      { id: 4, name: 'none', label: 'Sleeveless', weight: 0.3 },
    ],
  },
  {
    key: 'collar', wire: 40, section: 'clothes', label: 'Collar', kind: 'pick', default: 'crew', path: 'top.collar', retired: [],
    options: [
      { id: 1, name: 'crew', label: 'Crew' },
      { id: 2, name: 'v', label: 'V-neck' },
      { id: 3, name: 'shirt', label: 'Shirt' },
      { id: 4, name: 'jacket', label: 'Jacket' },
      { id: 5, name: 'high', label: 'High' },
      { id: 6, name: 'hood', label: 'Hood' },
    ],
  },
  {
    key: 'front', wire: 41, section: 'clothes', label: 'Front', kind: 'pick', default: 'closed', retired: [],
    options: [
      { id: 1, name: 'closed', label: 'Plain' },
      { id: 2, name: 'buttons', label: 'Buttons', look: { top: { buttons: true } } },
      { id: 3, name: 'zip', label: 'Zip', look: { top: { zip: true } } },
      { id: 4, name: 'open', label: 'Open', look: { top: { open: 0.36 } }, weight: 0.6 },
    ],
  },
  {
    key: 'pockets', wire: 42, section: 'clothes', label: 'Chest pockets', kind: 'pick', default: 'none', path: 'top.pockets', retired: [],
    options: [
      { id: 0, name: 'none', label: 'None' },
      { id: 1, name: 'one', label: 'One' },
      { id: 2, name: 'both', label: 'Two' },
    ],
  },
  {
    key: 'fit', wire: 43, section: 'clothes', label: 'Hem', kind: 'pick', default: 'regular', retired: [],
    options: [
      { id: 1, name: 'tucked', label: 'Tucked in', look: { top: { tucked: true } }, weight: 0.5 },
      { id: 2, name: 'regular', label: 'Regular', weight: 2 },
      { id: 3, name: 'long', label: 'Long', look: { top: { hem: 0.085 } } },
    ],
  },
  { key: 'underColor', wire: 44, section: 'clothes', label: 'Underneath', kind: 'swatch', palette: 'dye', default: 'black', path: 'top.under.color', when: { field: 'front', in: ['open'] } },
  {
    key: 'grime', wire: 45, section: 'clothes', label: 'Wear', kind: 'pick', default: 'clean', retired: [],
    options: [
      { id: 0, name: 'clean', label: 'Clean', weight: 4 },
      { id: 1, name: 'grimy', label: 'Grease' },
    ],
  },
  {
    key: 'layer', wire: 46, section: 'clothes', label: 'Over it', kind: 'pick', default: 'none', retired: [],
    options: [
      { id: 0, name: 'none', label: 'Nothing', weight: 5 },
      { id: 1, name: 'hivis', label: 'Hi-vis vest', look: { vest: { kind: 'hivis', open: 0.1 } }, prefer: { layerColor: ['hivis'] }, excludes: { badge: ['chest'], patch: ['*'], lanyard: ['*'] } },
      { id: 2, name: 'blaze', label: 'Blaze vest', look: { vest: { kind: 'blaze', open: 0.14 } }, prefer: { layerColor: ['hivis'] }, excludes: { badge: ['chest'], patch: ['*'], lanyard: ['*'] } },
      { id: 3, name: 'down', label: 'Down vest', look: { vest: { kind: 'down', open: 0.12 } }, offer: false },
      { id: 4, name: 'overalls', label: 'Bib overalls', look: { overalls: {}, pants: { region: 'DENIM', rise: 0.09 } }, prefer: { layerColor: ['denim'] }, excludes: { top: ['jacket', 'hoodie', 'fleece'], pockets: ['*'], badge: ['chest'], patch: ['*'], lanyard: ['*'], radio: ['on'] } }, // (the bib and its straps over the chest: no chest pockets or kit under them)
      { id: 5, name: 'coverall', label: 'Coverall', look: { coverall: true, top: { hem: -0.075 } }, allow: { top: ['shirt'], fit: ['regular'] }, defaults: { top: 'shirt', fit: 'regular' }, weight: 0.5 },
    ],
  },
  { key: 'layerColor', wire: 47, section: 'clothes', label: 'Over colour', kind: 'swatch', palette: 'dye', default: 'blaze', when: { field: 'layer', in: ['hivis', 'blaze', 'down', 'overalls'] } },
  {
    key: 'trousers', wire: 48, section: 'clothes', label: 'Trousers', kind: 'pick', default: 'plain', retired: [],
    options: [
      { id: 1, name: 'plain', label: 'Plain', weight: 3 },
      { id: 2, name: 'cargo', label: 'Cargo', look: { pants: { cargo: true } } },
      { id: 3, name: 'scrub', label: 'Loose', look: { pants: { loose: 0.007, belt: false } }, weight: 0.5 },
      { id: 4, name: 'shorts', label: 'Shorts', look: { pants: { shorts: true } }, offer: false },
    ],
  },
  { key: 'trouserColor', wire: 49, section: 'clothes', label: 'Trouser colour', kind: 'swatch', palette: 'dye', default: 'jeans', path: 'pants.color', prefer: ['denim', 'earth', 'neutral', 'dark'], when: { field: 'layer', not: ['overalls', 'coverall'] } },
  { key: 'trouserFabric', wire: 50, section: 'clothes', label: 'Trouser fabric', kind: 'pick', default: 'denim', path: 'pants.region', retired: [], options: FABRICS.filter((f) => ['denim', 'twill', 'cotton', 'canvas'].includes(f.name)), when: { field: 'layer', not: ['overalls', 'coverall'] } },
  // (a belt shows under a top tucked in or open, and not under overalls or a coverall, nor on loose trousers)
  { key: 'belt', wire: 51, section: 'clothes', label: 'Belt', kind: 'swatch', palette: 'leather', default: 'dark', none: 'No belt', noneOdds: 0.15, path: 'gear.belt.color', when: [{ any: [{ field: 'fit', in: ['tucked'] }, { field: 'front', in: ['open'] }] }, { field: 'layer', not: ['overalls', 'coverall'] }, { field: 'trousers', not: ['scrub'] }] },
  {
    key: 'shoes', wire: 52, section: 'clothes', label: 'Shoes', kind: 'pick', default: 'boot', path: 'shoes.kind', retired: [],
    options: [
      { id: 1, name: 'boot', label: 'Boots', weight: 3 },
      { id: 2, name: 'work', label: 'Work boots', weight: 2 },
      { id: 3, name: 'sneaker', label: 'Sneakers', weight: 2 },
      { id: 4, name: 'dress', label: 'Dress shoes', offer: false },
    ],
  },
  { key: 'shoeColor', wire: 53, section: 'clothes', label: 'Shoe colour', kind: 'swatch', palette: 'leather', default: 'brown', path: 'shoes.color' },
  // ---------------------------------------------------------------- gear
  {
    key: 'badge', wire: 54, section: 'gear', label: 'Badge', kind: 'pick', default: 'none', path: 'gear.badge', retired: [],
    options: [
      { id: 0, name: 'none', label: 'None', weight: 8 },
      { id: 1, name: 'chest', label: 'On the chest' },
      { id: 2, name: 'belt', label: 'On the belt' },
    ],
  },
  { key: 'holster', wire: 55, section: 'gear', label: 'Holster', kind: 'pick', default: 'none', path: 'gear.holster', retired: [], options: NONE_ON('Holster', { excludes: { toolbelt: ['on'] } }) },
  { key: 'radio', wire: 56, section: 'gear', label: 'Radio', kind: 'pick', default: 'none', path: 'gear.radio', retired: [], options: NONE_ON('Radio') },
  { key: 'lanyard', wire: 57, section: 'gear', label: 'Lanyard', kind: 'swatch', palette: 'accent', default: 'none', none: 'None', noneOdds: 5, path: 'gear.lanyard' },
  { key: 'gloves', wire: 58, section: 'gear', label: 'Gloves', kind: 'swatch', palette: 'leather', default: 'none', none: 'None', noneOdds: 4, path: 'gear.gloves.color' },
  { key: 'glasses', wire: 59, section: 'gear', label: 'Glasses', kind: 'swatch', palette: 'accent', default: 'none', none: 'None', noneOdds: 3, path: 'gear.glasses' },
  { key: 'toolbelt', wire: 60, section: 'gear', label: 'Tool belt', kind: 'pick', default: 'none', path: 'gear.toolbelt', retired: [], options: NONE_ON('Tool belt', { excludes: { knife: ['on'] } }) },
  { key: 'patch', wire: 61, section: 'gear', label: 'Name patch', kind: 'swatch', palette: 'accent', default: 'none', none: 'None', noneOdds: 6, path: 'gear.patch' },
  { key: 'watch', wire: 62, section: 'gear', label: 'Watch', kind: 'pick', default: 'none', path: 'gear.watch', retired: [], options: NONE_ON('Watch') },
  { key: 'knife', wire: 63, section: 'gear', label: 'Knife', kind: 'pick', default: 'none', path: 'gear.knife', retired: [], options: NONE_ON('Knife') },
];
// wire indexes of fields that were removed: never used again
export const RETIRED_WIRE = [];

// part names people.js builds that are not a choice of their own here (the dead's kit, a garment's details that come
// with another choice): the guard test's "known, not offered" list
export const BUILDER_ONLY = ['scrubs', 'tie', 'apron', 'wristband'];
