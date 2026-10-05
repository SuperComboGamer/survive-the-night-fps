// Three ways to play the same valley. Nightfall is the game as it has always been: every number below is 1,
// and a game that does not name a difficulty is Nightfall. Ember is for someone who does not really play
// shooters. Blackout is for someone who does.
//
// What actually knocks a new player down is not one big number. They miss. They do not headshot. They stand
// still while a runner closes, because sprinting and looking at the same time is its own skill. They spend
// the first day lost, so dark arrives before they have a wall or a bandage. Ember answers each of those,
// and leaves the rest of the valley alone: the same map, the same guns, the same car to fix.
//
// Stamina is not one of the levers. It is stepped on the server and on each player's own machine from the
// same constants, and a per-game rate would have the two disagree about every sprint. Longer days and
// slower dead cover "I cannot sprint and aim" without that split.
//
// Aim help is a slightly wider body, not a wider head and not a camera that turns for you. A shot that
// passes close still counts. A shot that was going to be a headshot is still a headshot only if it hits
// the head. Both sides judge shots against the same shape (shared/hitbox.js), so the client has to be
// told the difficulty (S2C.ROOM) or its hit markers would lie.

export const DIFFICULTIES = [
  {
    id: 'ember',
    name: 'Ember',
    rank: 'Easy',
    // The line under the choice on the new-game card.
    blurb: 'Fewer dead, and they hit softer and move slower. Days and nights run long, near shots count, and you start with more rounds and bandages.',
    day: 1.5, // day 1 is 9 min, was 6. The last days floor at 4½ min, was 3. The minute of horn stays a minute.
    night: 1.4, // 3½ min, was 2½. The three waves spread out with the night, so there is time to reload between them.
    zombies: 0.55, // night 1 alone is 9 of them, was 17. The day's wanderers, the road herd and a car alarm shrink the same way.
    zombieHp: 0.72, // a walker falls to three pistol shots in the body, was four. Headshots stay the better bet.
    hurt: 0.55, // a walker's claw is 6, was 11: about fifteen hits to go down, was nine. Falls and the lake soften too.
    speed: 0.86, // a runner is barely faster than a walk. A sprint still leaves one behind. A shade no longer keeps up with one.
    specials: 0.45, // spitters, boomers, leapers, ropers, shades and bats turn up less. The one new kind a night still comes.
    heal: 1.75, // the slow heal between fights. A campfire is unchanged: building one is still worth it.
    healDelay: 0.6, // 5 s after a hit before that heal starts, was 8.
    down: 1.5, // 45 s on the ground for a friend to get there, was 30.
    revive: 0.7, // picking them up takes about 2½ s, was 3½.
    ammo: 2, // 72 rounds of 9mm in reserve on day 1, was 36. Misses are affordable.
    bandages: 2, // four at the start, was two. Coming back at dawn is two, was one.
    aim: 1.22, // body only. About a hand's width of forgiveness on a walker.
    melee: 1.25, // the knife and the hammer reach a step further. Claws do not: dying is not easier on your friends.
    loot: 1.35, // ground piles are almost always there, and a container gives one extra find.
    light: 0.6, // the flashlight lasts. New players leave it on.
  },
  {
    id: 'nightfall',
    name: 'Nightfall',
    rank: 'Standard',
    blurb: 'The valley as it plays today. Days shrink, the nights fill up, and a shot that misses is a miss.',
    day: 1,
    night: 1,
    zombies: 1,
    zombieHp: 1,
    hurt: 1,
    speed: 1,
    specials: 1,
    heal: 1,
    healDelay: 1,
    down: 1,
    revive: 1,
    ammo: 1,
    bandages: 1,
    aim: 1,
    melee: 1,
    loot: 1,
    light: 1,
  },
  {
    id: 'blackout',
    name: 'Blackout',
    rank: 'Hard',
    // A person who already headshots and kites. Body shots and standing still stop being enough.
    blurb: 'More of them, harder hits, less time before dark, and less in your pockets. For people who already play shooters.',
    day: 0.8, // day 1 is just under 5 min, was 6. Still the long first day, but you have to know where you are going.
    night: 0.85, // a little over 2 min. The waves sit closer together.
    zombies: 1.4, // night 1 alone is 24, was 17. The daytime cap rises with them, still under the night's own limit.
    zombieHp: 1.28, // a walker takes five shots in the body, or two in the head.
    hurt: 1.4, // a walker's claw is about 15: six hits and you are down. The lake and a bad fall count too.
    speed: 1.1, // a runner makes you sprint. A shade can stay with a sprint.
    specials: 1.55,
    heal: 0.65,
    healDelay: 1.35, // about 11 s before the slow heal starts.
    down: 0.75, // 22 s to bleed out.
    revive: 1.25, // about 4½ s to pick someone up, out in the open.
    ammo: 0.67, // 24 rounds in reserve, was 36. The magazine is still full.
    bandages: 0.5, // one bandage, was two.
    aim: 1, // the bodies stay the size they look. Shrinking them would make the picture a lie.
    melee: 1,
    loot: 0.85, // fewer piles on the ground. Containers still pay what they paid.
    light: 1.15,
  },
];

const BY_ID = Object.fromEntries(DIFFICULTIES.map((d) => [d.id, d]));

export const NIGHTFALL = BY_ID.nightfall;

// The difficulty a game is played on. Anything it does not know is Nightfall: an old save, a quick join, a
// field left off the wire.
export function difficultyOf(id) {
  return BY_ID[id] || NIGHTFALL;
}

// What a create-game request asked for. Nothing asked is Nightfall. A name this game does not have is null,
// and the request is refused: a typo should not silently start the wrong valley.
export function chosenDifficulty(value) {
  if (value == null || value === '') return NIGHTFALL.id;
  return BY_ID[value] ? BY_ID[value].id : null;
}

// How a list, an invite and the pause menu name it: "Ember (easy)".
export function difficultyLabel(id) {
  const d = difficultyOf(id);
  return `${d.name} (${d.rank.toLowerCase()})`;
}
