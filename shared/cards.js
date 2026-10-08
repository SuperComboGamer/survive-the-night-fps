// Dead Hand, the card game survivors play against each other (shared/cardgame.js plays a match, shared/cardai.js is
// the computer across the table): every card there is, the starter set everyone owns, what makes a deck legal, and
// what comes out of a pack. Shared: the server keeps each owner's found cards and decks (server/usercards.js) and
// checks every deck against validateDeck before a match; the client shows the cards (client/ui/cardface.js) and
// builds decks with the same rules.
//
// A card's id is what is kept (user_cards, user_decks, a pack's reveal, the wire): ids are permanent, append only,
// never reused. 1-99 neutral, 100-199 the Survivors, 200-299 the Dead, 400 + a character id the Survivors' leaders
// (shared/characters.js), 450 + n the Dead's (the bosses). `key` is a name for code and tests, also permanent.
//
// Card shape: { id, key, name, f (F), k (K), rows (ROWM mask: where a unit may stand), pow, ab (AB), r (RAR), art,
// line, ... } and, where they apply:
//   grp     a Horde's or a Crew's group (GROUPS): the cards that come with it, or bond with it
//   sRow    a Scorch-row unit's or a scorching leader's target: that row (ROW) of the opponent's
//   wRow    a weather card's row (ROW), on both sides of the board
//   legend  untouchable: no weather, horn, morale, scorch, medic or decoy works on it
//   dark    the Nightfall (the Close row's weather) does not touch it
//   la      a leader's ability (LA), lname its name, hRow the row of its own it horns, passive: works by itself at
//           the start of the match and is never played
// art: what the card's picture is of (client/ui/cardart.js draws it):
//   ['z', ZTYPE, variant] one of the dead      ['s', seed, ITEM] a survivor holding that item
//   ['c', charId]         a character         ['p', propType]   a prop of shared/props.js
//   ['d', deerVariant]    a deer              ['cat']           the stray cat
//   ['g', glyph]          a glyph             ['i', ITEM]       an item
import { ITEM, ZTYPE, ZOMBIE_DEFS } from './defs.js';
import { CHARACTERS } from './characters.js';

export const F = Object.freeze({ NEUTRAL: 0, SURVIVORS: 1, DEAD: 2 });
export const F_NAMES = Object.freeze(['Neutral', 'Survivors', 'The Dead']);
// what each side has going for it (shared/cardgame.js endRound), as the deck builder says it
export const F_PERKS = Object.freeze(['', 'Scavenge: a card drawn for each round they take, and a tie with the Dead is theirs.', 'They keep coming: one of their units stays on the board after each round.']);
export const K = Object.freeze({ UNIT: 1, SPECIAL: 2, LEADER: 3 });
// the three rows of a side, nearest the middle first: Close, Ranged, Heavy. ROWM: as a bit mask (a card's rows)
export const ROW = Object.freeze({ C: 0, R: 1, H: 2 });
export const ROWM = Object.freeze({ C: 1, R: 2, H: 4 });
export const ROW_NAMES = Object.freeze(['Close', 'Ranged', 'Heavy']);
// rarity: caps the copies of a card in a deck (DECK_RULES.copies) and weighs what a pack holds (rollPack)
export const RAR = Object.freeze({ C: 1, R: 2, L: 3 });
export const RAR_NAMES = Object.freeze({ 1: 'Common', 2: 'Rare', 3: 'Legendary' });

// What a unit does (shared/cardgame.js), and what a special card is:
//   HORDE       played or revived, it brings every card of its group in your deck onto the board with it (those do
//               not bring more; never from your hand)
//   CREW        its strength is multiplied by the number of its group in its row (itself counted)
//   BITTEN      it goes to the same row on your opponent's side (it counts for them), and you draw 2
//   MEDIC       you bring back a unit from your discard (not a legend), played as if from your hand
//   MORALE      +1 to every other unit in its row
//   HORN_UNIT   doubles every other unit in its row (as a horn does; never twice)
//   SCORCH_ROW  as it is played: if the opponent's sRow row totals 10 or more, its strongest units (not legends) die
//   AGILE       stands in Close or Ranged (its rows say so; the ability is for the card's text)
//   CLEAR       a unit that clears the weather as it is played; the special (Dawn) does only that
//   WEATHER     every unit in the wRow rows of both sides (not legends) is worth 1
//   HORN        doubles a row of yours (one horn a row)
//   SCORCH      the strongest units on the whole board die, yours too (not legends)
//   DECOY       a unit of yours (not a legend) goes back to your hand, the decoy (worth 0) stands in its place
export const AB = Object.freeze({
  NONE: 0,
  HORDE: 1,
  CREW: 2,
  BITTEN: 3,
  MEDIC: 4,
  MORALE: 5,
  HORN_UNIT: 6,
  SCORCH_ROW: 7,
  AGILE: 8,
  CLEAR: 9,
  WEATHER: 10,
  HORN: 11,
  SCORCH: 12,
  DECOY: 13,
});
export const AB_NAMES = Object.freeze({
  [AB.HORDE]: 'Horde',
  [AB.CREW]: 'Crew',
  [AB.BITTEN]: 'Bitten',
  [AB.MEDIC]: 'Medic',
  [AB.MORALE]: 'Morale',
  [AB.HORN_UNIT]: 'Rally',
  [AB.SCORCH_ROW]: 'Scorch',
  [AB.AGILE]: 'Agile',
  [AB.CLEAR]: 'Clear Skies',
  [AB.WEATHER]: 'Weather',
  [AB.HORN]: 'Horn',
  [AB.SCORCH]: 'Scorch',
  [AB.DECOY]: 'Decoy',
});

// A leader's ability: used once a match, and using it is the turn (passive ones work by themselves at the start)
//   PEEK     3 cards of the opponent's hand that you have not seen are shown to you, and stay shown while they are there
//   HORN     horns a row of yours (hRow), as a Dusk Horn would
//   TRIAGE   a unit from your discard (not a legend) back to your hand (your opponent sees which)
//   HARVEST  discard 2 cards from your hand, then take any card you like from your deck
//   SCORCH   as a Scorch unit: the opponent's sRow row, when it totals 10 or more (not usable under 10)
//   DRAW     passive: you start with 11 cards
//   BADGE    passive: the opponent's leader is cancelled (before anything else; two badges cancel each other)
//   WEATHER  a weather card of your choice from your deck, played
//   SALVAGE  a unit from the opponent's discard (not a legend) to your hand
//   BROOD    a unit from your discard (not a legend) played, as a Medic does
export const LA = Object.freeze({ PEEK: 1, HORN: 2, TRIAGE: 3, HARVEST: 4, SCORCH: 5, DRAW: 6, BADGE: 7, WEATHER: 8, SALVAGE: 9, BROOD: 10 });

// the groups of Horde and Crew cards, as a card's text names them
export const GROUPS = Object.freeze({ walker: 'Walkers', dog: 'Dogs', bat: 'Bats', pile: 'Pile-Ups', road_crew: 'Road Crew', posse: "Sheriff's Posse", convoy: 'Pickup Trucks' });

const { C: RC, R: RR, H: RH } = ROWM;
const N = F.NEUTRAL;
const S = F.SURVIVORS;
const Z = F.DEAD;
const { C: COM, R: RARE, L: LEG } = RAR;
const card = (o) => Object.freeze({ ab: AB.NONE, ...o, art: Object.freeze(o.art) });
// a unit: u(id, key, name, faction, rows, pow, rarity, art, line, extra)
const u = (id, key, name, f, rows, pow, r, art, line, x = {}) => card({ id, key, name, f, k: K.UNIT, rows, pow, r, art, line, ...x });
// a special: sp(id, key, name, ability, rarity, art, line, extra)
const sp = (id, key, name, ab, r, art, line, x = {}) => card({ id, key, name, f: N, k: K.SPECIAL, rows: 0, pow: 0, ab, r, art, line, ...x });
// a leader (they come in packs as rares)
const lead = (id, key, name, f, la, lname, art, line, x = {}) => card({ id, key, name, f, k: K.LEADER, rows: 0, pow: 0, la, lname, r: RARE, art, line, ...x });
const survivor = (charId) => CHARACTERS[charId].name;
const boss = (t) => ZOMBIE_DEFS[t].name;

export const CARDS = Object.freeze([
  // ---------------------------------------------------------------- neutral
  sp(1, 'nightfall', 'Nightfall', AB.WEATHER, COM, ['g', 'moon'], 'The light goes first. Then the nerve.', { wRow: ROW.C }),
  sp(2, 'fog', 'Fog', AB.WEATHER, COM, ['g', 'eyeOff'], "You hear them before you see them. Then you don't hear them either.", { wRow: ROW.R }),
  sp(3, 'downpour', 'Downpour', AB.WEATHER, COM, ['g', 'rain'], 'Nothing heavy moves in mud like this. Nothing living, anyway.', { wRow: ROW.H }),
  sp(4, 'dawn', 'Dawn', AB.CLEAR, COM, ['g', 'sun'], 'Made it. Count heads.'),
  sp(5, 'dusk_horn', 'Dusk Horn', AB.HORN, RARE, ['g', 'horn'], 'Somebody blows it at dusk. Everyone comes running. Everything does.'),
  sp(6, 'molotov', 'Molotov', AB.SCORCH, RARE, ['i', ITEM.MOLOTOV], 'Rag, bottle, a little faith.'),
  sp(7, 'noise_maker', 'Noise Maker', AB.DECOY, COM, ['i', ITEM.DECOY], 'Tick, tick, tick. Every head in the street turns.'),
  u(8, 'bitten_stranger', 'Bitten Stranger', N, RC, 2, RARE, ['s', 8, ITEM.KNIFE], 'Says it was a dog. Says it twice.', { ab: AB.BITTEN }),
  u(9, 'stray_cat', 'The Stray Cat', N, RC, 1, RARE, ['cat'], 'Belongs to nobody. Everybody feels better anyway.', { ab: AB.MORALE }),
  u(10, 'radio_voice', 'Voice on the Radio', N, RR, 2, RARE, ['s', 10, ITEM.WALKIE], 'Channel nine, every night at ten. Nobody has met her.', { ab: AB.HORN_UNIT }),
  u(11, 'spooked_stag', 'Spooked Stag', N, RC | RR, 4, COM, ['d', 0], "Bolts at the first shot. Which way is anyone's guess.", { ab: AB.AGILE }),
  u(12, 'hermit', 'The Hermit', N, RC, 15, LEG, ['s', 12, ITEM.DB_SHOTGUN], 'Thirty years alone in the hills. Saw this coming.', { legend: true }),
  u(13, 'doc_halloway', 'Doc Halloway', N, RR, 7, LEG, ['i', ITEM.MEDKIT], 'Retired twice. Called back once more.', { ab: AB.MEDIC, legend: true }),

  // ---------------------------------------------------------------- the Survivors
  u(100, 'scavenger', 'Scavenger', S, RC, 2, COM, ['s', 100, ITEM.KNIFE], 'Knows every pantry on the street. Most of them empty now.'),
  u(101, 'slugger', 'Slugger', S, RC, 3, COM, ['s', 101, ITEM.BAT], 'Batted .310 in high school. Still swings for the fences.'),
  u(102, 'brawler', 'Brawler', S, RC, 4, COM, ['s', 102, ITEM.HAMMER], 'Never needed a weapon before. Brought one anyway.'),
  u(103, 'machete_drifter', 'Machete Drifter', S, RC, 5, COM, ['s', 103, ITEM.MACHETE], 'Walked in off the highway. Never said from where.'),
  u(104, 'road_crew', 'Road Crew', S, RC, 3, COM, ['s', 104, ITEM.SPIKED_BAT], 'One holds the sign. The rest hold the line.', { ab: AB.CREW, grp: 'road_crew' }),
  u(105, 'nunchuck_kid', 'Nunchuck Kid', S, RC, 6, RARE, ['s', 105, ITEM.NUNCHAKU], 'Learned it all from tapes. The tapes were right.'),
  u(106, 'bitten_neighbour', 'Bitten Neighbour', S, RC, 4, RARE, ['s', 106, ITEM.FLARE], 'Fine yesterday. Mostly fine today.', { ab: AB.BITTEN }),
  u(107, 'clinic_orderly', 'Clinic Orderly', S, RC, 1, COM, ['i', ITEM.BANDAGE], "Can't stitch. Can carry.", { ab: AB.MEDIC }),
  u(108, 'sheriffs_posse', "Sheriff's Posse", S, RR, 3, COM, ['s', 108, ITEM.PISTOL], 'Sworn in on the courthouse steps. No training. Plenty of ammo.', { ab: AB.CREW, grp: 'posse' }),
  u(109, 'shotgun_guard', 'Shotgun Guard', S, RC | RR, 5, COM, ['s', 109, ITEM.SHOTGUN], 'Close or far, the answer is the same.', { ab: AB.AGILE }),
  u(110, 'crossbow_hunter', 'Crossbow Hunter', S, RR, 4, COM, ['s', 110, ITEM.CROSSBOW], 'Quiet. Patient. Picks up the bolts after.'),
  u(111, 'rifleman', 'Rifleman', S, RR, 5, COM, ['s', 111, ITEM.AK47], 'Counts his rounds out loud. Has not run dry yet.'),
  u(112, 'marksman', 'Marksman', S, RR, 6, RARE, ['s', 112, ITEM.HUNTING_RIFLE], 'Takes the loud ones first.'),
  u(113, 'guardsman', 'Guardsman', S, RR, 7, RARE, ['s', 113, ITEM.M4A1], 'Still in uniform. Takes orders from nobody left alive.'),
  u(114, 'flare_gunner', 'Flare Gunner', S, RR, 2, COM, ['s', 114, ITEM.FLARE_GUN], 'One shot, and the sky is ours for a minute.', { ab: AB.CLEAR }),
  u(115, 'field_medic', 'Field Medic', S, RR, 4, RARE, ['i', ITEM.PAINKILLERS], 'Clean hands, steady voice, short supplies.', { ab: AB.MEDIC }),
  u(116, 'pipe_bomber', 'Pipe Bomber', S, RH, 4, COM, ['s', 116, ITEM.PIPEBOMB], 'Pipe, powder, a kitchen timer. Duck.'),
  u(117, 'grenadier', 'Grenadier', S, RH, 5, COM, ['s', 117, ITEM.GRENADE], 'Pulls the pin with his teeth. Has the dental bills to show for it.'),
  u(118, 'flamethrower', 'Flamethrower', S, RH, 6, RARE, ['s', 118, ITEM.FLAMETHROWER], 'Clears the front row. Anyone standing close gets a tan.', { ab: AB.SCORCH_ROW, sRow: ROW.C }),
  u(119, 'rpg_gunner', 'RPG Gunner', S, RH, 5, RARE, ['s', 119, ITEM.RPG], 'One rocket. Make it count. Make it the big one.', { ab: AB.SCORCH_ROW, sRow: ROW.H }),
  u(120, 'pickup_truck', 'Pickup Truck', S, RH, 3, COM, ['p', 'pickup_truck'], 'Runs on fumes and prayer. Better in a convoy.', { ab: AB.CREW, grp: 'convoy' }),
  u(121, 'old_tractor', 'Old Tractor', S, RH, 5, COM, ['p', 'tractor'], 'Older than the farmer. Twice as stubborn.'),
  u(122, 'school_bus', 'School Bus', S, RH, 4, RARE, ['p', 'school_bus'], 'No school left to drive to. Plenty to drive away from.', { ab: AB.MORALE }),
  u(123, 'mounted_gun', 'Mounted Gun', S, RH, 8, RARE, ['p', 'mg_tripod'], 'Too heavy to carry far. Nobody asks it to.'),
  u(124, 'escape_car', 'The Escape Car', S, RH, 10, LEG, ['p', 'car'], 'New plugs, new battery, half a tank. It will do.', { legend: true }),
  u(125, 'at_rifle_sniper', 'AT Rifle Sniper', S, RR, 10, LEG, ['s', 125, ITEM.AT_RIFLE], 'Built to stop tanks. Stops the Tank.', { legend: true }),
  u(126, 'kevlar_veteran', 'Kevlar Veteran', S, RC, 10, LEG, ['s', 126, ITEM.MP5], 'Two tours overseas. This is the third.', { legend: true }),

  // ---------------------------------------------------------------- the Dead
  u(200, 'walker', 'Walker', Z, RC, 2, COM, ['z', ZTYPE.WALKER, 0], 'Slow. Patient. Never alone.', { ab: AB.HORDE, grp: 'walker' }),
  u(201, 'crawler', 'Crawler', Z, RC, 1, COM, ['z', ZTYPE.WALKER, 1], 'Lost its legs. Kept its appetite.', { ab: AB.HORDE, grp: 'walker' }),
  u(202, 'runner', 'Runner', Z, RC, 4, COM, ['z', ZTYPE.RUNNER, 0], 'Fresh, fast, and furious about it.'),
  u(203, 'screamer', 'Screamer', Z, RC, 3, RARE, ['z', ZTYPE.RUNNER, 1], 'One scream, and the rest find their feet.', { ab: AB.MORALE }),
  u(204, 'zombie_dog', 'Zombie Dog', Z, RC, 3, COM, ['z', ZTYPE.DOG, 0], "Still answers to its name. Don't call it.", { ab: AB.HORDE, grp: 'dog' }),
  u(205, 'pack_hound', 'Pack Hound', Z, RC, 5, RARE, ['z', ZTYPE.DOG, 1], 'By the time you see one, the pack is circling.', { ab: AB.HORDE, grp: 'dog' }),
  u(206, 'leaper', 'Leaper', Z, RC | RR, 5, COM, ['z', ZTYPE.LEAPER, 0], 'Comes down out of nowhere. Usually on you.', { ab: AB.AGILE }),
  u(207, 'shade', 'Shade', Z, RC, 7, RARE, ['z', ZTYPE.SHADE, 0], 'It loves the dark. The dark loves it back.', { dark: true }),
  u(208, 'bat', 'Bat', Z, RR, 2, COM, ['z', ZTYPE.BAT, 0], 'Walls never meant anything to them.', { ab: AB.HORDE, grp: 'bat' }),
  u(209, 'spitter', 'Spitter', Z, RR, 5, COM, ['z', ZTYPE.SPITTER, 0], 'Bad breath, worse aim. Good enough.'),
  u(210, 'roper', 'Roper', Z, RR, 6, RARE, ['z', ZTYPE.ROPER, 0], 'Reaches further than it should. Pulls harder than that.'),
  u(211, 'grave_rouser', 'Grave Rouser', Z, RC, 3, RARE, ['z', ZTYPE.WALKER, 2], 'Knocks on the lids until somebody answers.', { ab: AB.MEDIC }),
  u(212, 'bitten_hiker', 'Bitten Hiker', Z, RC, 4, RARE, ['z', ZTYPE.WALKER, 3], 'Hitched a ride. Brought company.', { ab: AB.BITTEN }),
  u(213, 'boomer', 'Boomer', Z, RH, 4, RARE, ['z', ZTYPE.BOOMER, 0], "Don't shoot it close. Don't let it get close. Pick one.", { ab: AB.SCORCH_ROW, sRow: ROW.C }),
  u(214, 'pile_up', 'Pile-Up', Z, RH, 3, COM, ['p', 'car_burnt'], 'Twelve cars on the ramp. Nobody got out. Not alive.', { ab: AB.HORDE, grp: 'pile' }),
  u(215, 'undead_stag', 'Undead Stag', Z, RH, 6, COM, ['d', 0x80], 'Antlers, rot, and no fear of anything.'), // 0x80: DEER_UNDEAD (shared/deer.js)
  u(216, 'tank', 'Tank', Z, RH, 10, LEG, ['z', ZTYPE.TANK, 0], 'The ground shakes. Then the barricade goes.', { legend: true }),
  u(217, 'patient_zero', 'Patient Zero', Z, RC, 10, LEG, ['z', ZTYPE.RUNNER, 2], 'Admitted at 2:14 a.m. Discharged himself.', { legend: true }),
  u(218, 'the_swarm', 'The Swarm', Z, RR, 10, LEG, ['z', ZTYPE.BAT, 1], 'The sky goes black and starts to chitter.', { legend: true }),
  u(219, 'acid_spitter', 'Acid Spitter', Z, RR, 4, RARE, ['z', ZTYPE.SPITTER, 1], 'Melts what it hits. Hits what you hide behind.', { ab: AB.SCORCH_ROW, sRow: ROW.R }),
  u(220, 'howler', 'Howler', Z, RC, 2, RARE, ['z', ZTYPE.DOG, 2], 'One long note. Every dead thing for a mile answers.', { ab: AB.HORN_UNIT }),

  // ---------------------------------------------------------------- leaders: the Survivors (400 + character id)
  lead(400, 'dale', survivor(0), S, LA.PEEK, 'Trail Sense', ['c', 0], 'Reads a trail like the morning paper. The news is bad.'),
  lead(401, 'rosa', survivor(1), S, LA.HORN, 'Tune-Up', ['c', 1], 'If it has an engine, she can make it scream.', { hRow: ROW.H }),
  lead(402, 'grace', survivor(2), S, LA.TRIAGE, 'Triage', ['c', 2], 'Nobody dies on her shift. Not twice.'),
  lead(403, 'walt', survivor(3), S, LA.HARVEST, 'Harvest', ['c', 3], "Plants what he needs. Pulls what he doesn't."),
  lead(404, 'earl', survivor(4), S, LA.SCORCH, 'Jackknife', ['c', 4], 'Eighteen wheels and no brakes. Stand clear.', { sRow: ROW.H }),
  lead(405, 'maya', survivor(5), S, LA.DRAW, 'Ahead of the Curve', ['c', 5], 'Had a plan before there was a plan.', { passive: true }),
  lead(406, 'marcus', survivor(6), S, LA.BADGE, 'The Badge', ['c', 6], 'The badge still says the law. The law says no.', { passive: true }),
  lead(407, 'hank', survivor(7), S, LA.HORN, 'Spotter', ['c', 7], 'Calls the shot before the shooter sees it.', { hRow: ROW.R }),
  lead(408, 'jess', survivor(8), S, LA.WEATHER, 'Read the Sky', ['c', 8], 'Two weeks on the ridge. She knows what is coming.'),
  lead(409, 'luis', survivor(9), S, LA.SALVAGE, 'Salvage', ['c', 9], 'Every wreck is a parts store.'),
  // ---------------------------------------------------------------- leaders: the Dead (the bosses)
  lead(450, 'brute', boss(ZTYPE.BOSS_BRUTE), Z, LA.SCORCH, 'Crushing Blow', ['z', ZTYPE.BOSS_BRUTE, 0], 'It does not break through the wall. It removes the wall.', { sRow: ROW.C }),
  lead(451, 'alpha', boss(ZTYPE.BOSS_ALPHA), Z, LA.HORN, 'Howl', ['z', ZTYPE.BOSS_ALPHA, 0], 'One howl, and the strays are a pack.', { hRow: ROW.C }),
  lead(452, 'bloater', boss(ZTYPE.BOSS_BLOATER), Z, LA.WEATHER, 'Miasma', ['z', ZTYPE.BOSS_BLOATER, 0], 'Smells like the end of the world. Is.'),
  lead(453, 'abomination', boss(ZTYPE.BOSS_ABOMINATION), Z, LA.SCORCH, 'Rampage', ['z', ZTYPE.BOSS_ABOMINATION, 0], 'Too many arms. All of them busy.', { sRow: ROW.H }),
  lead(454, 'hive_queen', boss(ZTYPE.BOSS_HIVEQUEEN), Z, LA.BROOD, 'Brood', ['z', ZTYPE.BOSS_HIVEQUEEN, 0], 'Everything she loses, she lays again.'),
]);

const BY_ID = new Map(CARDS.map((c) => [c.id, c]));
/** The card with this id, or null. */
export const cardDef = (id) => BY_ID.get(id) || null;
export const isLeader = (id) => BY_ID.get(id)?.k === K.LEADER;

// The starter set: everyone owns it, from the first game, and it is never traded or bet (owned() adds what a player
// has found on top). One of each of the neutral weather, Dawn, the Dusk Horn, the Molotov, the Noise Maker, the
// Bitten Stranger and the Spooked Stag; 22 Survivor units and two leaders; 21 of the Dead and two leaders.
export const STARTER = Object.freeze({
  1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 11: 1,
  100: 2, 101: 2, 102: 1, 104: 3, 108: 3, 109: 1, 110: 2, 111: 2, 114: 1, 107: 1, 116: 2, 117: 1, 121: 1,
  407: 1, 401: 1,
  200: 3, 201: 2, 202: 3, 204: 3, 206: 1, 208: 3, 209: 2, 214: 3, 215: 1,
  451: 1, 450: 1,
});
// the leader each faction's starter deck takes. The starter leaders were picked by playing the starter decks against
// each other (scripts/test-cardgame.js): Hank or Rosa against the Alpha or the Brute come out about even, where Grace
// (the strongest of them with these decks) is a find
const STARTER_LEADER = { [F.SURVIVORS]: 407, [F.DEAD]: 451 };

// A deck: one leader (it says the faction), cards of that faction and neutral ones, at least minUnits units, at most
// maxSpecials specials and maxCards cards (the leader not counted), at most copies[rarity] of a card and no more than
// the player owns
export const DECK_RULES = Object.freeze({ minUnits: 22, maxSpecials: 10, maxCards: 40, copies: Object.freeze({ [RAR.C]: 3, [RAR.R]: 2, [RAR.L]: 1 }) });
export const DECK_SLOTS = 4;
export const PACK_SIZE = 3;
export const FOUND_MAX = 9999;

const count = (n) => (typeof n === 'number' && n > 0 && Number.isFinite(n) ? Math.floor(n) : 0);
/** How many of a card a player owns: the starter set's, and what they have found (found = { id: n }). */
export const owned = (id, found) => (STARTER[id] || 0) + count(found && typeof found === 'object' ? found[id] : 0);

/** The faction a deck plays (its leader's), or -1 without a leader. */
export function deckFaction(deck) {
  const L = BY_ID.get(deck?.leader);
  return L && L.k === K.LEADER ? L.f : -1;
}

// -> { ok, errors: [text a player reads], units, specials }. deck = { leader, cards: { id: n } }, found = { id: n }
export function validateDeck(deck, found = {}) {
  const errors = [];
  let units = 0;
  let specials = 0;
  let total = 0;
  if (!deck || typeof deck !== 'object') return { ok: false, errors: ['That is not a deck.'], units, specials };
  const L = BY_ID.get(deck.leader);
  const f = L && L.k === K.LEADER ? L.f : -1;
  if (f < 0) errors.push('Choose a leader.');
  else if (owned(L.id, found) < 1) errors.push(`You do not own ${L.name}.`);
  const cards = deck.cards && typeof deck.cards === 'object' && !Array.isArray(deck.cards) ? deck.cards : null;
  if (!cards) errors.push('The deck has no cards.');
  for (const [key, n] of Object.entries(cards || {})) {
    const c = BY_ID.get(Number(key));
    if (!Number.isInteger(n) || n < 0) {
      errors.push(`A count of ${c ? c.name : 'a card'} is not a number of cards.`);
      continue;
    }
    if (!n) continue;
    if (!c || String(c.id) !== key) {
      errors.push('There is a card in it that does not exist.');
      continue;
    }
    if (c.k === K.LEADER) {
      errors.push(`${c.name} leads a deck: they are not one of its cards.`);
      continue;
    }
    if (f >= 0 && c.f !== F.NEUTRAL && c.f !== f) errors.push(`${c.name} plays for ${F_NAMES[c.f]}, not ${F_NAMES[f]}.`);
    const cap = DECK_RULES.copies[c.r];
    if (n > cap) errors.push(`At most ${cap} ${c.name} in a deck (${RAR_NAMES[c.r].toLowerCase()}).`);
    const have = owned(c.id, found);
    if (n > have) errors.push(`You own ${have} ${c.name}, not ${n}.`);
    if (c.k === K.UNIT) units += n;
    else specials += n;
    total += n;
  }
  if (units < DECK_RULES.minUnits) errors.push(`At least ${DECK_RULES.minUnits} units (it has ${units}).`);
  if (specials > DECK_RULES.maxSpecials) errors.push(`At most ${DECK_RULES.maxSpecials} special cards (it has ${specials}).`);
  if (total > DECK_RULES.maxCards) errors.push(`At most ${DECK_RULES.maxCards} cards (it has ${total}).`);
  return { ok: errors.length === 0, errors, units, specials };
}

/** A faction's deck out of the starter set alone: legal for anyone. A fresh object each call. */
export function defaultDeck(faction) {
  const f = faction === F.DEAD ? F.DEAD : F.SURVIVORS;
  const cards = {};
  for (const [id, n] of Object.entries(STARTER)) {
    const c = BY_ID.get(Number(id));
    if (c.k !== K.LEADER && (c.f === F.NEUTRAL || c.f === f)) cards[id] = n;
  }
  return { leader: STARTER_LEADER[f], cards };
}

// What a pack holds. Each card: common 68 / rare 27 / legendary 5 (a leader comes as a rare), the 3rd rare or better
// (27 : 5); a Sealed Pack's 3rd is legendary 1 time in 3, else rare. rand: () => [0, 1).
const PACK_WEIGHTS = [
  [RAR.C, 68],
  [RAR.R, 27],
  [RAR.L, 5],
];
const POOL = { [RAR.C]: CARDS.filter((c) => c.r === RAR.C), [RAR.R]: CARDS.filter((c) => c.r === RAR.R), [RAR.L]: CARDS.filter((c) => c.r === RAR.L) };
export function rollPack(rand, { sealed = false } = {}) {
  const r01 = () => {
    const x = Number(rand());
    return x >= 0 && x < 1 ? x : 0;
  };
  const rarity = (weights) => {
    let x = r01() * weights.reduce((a, w) => a + w[1], 0);
    for (const [r, w] of weights) if ((x -= w) < 0) return r;
    return weights[weights.length - 1][0];
  };
  const from = (r) => POOL[r][Math.floor(r01() * POOL[r].length)].id;
  const ids = [];
  for (let i = 0; i < PACK_SIZE - 1; i++) ids.push(from(rarity(PACK_WEIGHTS)));
  ids.push(from(sealed ? (r01() < 1 / 3 ? RAR.L : RAR.R) : rarity(PACK_WEIGHTS.slice(1))));
  return ids;
}

// A player's found cards from anywhere (the database, a save, the wire): unknown ids dropped, counts whole, 1..FOUND_MAX
export function cleanFound(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const key of Object.keys(obj)) {
    const c = BY_ID.get(Number(key));
    if (!c || String(c.id) !== key) continue;
    const n = count(obj[key]);
    if (n) out[c.id] = Math.min(n, FOUND_MAX);
  }
  return out;
}

// A deck from anywhere, shape-checked: { leader, cards: { id: n }, name } or null. leader 0 is an empty slot (its cards
// are dropped). Whether it is legal (and owned) is validateDeck's to say
export function cleanDeck(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const { leader } = obj;
  if (!Number.isInteger(leader) || (leader !== 0 && !isLeader(leader))) return null;
  const name = typeof obj.name === 'string' ? obj.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24).trim() : '';
  if (leader === 0) return { leader: 0, cards: {}, name };
  const src = obj.cards ?? {};
  if (!src || typeof src !== 'object' || Array.isArray(src)) return null;
  const keys = Object.keys(src);
  if (keys.length > CARDS.length) return null;
  const cards = {};
  for (const key of keys) {
    const c = BY_ID.get(Number(key));
    const n = src[key];
    if (!c || String(c.id) !== key || c.k === K.LEADER || !Number.isInteger(n) || n < 0 || n > DECK_RULES.maxCards) return null;
    if (n) cards[c.id] = n;
  }
  return { leader, cards, name };
}

// ---------------------------------------------------------------- what a card says
const rowList = (mask) => ROW_NAMES.filter((_, r) => mask & (1 << r)).join(' or ');
const LEADER_TEXT = {
  [LA.PEEK]: () => "See 3 cards of your opponent's hand you have not seen. They stay shown while they are there.",
  [LA.HORN]: (c) => `Doubles your ${ROW_NAMES[c.hRow]} row, as a horn does.`,
  [LA.TRIAGE]: () => 'Take a unit from your discard back into your hand (not a legend).',
  [LA.HARVEST]: () => 'Discard 2 cards, then take any card you like from your deck.',
  [LA.SCORCH]: (c) => `If your opponent's ${ROW_NAMES[c.sRow]} row totals 10 or more, its strongest units die (not legends).`,
  [LA.DRAW]: () => 'You start with 11 cards in hand.',
  [LA.BADGE]: () => "Your opponent's leader does nothing. Two badges cancel each other.",
  [LA.WEATHER]: () => 'Play a weather card of your choice from your deck.',
  [LA.SALVAGE]: () => "Take a unit from your opponent's discard into your hand (not a legend).",
  [LA.BROOD]: () => 'Play a unit from your discard (not a legend), as a Medic does.',
};
const UNIT_TEXT = {
  [AB.HORDE]: (c) => `Horde: brings every one of the ${GROUPS[c.grp]} in your deck onto the board with it.`,
  [AB.CREW]: (c) => `Crew: worth its strength times the number of ${GROUPS[c.grp]} in its row.`,
  [AB.BITTEN]: () => "Bitten: goes to your opponent's side and counts for them. You draw 2 cards.",
  [AB.MEDIC]: () => 'Medic: play a unit from your discard (not a legend).',
  [AB.MORALE]: () => 'Morale: +1 to every other unit in its row.',
  [AB.HORN_UNIT]: () => 'Rally: doubles every other unit in its row.',
  [AB.SCORCH_ROW]: (c) => `Scorch: if your opponent's ${ROW_NAMES[c.sRow]} row totals 10 or more, its strongest units die (not legends).`,
  [AB.AGILE]: (c) => `Agile: stands in ${rowList(c.rows)}.`,
  [AB.CLEAR]: () => 'Clear Skies: clears all weather as it is played.',
};
const SPECIAL_TEXT = {
  [AB.WEATHER]: (c) => `Every unit in both ${ROW_NAMES[c.wRow]} rows is worth 1 (not legends).`,
  [AB.CLEAR]: () => 'Clears all weather.',
  [AB.HORN]: () => 'Doubles a row of yours. One horn to a row.',
  [AB.SCORCH]: () => 'The strongest units on the board die, yours too (not legends).',
  [AB.DECOY]: () => 'Takes a unit of yours (not a legend) back into your hand and stands in its place, worth 0. Your opponent sees which.',
};

/** The rules text of a card (a card or an id), made from its data. */
export function rulesText(c) {
  const d = typeof c === 'number' ? BY_ID.get(c) : c;
  if (!d || typeof d !== 'object') return '';
  if (d.k === K.LEADER) return `${d.lname}: ${LEADER_TEXT[d.la]?.(d) || ''} ${d.passive ? 'Always on.' : 'Once a match, and it takes your turn.'}`;
  if (d.k === K.SPECIAL) return SPECIAL_TEXT[d.ab]?.(d) || '';
  const out = [];
  if (UNIT_TEXT[d.ab]) out.push(UNIT_TEXT[d.ab](d));
  if (d.dark) out.push('Dark: the Nightfall does not touch it.');
  if (d.legend) out.push('Legend: no weather, horn, card or ability touches it.');
  return out.join(' ');
}
