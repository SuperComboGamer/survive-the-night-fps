// The bestiary: every kind of the dead (ZTYPE), the order the book lists them in, and what it says of each - a vague
// line while the player has never seen one, and once they have, a tip on how it fights and how to fight it. A
// player's record is a bitmask of ZTYPEs (bit t: seen a kind t), kept per account in Postgres (server/userbestiary.js,
// user_bestiary) and per browser for a guest (client/net/bestiary.js).
//
// Seeing one (server/bestiary.js): one of that kind, alive, within SEEN_RANGE metres of the survivor's eye with a clear
// line to its head - walls, trees, the lie of the land and the rock of the mine block it; the dark and the fog do not.
import { ZTYPE, ZOMBIE_DEFS } from './defs.js';

export const SEEN_RANGE = 35; // m

// EVT.BESTIARY flags. ALL: the mask is the player's whole record (sent as they join, and again on a rejoin); without
// it, the kinds just seen. ACCOUNT: the record is the account's, which the server keeps; without it, the browser keeps
// a guest's, and what comes is for it to add to its own
export const BESTF = { ALL: 1, ACCOUNT: 2 };

// tip: a boss's (and the Tank's) is its ZOMBIE_DEFS tip, shown when one comes; the rest are the bestiary's own
const B = (t, group, vague, tip = ZOMBIE_DEFS[t].tip) => Object.freeze({ t, group, name: ZOMBIE_DEFS[t].name, vague, tip });
export const BESTIARY = Object.freeze([
  B(ZTYPE.WALKER, 'horde', 'Slow, shuffling footsteps. A lot of them.', 'Slow and clumsy on its own, deadly in a crowd. Go for the head, or shoot its legs to trip it or leave it crawling. Never let a group box you in.'),
  B(ZTYPE.RUNNER, 'horde', 'Something fast, heard before it is seen.', 'It screams and sprints the moment it finds you, but it is frail: a few rounds or one good swing puts it down. Fight with your back to a wall so they come from one side.'),
  B(ZTYPE.DOG, 'horde', 'Something low on four legs, never alone.', 'Hunts in packs: fast, fragile, and it lunges. A dog cannot jump a barricade, so leave no gap in your walls.'),
  B(ZTYPE.BAT, 'horde', 'Leathery wings, somewhere over the walls.', 'Flies straight over every wall you build. Quick but frail: a shotgun or a melee swing brings it down.'),
  B(ZTYPE.SPITTER, 'special', 'A wet hiss from somewhere out of reach.', 'Spits acid from about 20 m. The acid eats barricades, not walls. Shoot it first, before it melts your defences.'),
  B(ZTYPE.BOOMER, 'special', 'Bloated, and in no hurry at all.', 'Waddles up to your walls and bursts against them. Shoot it far off: it still bursts when it dies, so never next to you or what you built.'),
  B(ZTYPE.LEAPER, 'special', 'It stays low, and not on the ground for long.', 'Pounces from up to 14 m and pins you down. Press jump to throw it off, or stay close to a teammate who can shoot it off you.'),
  B(ZTYPE.SHADE, 'special', 'Something tall that keeps to the dark.', 'It only moves in the dark, fast, and it hits hard. Any light on it - a flashlight, a torch, a campfire - freezes it where it stands, though it shrugs off most damage while lit. Keep a light on it and keep your distance.'),
  B(ZTYPE.ROPER, 'special', 'Something that reaches further than it should.', 'Lashes a rope at you from up to 24 m and drags you in. The rope needs line of sight: keep to cover, and shoot the roper to break it.'),
  B(ZTYPE.TANK, 'special', 'Heavy footsteps that shake the ground.'),
  B(ZTYPE.BOSS_BRUTE, 'boss', 'A hulking shape, slow for now.'),
  B(ZTYPE.BOSS_ALPHA, 'boss', 'A howl, and the dogs answer it.'),
  B(ZTYPE.BOSS_BLOATER, 'boss', 'Something enormous, swollen fit to burst.'),
  B(ZTYPE.BOSS_ABOMINATION, 'boss', 'The ground shakes where it walks.'),
  B(ZTYPE.BOSS_HIVEQUEEN, 'boss', 'A droning that comes from something huge.'),
]);
export const BESTIARY_GROUPS = Object.freeze([
  ['horde', 'The horde'],
  ['special', 'Specials'],
  ['boss', 'Bosses'],
]);

export const BESTIARY_ALL = BESTIARY.reduce((m, e) => m | (1 << e.t), 0);
export const bit = (t) => 1 << t;
// a mask from anywhere (the wire, storage, the database): only kinds the book has
export const cleanSeen = (m) => (Number.isInteger(m) ? m & BESTIARY_ALL : 0);
export function seenCount(m) {
  let n = 0;
  for (const e of BESTIARY) if (m & bit(e.t)) n++;
  return n;
}
// the kinds in a mask, in the book's order
export const seenKinds = (m) => BESTIARY.filter((e) => m & bit(e.t));
