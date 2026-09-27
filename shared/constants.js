// Shared constants used by both the authoritative server and the client.

export const SERVER_TICK_RATE = 20; // snapshots + AI per second
export const SERVER_DT = 1 / SERVER_TICK_RATE;
export const CMD_RATE = 60; // player input commands per second (fixed step)
export const CMD_DT = 1 / CMD_RATE;
export const CMDS_PER_PACKET = 2; // client batches commands
export const INTERP_DELAY = 0.1; // seconds remote entities are rendered in the past
export const MAX_REWIND = 0.5; // lag compensation cap (seconds)

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

// Hold-to-interact durations
export const SEARCH_TIME = 1.0; // search a container
export const ENGINE_START_TIME = 2.2; // start the car once every supply is installed

export const FLASHLIGHT_MAX = 100;
export const FLASHLIGHT_DRAIN = 0.55; // per second while on
export const FLASHLIGHT_RECHARGE = 0.35; // per second while off

// Day / night (seconds)
export const DAY_LENGTH = 240;
export const FIRST_DAY_LENGTH = 300;
export const NIGHT_LENGTH = 180;
export const DUSK_WARNING = 45; // horn: pick a spot and build a shelter
export const NIGHT_WAVES = 3; // each night's horde arrives in waves
export const WAVE_TIMES = [4, 62, 120]; // seconds into the night each wave starts
export const WAVE_SPREAD = 26; // a wave trickles in over this many seconds
export const HORDE_SPAWN_MIN = 58; // horde groups appear this far from the survivors (around wherever they are)
export const HORDE_SPAWN_MAX = 84;
export const BOSS_EVERY = 3;
export const ESCAPE_TIME = 90; // engine warm-up: the final stand at the car
export const ESCAPE_RADIUS = 14; // survivors this close to the car when the engine is ready escape
export const GAME_OVER_DELAY = 12;

// Networking / relevance
export const AOI_RADIUS = 115; // players, zombies, projectiles
export const AOI_ITEM_RADIUS = 55;
export const AOI_STRUCTURE_RADIUS = 160;
export const AOI_CACHE_RADIUS = 60; // searchable containers
export const LOD_NEAR = 45; // entities beyond this update every 2nd tick
export const MAX_ENTITIES = 16384;

// Slots (CS:GO style) - keys 1..5
export const SLOT_PRIMARY = 0;
export const SLOT_PISTOL = 1;
export const SLOT_MELEE = 2;
export const SLOT_THROW = 3;
export const SLOT_BUILD = 4;
export const NUM_SLOTS = 5;

export const INVENTORY_SIZE = 24;

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
};

export const PHASE = {
  WAITING: 0,
  DAY: 1,
  NIGHT: 2,
  GAMEOVER: 3,
  VICTORY: 4,
};
