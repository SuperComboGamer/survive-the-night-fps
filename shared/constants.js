// Shared constants used by both the authoritative server and the client.

export const SERVER_TICK_RATE = 20; // snapshots + AI per second
export const SERVER_DT = 1 / SERVER_TICK_RATE;
export const CMD_RATE = 60; // player input commands per second (fixed step)
export const CMD_DT = 1 / CMD_RATE;
export const CMDS_PER_PACKET = 3; // the client batches its commands into one packet per server tick...
export const CMDS_PER_PACKET_IDLE = 6; // ...and into half as many while it has nothing to say (no keys held, mouse still)
export const INTERP_DELAY = 0.1; // seconds remote entities are rendered in the past
export const MAX_REWIND = 1; // lag compensation cap (seconds). A shot asks for its ping plus about 0.2 s: this covers a ping of 0.8 s
export const HISTORY_TICKS = 32; // positions a target keeps for it (a power of two, and more ticks than MAX_REWIND spans)

export const MAX_PLAYERS = 8;
export const DEFAULT_PORT = 3000;

// World
export const MAP_SIZE = 640; // meters, square
export const MAP_HALF = MAP_SIZE / 2;
export const GRID_STEP = 2; // heightmap resolution (m)
export const GRID_N = MAP_SIZE / GRID_STEP + 1; // vertices per side
export const WATER_LEVEL = -2.0;
export const BUILD_REACH = 7; // structures are placed within this distance of the builder (anywhere on the map)
export const CAMPFIRE_HEAL_RADIUS = 7; // built campfires heal survivors resting nearby
export const CRAFT_STATION_RADIUS = 5.5; // stand this close to a lit campfire / workbench to use it
export const MAX_STRUCTURES = 320;

// Player physics
export const PLAYER_RADIUS = 0.35;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_CROUCH_HEIGHT = 1.2;
export const EYE_HEIGHT = 1.62;
export const EYE_HEIGHT_CROUCH = 1.05;
export const WALK_SPEED = 4.6;
export const SPRINT_SPEED = 7.5;
export const CROUCH_SPEED = 2.1;
export const GUN_CARRY_SPEED = 0.5; // every pace while carrying the mounted gun (s.hmg: shared/mountedgun.js)
export const ZOMBIE_PLAYER_SPEED = 6.4;
export const GRAVITY = 16;
export const JUMP_VELOCITY = 5.4;
export const STEP_HEIGHT = 0.45;
export const GROUND_ACCEL = 11;
export const AIR_ACCEL = 1.6;
export const FRICTION = 7;

export const STAMINA_MAX = 100;
export const STAMINA_DRAIN = 14; // per second sprinting
export const STAMINA_REGEN = 19;
export const STAMINA_REGEN_DELAY = 0.9;
export const STAMINA_JUMP_COST = 9;
export const STAMINA_UNLOCK = 30; // exhausted until this much regained

export const PLAYER_MAX_HP = 100;
export const ZOMBIE_PLAYER_MAX_HP = 260;
export const HEAL_DELAY = 8; // seconds since last damage before regen
export const HEAL_RATE = 0.4; // hp per second passive
export const HEAL_RATE_CAMPFIRE = 2.4;

// Downed / revive (co-op): at 0 HP a survivor with living teammates goes down instead of dying
export const DOWN_TIME = 30; // seconds until a downed survivor bleeds out
export const DOWN_CRAWL_SPEED = 0.9;
export const REVIVE_TIME = 3.5; // hold [E] on a downed teammate
export const REVIVE_HP = 40;
export const EYE_HEIGHT_DOWNED = 0.55;

// Death: a survivor who dies rises as a player-controlled zombie and hunts the team. With DAWN_RETURN on, that
// lasts until the next sunrise: the sun that burns the horde burns it out of them too, and they are survivors
// again, beside the team, with next to nothing (Game.returnFallen). false = the rule as it was: one death lasts
// the rest of the run (and nothing else in the game changes).
export const DAWN_RETURN = true;

// Zombie legs (ZOMBIE_DEFS[t].legs): shots below the hip hit a leg. They trip the zombie and wear the leg down;
// a leg blown off leaves it hobbling, and with both gone it drags itself along the ground
export const LEG_ZONE = 0.48; // the legs reach this far up the body (fraction of its height)
export const LEG_HP = 0.3; // damage a leg takes before it is blown off (fraction of the zombie's max hp)
export const LEG_BODY_DAMAGE = 0.4; // share of a leg hit's damage that also comes off the zombie's hp
export const STUMBLE_TIME = 0.7; // a leg hit trips it for this long (s)
export const STUMBLE_SPEED = 0.2; // speed multiplier while it catches itself
export const HOBBLE_SPEED = 0.5; // speed multiplier on one leg
export const CRAWL_SPEED = 0.3; // speed multiplier with no legs...
export const CRAWL_SPEED_MIN = 0.8; // ...but never slower / faster than this (m/s)
export const CRAWL_SPEED_MAX = 1.5;
export const CRAWL_SLOW = 0.6; // ...and this much of it with nobody to chase
// (the crawl pose is drawn to these: the model sandbox prints where the head is, /sandbox/models-test.html?film=0&legs=3)
export const CRAWL_HEIGHT = 0.45; // a crawler's body is this tall (m)...
export const CRAWL_RADIUS = 0.5; // ...and this far across, lying down
export const CRAWL_HEAD_Y = 0.38; // its head is this high off the ground...
export const CRAWL_HEAD_FWD = 0.5; // ...and this far ahead of the middle of its body

// Hold-to-interact durations
export const SEARCH_TIME = 1.0; // search a container
export const ENGINE_START_TIME = 2.2; // start the car once every supply is installed

// Interaction reach. The client offers [E] on the nearest thing its view ray passes within PICK_RADIUS of, up to
// INTERACT_REACH from the eye (Entities.pick), so the thing itself can be hypot(INTERACT_REACH, radius) away. The
// server takes its limits from the same numbers (Game.reachOf) and allows INTERACT_SLACK on top: it handles an
// action the moment it arrives, while the commands that moved the player there are still batched on the client or
// queued for the next tick - up to about 0.1 s of movement. A prompt on screen must never be refused for distance.
export const INTERACT_REACH = 3.3;
export const PICK_RADIUS = { ITEM: 0.5, CACHE: 0.75, CRATE: 1.1, DOWNED: 1.1 }; // structures: structPickRadius in defs.js
export const INTERACT_SLACK = SPRINT_SPEED * 0.1;
export const HOLD_SLACK = 0.4; // a hold under way is only broken off this much further out than it can start
export const CAR_REACH = 3.9; // [E] at the car is offered this close to it (the server allows 5 m: Game.nearCar)

export const FLASHLIGHT_MAX = 100;
export const FLASHLIGHT_DRAIN = 0.55; // per second while on
export const FLASHLIGHT_RECHARGE = 0.35; // per second while off
export const FLASHLIGHT_RANGE = 36; // the beam counts as light on a Shade out to here (m)
export const FLASHLIGHT_CONE = 0.4; // half-angle of the beam (rad)
export const FIRE_LIGHT_MARGIN = 5; // a burning patch of ground lights this far beyond its edge (m)

// Day / night (seconds)
// The days get shorter as the run goes on (dayLength). The first is long: finding your feet at the breakdown and
// stocking up before the first boss. The second is for finding somewhere to hold. Then each day is DAY_SHRINK
// shorter than the one before, down to DAY_LENGTH: a dash out to a place, a look round it, on to a second one, and
// the horn. That floor was timed with the player simulation over 40 valleys (scripts/daytime.js), sprint held, by a
// survivor who knows where every container is: 14 s from the breakdown to the nearest place (17 on a bad map), 15 s
// on to the next (20), and 25-30 s to search every container in one (48); walking all the way, a third more. So it
// allows 40 s on the road and 40 s in each of two places before the horn, and DUSK_WARNING after it. Every day
// length includes its DUSK_WARNING.
export const FIRST_DAY_LENGTH = 360;
export const SECOND_DAY_LENGTH = 270;
export const DAY_SHRINK = 15;
export const DAY_LENGTH = 180; // the shortest a day gets (day 8 on)
export const dayLength = (day) => (day <= 1 ? FIRST_DAY_LENGTH : Math.max(DAY_LENGTH, SECOND_DAY_LENGTH - DAY_SHRINK * (day - 2)));
export const NIGHT_LENGTH = 150;
export const DUSK_WARNING = 60; // horn: pick a spot and build a shelter
export const NIGHT_WAVES = 3; // each night's horde arrives in waves
export const WAVE_TIMES = [4, 52, 100]; // seconds into the night each wave starts
export const WAVE_SPREAD = 26; // a wave trickles in over this many seconds
export const HORDE_SPAWN_MIN = 58; // horde groups appear this far from the survivors (around wherever they are)
export const HORDE_SPAWN_MAX = 84;
// Every night has a boss (shared/nights.js nightBoss). A Tank that comes as one has this share of a Tank's health.
// It was halved while the days were short; with the long first two days it is back at full, which players have
// brought down with guns and a prepared spot. Halve it again if a night-2 Tank proves too much.
export const TANK_BOSS_HP = 1;
// Every night boss comes in with this wave (index into WAVE_TIMES), not at the end of the night: the sun kills
// whatever is left at dawn, so a boss has to arrive while there is still time to bring it down
export const BOSS_WAVE = 1;
export const BOSS_HP_PER_PLAYER = 0.6; // boss health: its base hp, plus this share of it for every survivor after the first
export const BOSS_HP_PER_NIGHT = 0.1; // ...and this share of it for every night after the first

// Noise: how far (m) each loud thing carries to the dead. Every zombie inside that radius with nobody to chase
// comes to look, so a louder noise pulls in more of them - and the louder it was where a zombie stood, the
// harder it runs (NOISE_RUSH). Gunshots: WEAPONS[w].noise, default NOISE.GUNSHOT
export const NOISE = {
  GUNSHOT: 70,
  EXPLOSION: 170, // pipe bombs, boomers
  CAR_ALARM: 140,
  CRATE_LAND: 60, // a supply crate thumping down
  MOLOTOV: 45, // the bottle shattering
  SALVAGE: 35, // prying a wreck apart
  CHOP: 30,
  BUILD: 30, // hammering a structure together
  BELL: 220, // each toll of the chapel bell
  RADIO: 90, // the Relay Station's radio calling for a supply drop
  FAIR: 150, // the calliope of the Tri-County Fair, for as long as its generator runs
};
export const NOISE_RUSH = 50; // a zombie this far (m) inside a noise's radius comes at a full run; nearer the edge it ambles
export const NOISE_SPEED_MIN = 0.55; // speed multiplier towards the faintest noise it still hears
export const NOISE_MEMORY = 8; // it keeps heading for a noise for the time the trip takes plus this (s)...
export const NOISE_MEMORY_MAX = 60; // ...but gives up after this long
export const ESCAPE_TIME = 90; // engine warm-up: the final stand at the car
export const ESCAPE_RADIUS = 14; // the warm-up only runs while a survivor on their feet is this close to the car; survivors this close when it drives off escape
export const ESCAPE_DRIVE_TIME = 3; // hold [E] at the car once the engine is warm: get in and drive, which ends the run
export const GAME_OVER_DELAY = 12;

// Supply drops: a cargo plane crosses the valley in a straight line and kicks the crate off its ramp
export const PLANE_SPEED = 62; // m/s
export const PLANE_LEAD = 800; // the plane appears (and later vanishes) this far from the release point
export const PLANE_ALTITUDE = 110; // above the crate's landing spot
export const PLANE_RAMP = 9; // cargo ramp sits this far behind the plane's origin (the crate leaves from here)
export const CRATE_FREEFALL = 1.2; // seconds before the parachute opens
export const CRATE_FALL_SPEED = 5.5; // descent under the canopy (m/s)
export const CRATE_DRAG = 1.5; // 1/s: the crate sheds the plane's forward speed (drifts PLANE_SPEED / CRATE_DRAG m)

// Talking: voice and text chat only carry so far, so you hear the survivors around you and nobody else. Every
// survivor carries a walkie-talkie in weapon slot 6 (SLOT_RADIO): with it in hand, chat goes out to every other
// survivor, and holding the fire button keys it so the voice does too (radioKeyed in playersim.js)
export const TALK_CLEAR = 25; // heard at full strength out to here (m)...
export const TALK_RANGE = 35; // ...fading to nothing by here

// Networking / relevance
export const AOI_RADIUS = 115; // players, zombies, projectiles
export const AOI_ITEM_RADIUS = 55;
export const AOI_STRUCTURE_RADIUS = 160;
export const AOI_CACHE_RADIUS = 60; // searchable containers
export const LOD_NEAR = 45; // entities beyond this update every 2nd tick
export const MAX_ENTITIES = 16384;

// Slots (CS:GO style) - keys 1..6. The first five hold what the player equips (state.weapons); the walkie-talkie in
// slot 6 is everybody's and holds nothing (ITEM.WALKIE stands in for it wherever the item in hand is asked for)
export const SLOT_PRIMARY = 0;
export const SLOT_PISTOL = 1;
export const SLOT_MELEE = 2;
export const SLOT_THROW = 3;
export const SLOT_BUILD = 4;
export const SLOT_RADIO = 5;
export const NUM_SLOTS = 6;

// The backpack grid. Every survivor has INVENTORY_SIZE slots; a Backpack worn (ITEM.BACKPACK, in an equipment slot of
// its own like armor) opens BACKPACK_SLOTS more in the same grid. An inventory is always INVENTORY_MAX slots long:
// the ones past its capacity (inventoryCap) are locked, and nothing ever goes into them.
export const INVENTORY_SIZE = 24;
export const BACKPACK_SLOTS = 10;
export const INVENTORY_MAX = INVENTORY_SIZE + BACKPACK_SLOTS;
export const inventoryCap = (backpack) => INVENTORY_SIZE + (backpack ? BACKPACK_SLOTS : 0);

// Input buttons bitmask
export const BTN = {
  FWD: 1,
  BACK: 2,
  LEFT: 4,
  RIGHT: 8,
  JUMP: 16,
  SPRINT: 32,
  CROUCH: 64,
  ATTACK: 128,
  ALT: 256,
  RELOAD: 512,
  GUN: 1024, // the trigger of the mounted gun, from the survivor who mans it (shared/mountedgun.js). The simulation ignores it
};

export const PHASE = {
  WAITING: 0,
  DAY: 1,
  NIGHT: 2,
  GAMEOVER: 3,
  VICTORY: 4,
  CROSSING: 5, // between the acts: the car is on the bridge to the mainland (shared/acts.js). Nobody acts; timeLeft is the cutscene's
};
