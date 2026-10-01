// WebAudio engine. Every sound, ambience bed and the music is synthesised at runtime; a curated set of CC0 field
// recordings (samples.js: ambience beds, wildlife, footsteps, wood/fire foley, gunshots, zombie voices, bullet impacts)
// is layered on top once it has loaded, with the procedural sounds as the fallback for anything that is missing.
// Public API on the AudioEngine class below.
import { SOUND } from '../../shared/defs.js';
import { jobList, renderJob, DEF_BY_BANK } from './registry.js';
import { Music } from './music.js';
import { Ambience } from './ambience.js';
import { Recordings } from './samples.js';

const S = SOUND;
const EMPTY = Object.freeze({});
const MAX_POS_VOICES = 40;
const MAX_HRTF = 14;
const TICK_MS = 200;

// ------------------------------------------------------------------ positional categories
// ref/roll: inverse distance model; max: culled beyond; air: distance (m) constant of the air-absorption low-pass;
// wet: reverb send at the reference distance - the diffuse field falls off as (ref/d)^(0.45*roll), much slower than
// the direct sound, so distant sources get wetter; hrtf: use HRTF panning when closer than this; cap: max
// simultaneous voices of the category; delay: apply speed-of-sound delay for far sources.
const CATS = {
  gun: { ref: 7, max: 260, roll: 1.0, air: 60, wet: 0.27, hrtf: 30, cap: 16, delay: true },
  explosion: { ref: 12, max: 320, roll: 0.9, air: 90, wet: 0.27, hrtf: 35, cap: 6, delay: true },
  big: { ref: 6, max: 110, roll: 1.0, air: 45, wet: 0.2, hrtf: 30, cap: 6 },
  zombie: { ref: 2.2, max: 45, roll: 1.1, air: 28, wet: 0.16, hrtf: 18, cap: 16 },
  fx: { ref: 2, max: 36, roll: 1.2, air: 25, wet: 0.13, hrtf: 12, cap: 14 },
  fxfar: { ref: 4, max: 75, roll: 1.0, air: 35, wet: 0.16, hrtf: 18, cap: 8 },
  step: { ref: 1.5, max: 25, roll: 1.4, air: 20, wet: 0.065, hrtf: 8, cap: 10 },
};
for (const k in CATS) CATS[k].sendExp = 0.45 * CATS[k].roll;

// Recorded foley (samples.js) replacing - or with `layer`, adding to - a procedural sound. key, vol, pitch range;
// hits/gap: repeated strikes; layers: several recordings, each `at` seconds in. layer: true adds the sound's own
// procedural bank, a bank name adds that bank instead (at layerVol). far: a distant-perspective recording that
// takes over from the close one as a positional source gets further away (FAR_NEAR..FAR_FULL m).
const R_CHOP = { key: 'chop', vol: 1.9, pitch: [0.93, 1.07] };
const R_WOOD = { key: 'chop', vol: 1.6, pitch: [1.05, 1.2] };
const R_HAMMER = { key: 'hammer', vol: 2.8, pitch: [0.92, 1.08], hits: [2, 3], gap: [0.24, 0.38] };
const R_CAMPFIRE = { layers: [{ key: 'sticks', vol: 1.7, pitch: [0.9, 1.1], at: 0 }, { key: 'fire_ignite', vol: 0.9, pitch: [0.95, 1.05], at: 0.16 }] };
const R_IGNITE = { key: 'fire_ignite', vol: 0.9, pitch: [0.85, 1.0], layer: true };
const R_SWING = { key: 'swing', vol: 0.8, pitch: [0.9, 1.15], lp: 9000 };
const R_SWING_HEAVY = { key: 'swing', vol: 1.25, pitch: [0.78, 0.9], lp: 7000 };
const R_FLESH = { key: 'hit_flesh', vol: 1.2, pitch: [0.85, 1.05], layer: true };
// bullet impacts on flesh: in the world, and as the shooter's own quiet "that hit" confirmation (no tonal chime)
const R_BULLET_FLESH = { key: 'hit_bullet', vol: 0.5, pitch: [0.85, 1.05] };
const R_HEADSHOT = { key: 'hit_head', vol: 1.8, pitch: [0.92, 1.05] };
const R_HIT_CONFIRM = { key: 'hit_bullet', vol: 1.6, pitch: [0.8, 0.95], lp: 6500 };
const R_HEAD_CONFIRM = { key: 'hit_head', vol: 1.8, pitch: [0.9, 1.0], lp: 9000 };
// zombie voices (human performances, pitched down for a heavier, less human throat)
const R_Z_GROWL = { key: 'zv_growl', vol: 2, pitch: [0.8, 0.94] };
const R_Z_ATTACK = { key: 'zv_attack', vol: 2.6, pitch: [0.82, 0.95] };
const R_Z_PAIN = { key: 'zv_pain', vol: 2.8, pitch: [0.85, 0.98] };
const R_Z_DEATH = { key: 'zv_death', vol: 3, pitch: [0.8, 0.92] };
const R_Z_SCREAM = { key: 'zv_scream', vol: 2.3, pitch: [0.93, 1.05] };
const R_Z_ROAR = { key: 'zv_roar', vol: 1.4, pitch: [0.64, 0.72] };
const R_ZP_GROWL = { key: 'zv_growl', vol: 2, pitch: [0.88, 1.0] };
// Recorded gunshots (one take set per weapon, heard both first person and from other players). In first person the
// procedural "sweetener" (sub thump + tree-line echoes, no crack) is layered underneath for weight; from far away the
// real distant recordings take over. `fp`: the first-person variant of each def.
const gunRec = (key, pitch, farPitch, gain = 1) => {
  const far = { key: 'gun_far', vol: 1.0 * gain, pitch: farPitch };
  const remote = { key, vol: 1.15 * gain, pitch, far };
  remote.fp = { key, vol: 1.25 * gain, pitch, layer: 'gsw_' + key.slice(4), layerVol: 0.55 };
  return remote;
};
const R_GUN = {
  pistol: gunRec('gun_pistol', [0.97, 1.04], [1.05, 1.15], 0.6),
  shotgun: gunRec('gun_shotgun', [0.96, 1.03], [0.78, 0.86]),
  ak47: gunRec('gun_ak47', [0.97, 1.03], [0.92, 1.0]),
  rifle: gunRec('gun_rifle', [0.97, 1.02], [0.82, 0.9]),
  m4a1: gunRec('gun_m4a1', [0.98, 1.04], [0.98, 1.06]),
  mp5: gunRec('gun_mp5', [0.98, 1.05], [1.08, 1.18]),
  dbshotgun: gunRec('gun_dbshotgun', [0.9, 0.96], [0.74, 0.8]),
};
const FAR_NEAR = 35;
const FAR_FULL = 110;

// SOUND id -> { bank, cat ('2d' = always non-positional), vol, jit (rate jitter), send (2D reverb send), rec }
const SOUND_MAP = [];
function def(id, bank, cat, vol = 1, jit = 0.04, send = 0.15, rec = null) {
  if (id !== undefined) SOUND_MAP[id] = { bank, cat, vol, jit, send, rec };
}
def(S.PISTOL, 'gun_pistol', 'gun', 0.85, 0.04, 0.15, R_GUN.pistol);
def(S.SHOTGUN, 'gun_shotgun', 'gun', 0.9, 0.03, 0.15, R_GUN.shotgun);
def(S.AK47, 'gun_ak47', 'gun', 0.8, 0.035, 0.15, R_GUN.ak47);
def(S.RIFLE, 'gun_rifle', 'gun', 0.9, 0.03, 0.15, R_GUN.rifle);
def(S.M4A1, 'gun_m4a1', 'gun', 0.8, 0.035, 0.15, R_GUN.m4a1);
def(S.MP5, 'gun_mp5', 'gun', 0.75, 0.04, 0.15, R_GUN.mp5);
def(S.DB_SHOTGUN, 'gun_dbshotgun', 'gun', 0.95, 0.03, 0.15, R_GUN.dbshotgun);
def(S.MELEE_SWING, 'swing', 'fx', 0.55, 0.08, 0.15, R_SWING);
def(S.MELEE_HIT, 'flesh_heavy', 'fx', 0.85, 0.08, 0.15, R_FLESH);
def(S.ZOMBIE_GROWL, 'z_growl', 'zombie', 0.75, 0.1, 0.15, R_Z_GROWL);
def(S.ZOMBIE_ATTACK, 'z_attack', 'zombie', 0.9, 0.08, 0.15, R_Z_ATTACK);
def(S.ZOMBIE_DEATH, 'z_death', 'zombie', 0.9, 0.08, 0.15, R_Z_DEATH);
def(S.ZOMBIE_PAIN, 'z_pain', 'zombie', 0.8, 0.1, 0.15, R_Z_PAIN);
def(S.RUNNER_SCREAM, 'z_runner', 'zombie', 1, 0.07, 0.15, R_Z_SCREAM);
def(S.TANK_ROAR, 'z_tank', 'big', 1, 0.06, 0.15, R_Z_ROAR);
def(S.SPITTER_SPIT, 'z_spit', 'zombie', 0.9, 0.08);
def(S.LEAPER_SCREECH, 'z_leaper', 'zombie', 0.9, 0.08);
def(S.ROPER_SHOOT, 'z_roper', 'zombie', 0.9, 0.06);
def(S.BOOMER_GURGLE, 'z_boomer', 'zombie', 0.9, 0.08);
def(S.EXPLOSION, 'explosion', 'explosion', 1, 0.05);
def(S.BAT_SCREECH, 'z_bat', 'zombie', 0.7, 0.1);
def(S.BOSS_ROAR, 'z_boss', 'big', 1, 0.05);
def(S.ACID_SIZZLE, 'acid', 'fx', 0.7, 0.08);
def(S.FIRE_WHOOSH, 'fire_whoosh', 'fxfar', 0.9, 0.06, 0.15, R_IGNITE);
def(S.GLASS_BREAK, 'glass', 'fx', 0.8, 0.08);
def(S.WOOD_HIT, 'wood_hit', 'fx', 0.8, 0.08, 0.15, R_WOOD);
def(S.WOOD_BREAK, 'wood_break', 'fxfar', 1, 0.06);
def(S.METAL_HIT, 'metal_hit', 'fx', 0.75, 0.06);
def(S.BUILD, 'build', 'fx', 0.8, 0.05, 0.15, R_HAMMER);
def(S.PICKUP, 'pickup', 'fx', 0.5, 0.08);
def(S.CRAFT, 'craft', 'fx', 0.6, 0.05);
def(S.RELOAD, 'reload', 'fx', 0.55, 0.04);
def(S.DRY_FIRE, 'dry', 'fx', 0.55, 0.05);
def(S.PLAYER_HURT, 'hurt', 'fx', 0.8, 0.06);
def(S.PLAYER_DEATH, 'pdeath', 'fxfar', 1, 0.04);
def(S.HEAL, 'bandage', 'fx', 0.5, 0.05);
def(S.CAR_PART, 'car_part', 'fx', 0.9, 0.03);
def(S.HORDE_HORN, 'horde_horn', '2d', 0.8, 0, 0.35);
def(S.DAWN, 'dawn', '2d', 0.7, 0, 0.3);
def(S.PLANE, 'plane', '2d', 0.8, 0, 0.2);
def(S.CRATE_LAND, 'crate', 'fxfar', 1, 0.05);
def(S.CAMPFIRE_ADD, 'campfire_add', 'fx', 0.8, 0.06, 0.15, R_CAMPFIRE);
def(S.FLESH_HIT, 'flesh', 'fx', 0.75, 0.1, 0.15, R_BULLET_FLESH);
def(S.HEADSHOT, 'headshot_w', 'fx', 0.9, 0.08, 0.15, R_HEADSHOT);
def(S.ZPLAYER_GROWL, 'zp_growl', 'zombie', 0.9, 0.08, 0.15, R_ZP_GROWL);
def(S.THROW, 'throw', 'fx', 0.55, 0.08);
def(S.FOOTSTEP, 'step_dirt', 'step', 0.55, 0.08);
def(S.LEAP, 'leap', 'fx', 0.8, 0.08);
def(S.CAR_START, 'car_start', 'fxfar', 1, 0.02);
def(S.SLAM, 'slam', 'explosion', 1, 0.05);
def(S.SWITCH, 'switch', 'fx', 0.45, 0.06);
def(S.CHOP, 'wood_hit', 'fx', 0.9, 0.1, 0.15, R_CHOP);
def(S.SALVAGE, 'metal_hit', 'fx', 0.8, 0.1);
def(S.SEARCH, 'craft', 'fx', 0.4, 0.08);
def(S.PING, 'notify', 'fx', 0.6, 0.02);
def(S.ENGINE_CRANK, 'car_start', 'big', 1, 0.02);
def(S.REVIVE, 'bandage', 'fx', 0.7, 0.05);
def(S.DOWNED, 'hurt', 'fxfar', 1, 0.02);
def(S.FLARE_BURN, 'acid', 'fx', 0.45, 0.1);
def(S.CAT_MEOW, 'cat_meow', 'fx', 0.55, 0.06);

// playLocal(name): first-person / UI 2D sounds. bus: 'sfx' (world, muffled when dead) or 'ui' (always clear)
const LOCAL = {
  pistol: { bank: 'fp_pistol', vol: 0.95, jit: 0.03, send: 0.14, rec: R_GUN.pistol.fp },
  shotgun: { bank: 'fp_shotgun', vol: 1, jit: 0.025, send: 0.18, rec: R_GUN.shotgun.fp },
  ak47: { bank: 'fp_ak47', vol: 0.88, jit: 0.03, send: 0.13, rec: R_GUN.ak47.fp },
  rifle: { bank: 'fp_rifle', vol: 1, jit: 0.02, send: 0.2, rec: R_GUN.rifle.fp },
  m4a1: { bank: 'fp_m4a1', vol: 0.86, jit: 0.03, send: 0.13, rec: R_GUN.m4a1.fp },
  mp5: { bank: 'fp_mp5', vol: 0.8, jit: 0.035, send: 0.1, rec: R_GUN.mp5.fp },
  dbshotgun: { bank: 'fp_dbshotgun', vol: 1, jit: 0.025, send: 0.2, rec: R_GUN.dbshotgun.fp },
  reload_start: { bank: 'reload_start', vol: 0.55 },
  reload_end: { bank: 'reload_end', vol: 0.6 },
  shell_insert: { bank: 'shell_insert', vol: 0.55 },
  bolt: { bank: 'bolt', vol: 0.6 },
  pump: { bank: 'pump', vol: 0.7 },
  dry: { bank: 'dry', vol: 0.55 },
  swing: { bank: 'swing', vol: 0.5, jit: 0.08, rec: R_SWING },
  swing_heavy: { bank: 'swing_heavy', vol: 0.6, jit: 0.06, rec: R_SWING_HEAVY },
  hit: { bank: 'flesh_heavy', vol: 0.75, jit: 0.08, rec: R_FLESH },
  hit_wood: { bank: 'wood_hit', vol: 0.7, jit: 0.08, rec: R_WOOD },
  switch: { bank: 'switch', vol: 0.45 },
  pickup: { bank: 'pickup', vol: 0.5, jit: 0.06 },
  craft: { bank: 'craft', vol: 0.55 },
  build: { bank: 'build', vol: 0.65, rec: R_HAMMER },
  build_fail: { bank: 'build_fail', vol: 0.45, bus: 'ui' },
  hitmarker: { bank: 'flesh', vol: 0.1, bus: 'ui', jit: 0.06, send: 0, rec: R_HIT_CONFIRM },
  headshot: { bank: 'headshot_w', vol: 0.15, bus: 'ui', jit: 0.05, send: 0, rec: R_HEAD_CONFIRM },
  hurt: { bank: 'hurt', vol: 0.65, jit: 0.05, send: 0.05 },
  heal: { bank: 'heal', vol: 0.35, bus: 'ui', jit: 0, send: 0 },
  bandage: { bank: 'bandage', vol: 0.5 },
  ui_click: { bank: 'ui_click', vol: 0.35, bus: 'ui', jit: 0.02, send: 0 },
  ui_hover: { bank: 'ui_hover', vol: 0.12, bus: 'ui', jit: 0.03, send: 0 },
  heartbeat: { bank: 'heartbeat', vol: 0.8, bus: 'ui', jit: 0, send: 0 },
  jump: { bank: 'jump', vol: 0.35, jit: 0.06, send: 0.03 },
  land: { bank: 'land', vol: 0.45, jit: 0.08, send: 0.03 },
  flashlight: { bank: 'flashlight', vol: 0.4, jit: 0.03, send: 0 },
  breath: { bank: 'breath', vol: 0.45, jit: 0.04, send: 0.02 },
  throw: { bank: 'throw', vol: 0.5 },
  claw: { bank: 'claw', vol: 0.65, jit: 0.07 },
  zombie_player_growl: { bank: 'zp_growl', vol: 0.65, jit: 0.07, rec: R_ZP_GROWL },
  death: { bank: 'death_local', vol: 0.9, bus: 'ui', send: 0 },
  notify: { bank: 'notify', vol: 0.3, bus: 'ui', jit: 0.02, send: 0 },
  chat: { bank: 'chat', vol: 0.25, bus: 'ui', jit: 0.02, send: 0 },
  install_part: { bank: 'install_part', vol: 0.7 },
  campfire_add: { bank: 'campfire_add', vol: 0.6, rec: R_CAMPFIRE },
  eat: { bank: 'eat', vol: 0.5 },
};

// stinger(name): cinematic cues. bus 'music' follows the music volume, 'ui' is unaffected by the dead-muffle.
const STINGERS = {
  night: { bank: 'stg_night', vol: 0.9, bus: 'music', duck: 7 },
  dawn: { bank: 'stg_dawn', vol: 0.75, bus: 'music', duck: 6, birds: true },
  death: { bank: 'stg_death', vol: 0.85, bus: 'ui', duck: 5 },
  boss: { bank: 'stg_boss', vol: 1, bus: 'music', duck: 4.5 },
  victory: { bank: 'stg_victory', vol: 0.85, bus: 'music', duck: 8 },
  gameover: { bank: 'stg_gameover', vol: 0.85, bus: 'music', duck: 8 },
  supply: { bank: 'plane', vol: 0.75, bus: 'amb', duck: 0 },
  jumpscare: { bank: 'stg_jumpscare', vol: 0.85, bus: 'music', duck: 1.8 },
  join: { bank: 'stg_join', vol: 0.5, bus: 'music', duck: 0 },
  car_part: { bank: 'stg_car_part', vol: 0.75, bus: 'music', duck: 2 },
};

// createLoop(name) definitions. rec: recorded layers used instead of the procedural bank once loaded
// (key, vol relative to the loop's vol, optional lowpass / playback rate)
const LOOPS = {
  campfire: { bank: 'loop_campfire', ref: 2.5, max: 32, roll: 1.2, vol: 0.8, wet: 0.12, rec: [{ key: 'fire_roar', vol: 2 }, { key: 'fire_loop', vol: 2.2 }] },
  torch: { bank: 'loop_torch', ref: 1.2, max: 16, roll: 1.4, vol: 0.45, wet: 0.08, rec: [{ key: 'fire_roar', vol: 2.2, lp: 4500, rate: 1.1 }] },
  fire: { bank: 'loop_fire', ref: 3, max: 45, roll: 1.1, vol: 0.9, wet: 0.15, rec: [{ key: 'fire_roar', vol: 3 }, { key: 'fire_loop', vol: 2 }] },
  acid: { bank: 'loop_acid', ref: 1.5, max: 18, roll: 1.4, vol: 0.5, wet: 0.08 },
  zombie_idle: { bank: 'loop_zombie_idle', ref: 1.5, max: 22, roll: 1.3, vol: 0.55, wet: 0.12, cap: 10, jit: 0.14, rec: [{ key: 'zv_idle', vol: 0.9, rate: 0.9, lp: 7000 }] },
  boss_breath: { bank: 'loop_boss_breath', ref: 5, max: 70, roll: 1.0, vol: 0.9, wet: 0.2, cap: 3 },
  generator: { bank: 'loop_generator', ref: 2.5, max: 40, roll: 1.2, vol: 0.6, wet: 0.1 },
  // supply plane: heard from far off, duller with distance (air), never dropped by the loop cap
  plane: { bank: 'loop_plane', ref: 45, max: 950, roll: 1.0, vol: 1.1, wet: 0.25, air: true, always: true },
};
const LOOP_CAP_TOTAL = 28;

const STEP_BANKS = {
  dirt: 'step_dirt', grass: 'step_grass', wood: 'step_wood', water: 'step_water', metal: 'step_metal',
  forest: 'step_grass', leaves: 'step_grass', moss: 'step_grass', gravel: 'step_dirt', road: 'step_dirt', path: 'step_dirt', mud: 'step_dirt',
};
// surface -> recorded footsteps; STEP_TONE: [gain (matched to the procedural steps), lowpass Hz]
const STEP_REC = {
  dirt: 'fs_dirt', path: 'fs_dirt', road: 'fs_gravel', gravel: 'fs_gravel', grass: 'fs_grass', forest: 'fs_forest', moss: 'fs_forest',
  leaves: 'fs_leaves', mud: 'fs_mud', wood: 'fs_wood', water: 'fs_water',
};
const STEP_TONE = {
  fs_dirt: [1.8, 14000], fs_gravel: [1.9, 16000], fs_grass: [2.9, 13000], fs_forest: [2.6, 11000], fs_leaves: [2.9, 16000],
  fs_mud: [1.8, 10000], fs_wood: [2, 16000], fs_water: [1.9, 16000],
};
const dbJit = (db) => Math.pow(10, ((Math.random() * 2 - 1) * db) / 20);
const rrange = (r) => r[0] + (r[1] - r[0]) * Math.random();

const yieldNow = (() => {
  if (typeof MessageChannel !== 'undefined') {
    const ch = new MessageChannel();
    const q = [];
    ch.port1.onmessage = () => q.shift()?.();
    return () => new Promise((r) => {
      q.push(r);
      ch.port2.postMessage(0);
    });
  }
  return () => new Promise((r) => setTimeout(r, 0));
})();

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function setPannerPos(p, x, y, z) {
  if (p.positionX) {
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
  } else p.setPosition(x, y, z);
}

// ------------------------------------------------------------------ pooled positional voice
class Chan {
  constructor(e, dest, send) {
    const c = e._ctx;
    this.e = e;
    this.filter = c.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;
    this.filter.Q.value = 0.5;
    this.gain = c.createGain();
    this.panner = c.createPanner();
    this.panner.panningModel = 'equalpower';
    this.panner.distanceModel = 'inverse';
    this.panner.maxDistance = 10000;
    this.send = c.createGain();
    this.send.gain.value = 0;
    this.filter.connect(this.gain);
    this.gain.connect(this.panner);
    this.panner.connect(dest);
    this.gain.connect(this.send);
    this.send.connect(send);
    this.src = null;
    this.start = 0;
    this.end = 0;
    this.prio = 0;
    this.cat = '';
    this.hrtf = false; // counted against MAX_HRTF while playing
    this.model = 'equalpower'; // actual panner model
    this.onEnded = () => this.release();
  }
  effPrio(now) {
    const len = this.end - this.start;
    return this.prio * Math.max(0.1, (this.end - now) / (len > 0 ? len : 1));
  }
  release() {
    const s = this.src;
    if (!s) return;
    s.onended = null;
    try {
      s.disconnect();
    } catch {}
    this.src = null;
    if (this.hrtf) this.e._hrtfCount--;
    this.hrtf = false;
  }
  kill() {
    const s = this.src;
    if (!s) return;
    try {
      s.stop();
    } catch {}
    this.release();
  }
}

class VoicePool {
  constructor(e, size, dest, send) {
    this.chans = [];
    for (let i = 0; i < size; i++) this.chans.push(new Chan(e, dest, send));
  }
  acquire(prio, cat, cap, now) {
    let free = null;
    let weakest = null;
    let wp = Infinity;
    let catN = 0;
    let catWeak = null;
    let cwp = Infinity;
    const ch = this.chans;
    for (let i = 0; i < ch.length; i++) {
      const c = ch[i];
      if (!c.src || c.end + 0.5 < now) {
        if (c.src) c.kill();
        if (!free) free = c;
        continue;
      }
      const p = c.effPrio(now);
      if (c.cat === cat) {
        catN++;
        if (p < cwp) {
          cwp = p;
          catWeak = c;
        }
      }
      if (p < wp) {
        wp = p;
        weakest = c;
      }
    }
    if (catN >= cap) {
      if (catWeak && cwp < prio) {
        catWeak.kill();
        return catWeak;
      }
      return null;
    }
    if (free) return free;
    if (weakest && wp < prio) {
      weakest.kill();
      return weakest;
    }
    return null;
  }
}

// ------------------------------------------------------------------ looping positional emitter
class LoopEmitter {
  constructor(e, name, x, y, z) {
    this.e = e;
    this.name = name;
    this.def = LOOPS[name] || null;
    this.x = +x || 0;
    this.y = +y || 0;
    this.z = +z || 0;
    this.vol = 1;
    this.d = Infinity;
    this.active = false;
    this.stopped = false;
    this.rate = 1 + (Math.random() - 0.5) * 2 * (this.def?.jit ?? 0.04);
    this.pitch = 1; // setRate (doppler)
    this.variant = Math.floor(Math.random() * 8);
    this.srcs = [];
    this.extra = []; // per-layer gain / filter nodes of a recorded loop
    this.proc = false; // playing the procedural bank (upgraded to the recording once it loads)
    this.gain = null;
    this.fade = null;
    this.panner = null;
    this.sendG = null;
    this.air = null;
  }
  setPosition(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    if (this.active) setPannerPos(this.panner, x, y, z);
  }
  setVolume(v) {
    this.vol = v < 0 ? 0 : v;
    if (this.active) this.gain.gain.setTargetAtTime(this.vol * this.def.vol, this.e._ctx.currentTime, 0.05);
  }
  // playback-rate multiplier (doppler shift of a moving source)
  setRate(r) {
    this.pitch = r;
    if (!this.active) return;
    const now = this.e._ctx.currentTime;
    const recs = this.proc ? null : this.def.rec;
    for (let i = 0; i < this.srcs.length; i++) this.srcs[i].playbackRate.setTargetAtTime(this.rate * (recs?.[i]?.rate || 1) * r, now, 0.08);
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this._deactivate();
    this.e._loops.delete(this);
  }
  // recorded layers all decoded -> true; still decoding -> null (worth waiting for); unavailable -> false
  _recReady() {
    const r = this.def.rec;
    const rec = this.e._rec;
    if (!r || !rec) return false;
    let wait = false;
    for (const L of r) {
      if (rec.has(L.key)) continue;
      if (!rec.pending(L.key)) return false;
      rec.want(L.key);
      wait = true;
    }
    return wait ? null : true;
  }
  _activate(now) {
    const e = this.e;
    const c = e._ctx;
    const recReady = this._recReady();
    if (recReady === null) return true; // recording is decoding: stay silent a moment instead of flipping sources
    const pool = recReady ? null : e._pools.get(this.def.bank);
    if (!recReady && (!pool || !pool.length)) return false;
    this.gain = c.createGain();
    this.gain.gain.value = this.vol * this.def.vol;
    if (recReady) {
      for (const L of this.def.rec) {
        const buf = e._rec.get(L.key);
        const src = c.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.playbackRate.value = this.rate * (L.rate || 1) * this.pitch;
        const lg = c.createGain();
        lg.gain.value = L.vol;
        let head = lg;
        if (L.lp) {
          const f = c.createBiquadFilter();
          f.type = 'lowpass';
          f.frequency.value = L.lp;
          f.Q.value = 0.5;
          lg.connect(f);
          head = f;
          this.extra.push(f);
        }
        src.connect(lg);
        head.connect(this.gain);
        this.extra.push(lg);
        src.start(now, Math.random() * buf.duration);
        this.srcs.push(src);
      }
      this.proc = false;
    } else {
      const buf = pool[this.variant % pool.length];
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = this.rate * this.pitch;
      src.connect(this.gain);
      src.start(now, Math.random() * buf.duration);
      this.srcs.push(src);
      this.proc = true;
    }
    this.fade = c.createGain();
    this.fade.gain.value = 0;
    this.panner = c.createPanner();
    this.panner.panningModel = this.name === 'boss_breath' ? 'HRTF' : 'equalpower';
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = this.def.ref;
    this.panner.rolloffFactor = this.def.roll;
    this.panner.maxDistance = 10000;
    setPannerPos(this.panner, this.x, this.y, this.z);
    this.sendG = c.createGain();
    this.sendG.gain.value = this.def.wet;
    if (this.def.air) {
      this.air = c.createBiquadFilter();
      this.air.type = 'lowpass';
      this.air.Q.value = 0.5;
      this.air.frequency.value = this._airHz();
      this.gain.connect(this.air);
      this.air.connect(this.fade);
    } else this.gain.connect(this.fade);
    this.fade.connect(this.panner);
    this.panner.connect(e._sfxIn);
    this.fade.connect(this.sendG);
    this.sendG.connect(e._sfxSend);
    this.active = true;
    this._fadeTarget = -1;
    return true;
  }
  _deactivate() {
    if (!this.active) return;
    this.active = false;
    const now = this.e._ctx.currentTime;
    const nodes = [...this.srcs, ...this.extra, this.gain, this.fade, this.panner, this.sendG];
    if (this.air) nodes.push(this.air);
    this.fade.gain.setTargetAtTime(0, now, 0.06);
    for (const s of this.srcs) {
      try {
        s.stop(now + 0.35);
      } catch {}
    }
    this.srcs[0].onended = () => {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {}
      }
    };
    this.srcs = [];
    this.extra = [];
    this.gain = this.fade = this.panner = this.sendG = this.air = null;
  }
  // air absorption: distant sources lose their highs
  _airHz() {
    return Math.max(450, 16000 / (1 + this.d / 55));
  }
  _updateFade(now) {
    const m = this.def.max;
    const f = clamp01((m - this.d) / (m * 0.25));
    if (Math.abs(f - this._fadeTarget) > 0.02) {
      this._fadeTarget = f;
      this.fade.gain.setTargetAtTime(f, now, 0.15);
    }
    if (this.air) this.air.frequency.setTargetAtTime(this._airHz(), now, 0.2);
  }
}

// ------------------------------------------------------------------ proximity voice chat source
class VoiceSource {
  constructor(e, stream) {
    const c = e._ctx;
    this.e = e;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.vol = 1;
    this.dead = false;
    // Chrome quirk: a remote WebRTC stream only flows into WebAudio if it is also attached to a media element.
    try {
      this.el = new Audio();
      this.el.muted = true;
      this.el.srcObject = stream;
      const p = this.el.play();
      if (p && p.catch) p.catch(() => {});
    } catch {
      this.el = null;
    }
    this.src = c.createMediaStreamSource(stream);
    this.hp = c.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = 90;
    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 16000;
    this.gain = c.createGain();
    this.fade = c.createGain();
    this.panner = c.createPanner();
    this.panner.panningModel = 'HRTF';
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = 2;
    this.panner.rolloffFactor = 1;
    this.panner.maxDistance = 35;
    this.src.connect(this.hp);
    this.hp.connect(this.lp);
    this.lp.connect(this.gain);
    this.gain.connect(this.fade);
    this.fade.connect(this.panner);
    this.panner.connect(e._voiceIn);
    this._fade = -1;
    this.handle = {
      setPosition: (x, y, z) => this.setPosition(x, y, z),
      setVolume: (v) => this.setVolume(v),
      setMuffled: (b) => this.setMuffled(b),
      disconnect: () => this.disconnect(),
    };
  }
  setPosition(x, y, z) {
    if (this.dead) return;
    this.x = x;
    this.y = y;
    this.z = z;
    setPannerPos(this.panner, x, y, z);
    this.updateFade(this.e._ctx.currentTime);
  }
  updateFade(now) {
    const e = this.e;
    const dx = this.x - e._lx;
    const dy = this.y - e._ly;
    const dz = this.z - e._lz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // inaudible beyond ~35 m (the inverse model alone never reaches zero)
    const f = d <= 25 ? 1 : d >= 35 ? 0 : 1 - (d - 25) / 10;
    if (Math.abs(f - this._fade) > 0.01) {
      this._fade = f;
      this.fade.gain.setTargetAtTime(f, now, 0.08);
    }
  }
  setVolume(v) {
    if (this.dead) return;
    this.vol = v;
    this.gain.gain.setTargetAtTime(Math.max(0, v), this.e._ctx.currentTime, 0.05);
  }
  setMuffled(b) {
    if (this.dead) return;
    this.lp.frequency.setTargetAtTime(b ? 700 : 16000, this.e._ctx.currentTime, 0.06);
  }
  disconnect() {
    if (this.dead) return;
    this.dead = true;
    for (const n of [this.src, this.hp, this.lp, this.gain, this.fade, this.panner]) {
      try {
        n.disconnect();
      } catch {}
    }
    if (this.el) {
      try {
        this.el.pause();
        this.el.srcObject = null;
      } catch {}
      this.el = null;
    }
    this.e._voices.delete(this);
  }
}

const NULL_LOOP = Object.freeze({ setPosition() {}, setVolume() {}, setRate() {}, stop() {} });
const NULL_VOICE = Object.freeze({ setPosition() {}, setVolume() {}, setMuffled() {}, disconnect() {} });
const CALM_WIND = Object.freeze({ speed: 4, gust: 0.4, strength: 0.18 });

// ------------------------------------------------------------------ engine
export class AudioEngine {
  // opts.recordings: false = procedural sound only (never fetches the recordings)
  constructor(opts = EMPTY) {
    this._opts = opts || EMPTY;
    this._rec = null;
    this._ctx = null;
    this._ready = false;
    this._initPromise = null;
    this._banks = new Map(); // bank -> sparse array by variant index
    this._pools = new Map(); // bank -> compact array of loaded buffers
    this._lastVariant = new Map();
    this._waiters = new Map(); // bank -> callbacks waiting for the buffer
    this._loops = new Set();
    this._voices = new Set();
    this._lx = 0;
    this._ly = 0;
    this._lz = 0;
    this._lyaw = NaN;
    this._lpitch = NaN;
    this._state = {
      night: 0, horde: false, boss: false, danger: 0, lowHealth: 0, nearFire: 0, underCover: false, rain: 0, dead: false, menu: false,
      cycle: NaN, wind: NaN, gust: NaN, open: 0, indoor: 0,
    };
    this._vol = { master: 1, music: 1, sfx: 1, ambience: 1, voice: 1 };
    this._rateMul = 1;
    this._hrtfCount = 0;
    this._hbNext = 0;
    this._lastResume = 0;
    this._timer = null;
    this._loopScratch = [];
    this._mix = { world: -1, sfxLP: -1 };
    this._queue = null;
    this._foot = 1; // alternates the own footsteps a hair left / right
    this._gearT = 2; // steps until the next clothing rustle
    this._evictAt = 0;
  }

  get ready() {
    return this._ready;
  }
  get context() {
    return this._ctx;
  }
  // current ambience wind { speed m/s, gust 0..1, strength 0..1 } (e.g. for foliage sway that matches the sound)
  get wind() {
    return this._ambience ? this._ambience.wind : CALM_WIND;
  }

  init() {
    if (!this._initPromise) this._initPromise = this._init();
    return this._initPromise;
  }

  async _init() {
    // --- synchronous part: must run inside the user gesture
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) {
      console.warn('[audio] WebAudio not supported');
      return;
    }
    let c;
    try {
      c = new AC({ latencyHint: 'interactive' });
    } catch {
      c = new AC();
    }
    this._ctx = c;
    try {
      const p = c.resume();
      if (p && p.catch) p.catch(() => {});
    } catch {}
    const t0 = performance.now();
    this._buildGraph();
    this._applyVolumes(0);
    this._applyListener(true);
    this._rec = new Recordings(c, this._opts.recordings !== false);

    // --- asynchronous rendering (web workers, main-thread fallback)
    const { core, late } = jobList();
    this._queue = { jobs: core.slice(), late: late.slice(), workers: [], inflight: new Map(), seq: 0 };
    await this._renderJobs(true);
    this._music = new Music(this);
    this._ambience = new Ambience(this);
    this._ready = true;
    console.info(`[audio] ready in ${(performance.now() - t0).toFixed(0)}ms (${this._pools.size} banks, ${c.sampleRate}Hz, ${this._queue.workers.filter((r) => !r.dead).length} workers)`);
    // late / rarely needed sounds continue in the background
    this._renderJobs(false).then(() => {
      this._queue.finished = true;
      this._finishWorkers();
    });
    this._timer = setInterval(() => this._tick(), TICK_MS);
    this._applyStateNow();
    this._tick();
    // recordings stream in behind the procedural sound (beds crossfade over once decoded)
    const night = this._state.night > 0.5;
    this._rec.start([night ? 'amb_night' : 'amb_day', night ? 'amb_crickets' : 'amb_day_wind', 'wind_light', 'wind_mid', 'fs_grass', 'fs_dirt', 'gun_pistol', 'hit_bullet', 'zv_growl', 'zv_attack', 'zv_pain', 'zv_death', 'cloth', 'fs_wood', 'fire_roar', 'fire_loop']);
  }

  _buildGraph() {
    const c = this._ctx;
    const g = (v = 1) => {
      const n = c.createGain();
      n.gain.value = v;
      return n;
    };
    this._master = g(1);
    this._comp = c.createDynamicsCompressor();
    this._comp.threshold.value = -20;
    this._comp.knee.value = 12;
    this._comp.ratio.value = 3.5;
    this._comp.attack.value = 0.004;
    this._comp.release.value = 0.22;
    this._makeup = g(1.35);
    this._limit = c.createDynamicsCompressor();
    this._limit.threshold.value = -2.5;
    this._limit.knee.value = 0;
    this._limit.ratio.value = 20;
    this._limit.attack.value = 0.001;
    this._limit.release.value = 0.08;
    this._post = g(0.93); // the limiter adds a little make-up gain: keep the final ceiling below 0 dBFS
    this._pre = g(1);
    this._pre.connect(this._master);
    this._master.connect(this._comp);
    this._comp.connect(this._makeup);
    this._makeup.connect(this._limit);
    this._limit.connect(this._post);
    this._post.connect(c.destination);

    // world bus: sfx + ambience + reverb, muffled when dead
    this._worldIn = g(1);
    this._worldLP = c.createBiquadFilter();
    this._worldLP.type = 'lowpass';
    this._worldLP.frequency.value = 20000;
    this._worldLP.Q.value = 0.6;
    this._worldIn.connect(this._worldLP);
    this._worldLP.connect(this._pre);

    this._sfxIn = g(1); // user sfx volume
    this._sfxLP = c.createBiquadFilter(); // low-health muffle
    this._sfxLP.type = 'lowpass';
    this._sfxLP.frequency.value = 20000;
    this._sfxLP.Q.value = 0.5;
    this._sfxIn.connect(this._sfxLP);
    this._sfxLP.connect(this._worldIn);
    this._ambIn = g(1);
    this._ambIn.connect(this._worldIn);
    this._uiIn = g(1);
    this._uiIn.connect(this._pre);
    this._musicIn = g(1);
    this._musicIn.connect(this._pre);
    this._voiceIn = g(1);
    this._voiceIn.connect(this._pre);

    // shared reverb: forest by default, crossfading to an open-field or a small-room response (buffers assigned when
    // their IRs are rendered); convolvers that have been silent for a while are disconnected to save CPU
    this._revIn = g(1);
    this._revIn.channelCount = 1;
    this._revIn.channelCountMode = 'explicit';
    this._conv = c.createConvolver();
    this._revOut = g(0.9);
    this._envs = {};
    for (const name of ['forest', 'open', 'room']) {
      const conv = name === 'forest' ? this._conv : c.createConvolver();
      const gain = g(name === 'forest' ? 1 : 0);
      gain.connect(conv);
      conv.connect(this._revOut);
      if (name === 'forest') this._revIn.connect(gain);
      this._envs[name] = { conv, gain, on: name === 'forest', w: name === 'forest' ? 1 : 0, zeroAt: 0 };
    }
    this._revOut.connect(this._worldIn);
    this._sfxSend = g(1);
    this._sfxSend.connect(this._revIn);
    this._ambSend = g(1);
    this._ambSend.connect(this._revIn);

    this._pool = new VoicePool(this, MAX_POS_VOICES, this._sfxIn, this._sfxSend);
    // pre-warm the HRTF database (Chrome loads it asynchronously on first use)
    const warm = this._pool.chans[0];
    warm.panner.panningModel = 'HRTF';
    warm.model = 'HRTF';
  }

  // ---------------------------------------------------------------- rendering
  _store(bank, i, chans, sr) {
    const c = this._ctx;
    const buf = c.createBuffer(chans.length, chans[0].length, sr);
    for (let k = 0; k < chans.length; k++) {
      if (buf.copyToChannel) buf.copyToChannel(chans[k], k);
      else buf.getChannelData(k).set(chans[k]);
    }
    if (bank === 'ir_forest' || bank === 'ir_open' || bank === 'ir_room') {
      this._envs[bank.slice(3)].conv.buffer = buf;
      return;
    }
    if (bank === 'ir_hall') {
      this._hallIR = buf;
      if (this._music) this._music.setIR(buf);
      return;
    }
    let arr = this._banks.get(bank);
    if (!arr) {
      arr = [];
      this._banks.set(bank, arr);
      this._pools.set(bank, []);
    }
    arr[i] = buf;
    this._pools.get(bank).push(buf);
    const w = this._waiters.get(bank);
    if (w) {
      this._waiters.delete(bank);
      for (const fn of w) {
        try {
          fn();
        } catch (err) {
          console.warn('[audio]', err);
        }
      }
    }
  }

  _spawnWorkers() {
    const q = this._queue;
    if (q.triedWorkers) return;
    q.triedWorkers = true;
    if (typeof Worker === 'undefined') return;
    const n = Math.max(1, Math.min(4, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4) - 1));
    for (let k = 0; k < n; k++) {
      let w;
      try {
        w = new Worker(new URL('./synth-worker.js', import.meta.url), { type: 'module' });
      } catch {
        break;
      }
      const rec = { w, busy: 0, dead: false };
      w.onmessage = (ev) => this._onWorkerMsg(rec, ev.data);
      w.onerror = (ev) => {
        if (ev && ev.preventDefault) ev.preventDefault();
        this._killWorker(rec, 'error ' + (ev && ev.message));
      };
      q.workers.push(rec);
    }
  }

  _killWorker(rec, why) {
    if (rec.dead) return;
    rec.dead = true;
    try {
      rec.w.terminate();
    } catch {}
    console.warn('[audio] synth worker failed, falling back to main thread:', why);
    const q = this._queue;
    // requeue its in-flight jobs
    for (const [id, job] of q.inflight) {
      if (job.rec === rec) {
        q.inflight.delete(id);
        q.jobs.unshift(job);
      }
    }
    this._pump();
  }

  _onWorkerMsg(rec, msg) {
    const q = this._queue;
    const job = q.inflight.get(msg.id);
    if (!job) return;
    q.inflight.delete(msg.id);
    rec.busy--;
    rec.ok = true;
    if (msg.error) console.warn('[audio] render failed', job.bank, msg.error);
    else {
      try {
        this._store(job.bank, job.i, msg.chans, msg.sr);
      } catch (err) {
        console.warn('[audio] buffer creation failed', job.bank, err);
      }
    }
    this._pump();
  }

  _pump() {
    const q = this._queue;
    const live = q.workers.filter((r) => !r.dead);
    if (!live.length) {
      if (!q.mainLoop && q.jobs.length) this._mainThreadLoop();
      this._checkDone();
      return;
    }
    for (const rec of live) {
      while (rec.busy < 2 && q.jobs.length) {
        const job = q.jobs.shift();
        const id = ++q.seq;
        job.rec = rec;
        q.inflight.set(id, job);
        rec.busy++;
        rec.w.postMessage({ id, bank: job.bank, i: job.i, ctxRate: this._ctx.sampleRate });
      }
    }
    this._checkDone();
  }

  async _mainThreadLoop() {
    const q = this._queue;
    q.mainLoop = true;
    let last = performance.now();
    while (q.jobs.length) {
      const job = q.jobs.shift();
      try {
        const r = renderJob(job.bank, job.i, this._ctx.sampleRate);
        this._store(job.bank, job.i, r.chans, r.sr);
      } catch (err) {
        console.warn('[audio] render failed', job.bank, err);
      }
      if (performance.now() - last > 12) {
        await yieldNow();
        last = performance.now();
      }
    }
    q.mainLoop = false;
    this._checkDone();
  }

  _checkDone() {
    const q = this._queue;
    if (q.done && !q.jobs.length && !q.inflight.size && !q.mainLoop) {
      const d = q.done;
      q.done = null;
      d();
    }
  }

  // render the current job list (core first; `late` moves the background list in)
  _renderJobs(core) {
    const q = this._queue;
    if (!core) {
      q.jobs.push(...q.late);
      q.late = [];
    }
    return new Promise((resolve) => {
      q.done = resolve;
      this._spawnWorkers();
      // watchdog: if workers never answer (e.g. module workers unsupported), fall back to the main thread
      if (core && q.workers.length) {
        setTimeout(() => {
          if (q.done === resolve && !q.workers.some((r) => r.ok)) {
            for (const r of q.workers) this._killWorker(r, 'timeout');
          }
        }, 4000);
      }
      this._pump();
    });
  }

  _finishWorkers() {
    for (const r of this._queue.workers) {
      if (!r.dead) {
        r.dead = true;
        try {
          r.w.terminate();
        } catch {}
      }
    }
  }

  // make sure a bank gets rendered soon; cb runs when available (immediately if already loaded)
  _need(bank, cb) {
    if (this._pools.get(bank)?.length) {
      if (cb) cb();
      return;
    }
    if (cb) {
      let w = this._waiters.get(bank);
      if (!w) this._waiters.set(bank, (w = []));
      w.push(cb);
    }
    const q = this._queue;
    if (!q) return;
    const move = (list) => {
      for (let k = list.length - 1; k >= 0; k--) {
        if (list[k].bank === bank) {
          const [j] = list.splice(k, 1);
          q.jobs.unshift(j);
        }
      }
    };
    move(q.jobs);
    move(q.late);
    if (!q.finished && q.done && q.jobs.length) this._pump();
    else if (q.finished && q.jobs.length) {
      // background rendering already finished: render synchronously (rare)
      const jobs = q.jobs.splice(0);
      for (const j of jobs) {
        try {
          const r = renderJob(j.bank, j.i, this._ctx.sampleRate);
          this._store(j.bank, j.i, r.chans, r.sr);
        } catch {}
      }
    }
  }

  _pick(bank, variant) {
    const arr = this._banks.get(bank);
    if (!arr) return null;
    if (variant !== undefined && variant !== null && arr.length) {
      const b = arr[((variant | 0) % arr.length + arr.length) % arr.length];
      if (b) return b;
    }
    const pool = this._pools.get(bank);
    if (!pool.length) return null;
    if (pool.length === 1) return pool[0];
    // avoid immediate repeats
    const last = this._lastVariant.get(bank);
    let k = Math.floor(Math.random() * pool.length);
    if (k === last) k = (k + 1 + Math.floor(Math.random() * (pool.length - 1))) % pool.length;
    this._lastVariant.set(bank, k);
    return pool[k];
  }

  _resume() {
    const c = this._ctx;
    if (c && c.state !== 'running') {
      const t = performance.now();
      if (t - this._lastResume > 1000) {
        this._lastResume = t;
        try {
          const p = c.resume();
          if (p && p.catch) p.catch(() => {});
        } catch {}
      }
    }
  }

  // ---------------------------------------------------------------- listener
  setListener(x, y, z, yaw, pitch) {
    if (x === this._lx && y === this._ly && z === this._lz && yaw === this._lyaw && pitch === this._lpitch) return;
    this._lx = +x || 0;
    this._ly = +y || 0;
    this._lz = +z || 0;
    this._lyaw = +yaw || 0;
    this._lpitch = +pitch || 0;
    if (this._ctx) this._applyListener(false);
  }

  _applyListener() {
    const L = this._ctx.listener;
    const yaw = this._lyaw || 0;
    const pitch = this._lpitch || 0;
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    const sp = Math.sin(pitch);
    const cp = Math.cos(pitch);
    const fx = -sy * cp;
    const fy = sp;
    const fz = -cy * cp;
    // up vector orthogonal to forward (stays valid when looking straight up/down)
    const ux = -sy * -sp;
    const uy = cp;
    const uz = -cy * -sp;
    if (L.positionX) {
      L.positionX.value = this._lx;
      L.positionY.value = this._ly;
      L.positionZ.value = this._lz;
      L.forwardX.value = fx;
      L.forwardY.value = fy;
      L.forwardZ.value = fz;
      L.upX.value = ux;
      L.upY.value = uy;
      L.upZ.value = uz;
    } else {
      L.setPosition(this._lx, this._ly, this._lz);
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  // ---------------------------------------------------------------- one-shots
  play(soundId, opts = EMPTY) {
    if (!this._ready) return;
    const d = SOUND_MAP[soundId];
    if (!d) return;
    const o = opts || EMPTY;
    const pos = !(d.cat === '2d' || o.x === undefined || o.x === null);
    let bank = d.bank;
    let lv = 1;
    if (d.rec && this._playRec(d.rec, pos ? d.cat : null, pos ? +o.x : 0, pos ? +(o.y ?? this._ly) : 0, pos ? +(o.z ?? 0) : 0, (o.volume ?? 1) * d.vol, this._sfxIn, d.send)) {
      if (!d.rec.layer) return;
      if (d.rec.layer !== true) bank = d.rec.layer;
      lv = d.rec.layerVol ?? 1;
    }
    const buf = this._pick(bank, o.variant);
    if (!buf) {
      this._need(bank);
      return;
    }
    this._resume();
    const vol = (o.volume ?? 1) * d.vol * lv * (0.92 + Math.random() * 0.16);
    const rate = (o.rate ?? 1) * (1 + (Math.random() - 0.5) * 2 * d.jit) * this._rateMul;
    if (!pos) {
      this._play2D(buf, vol, rate, this._sfxIn, d.send, 0);
      return;
    }
    this._playPos(buf, d.cat, +o.x, +(o.y ?? this._ly), +(o.z ?? 0), vol, rate);
  }

  playLocal(name, opts = EMPTY) {
    if (!this._ready) return;
    const d = LOCAL[name];
    if (!d) return;
    const o = opts || EMPTY;
    const ui = d.bus === 'ui';
    const dest = ui ? this._uiIn : this._sfxIn;
    let bank = d.bank;
    let lv = 1;
    if (d.rec && this._playRec(d.rec, null, 0, 0, 0, (o.volume ?? 1) * d.vol, dest, d.send ?? 0.06)) {
      if (!d.rec.layer) return;
      if (d.rec.layer !== true) bank = d.rec.layer;
      lv = d.rec.layerVol ?? 1;
    }
    const buf = this._pick(bank, o.variant);
    if (!buf) {
      this._need(bank);
      return;
    }
    this._resume();
    const jit = d.jit ?? 0.04;
    const vol = (o.volume ?? 1) * d.vol * lv * (ui ? 1 : 0.94 + Math.random() * 0.12);
    const rate = (o.rate ?? 1) * (1 + (Math.random() - 0.5) * 2 * jit) * (ui ? 1 : this._rateMul);
    this._play2D(buf, vol, rate, dest, d.send ?? 0.06, 0);
  }

  // recorded foley (R_* defs): every layer must be decoded, otherwise false and the caller plays the procedural bank.
  // cat = positional category or null for 2D.
  _playRec(r, cat, x, y, z, vol, dest, send) {
    const rec = this._rec;
    if (!rec) return false;
    const layers = r.layers || null;
    if (layers) {
      for (const L of layers) if (!rec.has(L.key)) return false;
    } else if (!rec.has(r.key)) return false;
    this._resume();
    const now = this._ctx.currentTime;
    // distant perspective: equal-power crossfade from the close recording to the far one with distance
    let near = 1;
    const F = cat && r.far;
    if (F && rec.has(F.key)) {
      const dx = x - this._lx;
      const dy = y - this._ly;
      const dz = z - this._lz;
      const k = clamp01((Math.sqrt(dx * dx + dy * dy + dz * dz) - FAR_NEAR) / (FAR_FULL - FAR_NEAR));
      if (k > 0) {
        const fb = rec.get(F.key);
        const [off, dur] = rec.pick(F.key, fb);
        this._playPos(fb, cat, x, y, z, vol * F.vol * Math.sqrt(k) * dbJit(1.5), rrange(F.pitch) * this._rateMul, off, dur);
        near = Math.sqrt(1 - k);
        if (near < 0.05) return true;
      }
    }
    const n = layers ? layers.length : 1;
    for (let i = 0; i < n; i++) {
      const L = layers ? layers[i] : r;
      const buf = rec.get(L.key);
      let t = L.at || 0;
      const hits = L.hits ? Math.round(rrange(L.hits)) : 1;
      for (let h = 0; h < hits; h++) {
        const [off, dur] = rec.pick(L.key, buf);
        const rate = rrange(L.pitch) * this._rateMul;
        const v = vol * near * L.vol * dbJit(1.5);
        if (cat) this._playPos(buf, cat, x, y, z, v, rate, off, dur, t, L.lp);
        else this._play2D(buf, v, rate, dest, send, now + t, off, dur, L.lp);
        if (L.gap) t += rrange(L.gap);
      }
    }
    return true;
  }

  // surface: 'dirt' | 'grass' | 'forest' | 'leaves' | 'gravel' | 'road' | 'mud' | 'wood' | 'water' | 'metal'.
  // x undefined = the local player's own feet (2D). opts (optional): { crouch, run, heavy }; for the local player
  // crouch / run are otherwise inferred from the volume the game passes (0.25 crouch, 0.8 sprint).
  footstep(surface, x, y, z, volume = 1, opts = EMPTY) {
    if (!this._ready) return;
    const local = x === undefined || x === null;
    const key = STEP_REC[surface];
    const rec = key && this._rec && this._rec.has(key) ? this._rec.get(key) : null;
    if (!rec) {
      const buf = this._pick(STEP_BANKS[surface] || 'step_dirt');
      if (!buf) return;
      const vol = (volume ?? 1) * (0.88 + Math.random() * 0.24);
      const rate = (1 + (Math.random() - 0.5) * 0.14) * this._rateMul;
      if (local) {
        this._resume();
        this._play2D(buf, vol * 0.32, rate, this._sfxIn, 0.03, 0);
        return;
      }
      this._playPos(buf, 'step', +x, +(y ?? this._ly), +(z ?? 0), vol * 0.6, rate);
      return;
    }
    const o = opts || EMPTY;
    const v = volume ?? 1;
    const crouch = o.crouch ?? v <= 0.3;
    const run = o.run ?? (local ? v >= 0.75 : v >= 0.95);
    const tone = STEP_TONE[key];
    const [off, dur] = this._rec.pick(key, rec);
    const rate = (o.heavy ? 0.8 : 1) * (run ? 1.04 : crouch ? 0.96 : 1) * (0.94 + Math.random() * 0.12) * this._rateMul;
    const g = v * tone[0] * dbJit(2);
    const lp = crouch ? tone[1] * 0.7 : run ? 20000 : tone[1];
    if (!local) {
      this._playPos(rec, 'step', +x, +(y ?? this._ly), +(z ?? 0), g * 0.6, rate, off, dur, 0, lp);
      return;
    }
    this._resume();
    const now = this._ctx.currentTime;
    this._foot = -this._foot;
    // x1.41: a mono source through a StereoPanner loses 3 dB per ear at centre
    this._play2D(rec, g * 0.45, rate, this._sfxIn, run ? 0.05 : 0.03, now, off, dur, lp, this._foot * (0.04 + Math.random() * 0.06));
    // clothing / gear rustle every few steps (more often when running)
    if (--this._gearT <= 0 && this._rec.has('cloth')) {
      this._gearT = run ? 1 + Math.random() * 2 : 3 + Math.random() * 4;
      const cb = this._rec.get('cloth');
      const [co, cd] = this._rec.pick('cloth', cb);
      const cv = v * 0.32 * (run ? 0.3 : 0.22) * (crouch ? 0.6 : 1);
      this._play2D(cb, cv * dbJit(2), 0.95 + Math.random() * 0.15, this._sfxIn, 0.02, now + 0.05, co, Math.min(cd, 0.4), 12000, 0, 0.1);
    }
  }

  // one-shot through its own short-lived nodes. Optional: [off, dur] slice, lowpass, stereo pan, fade-out (s).
  _play2D(buf, vol, rate, dest, send, when, off = 0, dur = 0, lp = 0, pan = 0, fade = 0) {
    const c = this._ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    let head = src;
    let f = null;
    if (lp && lp < 18000) {
      f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      f.Q.value = 0.5;
      src.connect(f);
      head = f;
    }
    const g = c.createGain();
    g.gain.value = vol;
    head.connect(g);
    let p = null;
    if (pan && c.createStereoPanner) {
      p = c.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(dest);
    } else g.connect(dest);
    let sg = null;
    if (send > 0 && dest !== this._uiIn) {
      sg = c.createGain();
      sg.gain.value = send;
      g.connect(sg);
      sg.connect(dest === this._ambIn ? this._ambSend : this._sfxSend);
    }
    src.onended = () => {
      src.disconnect();
      if (f) f.disconnect();
      g.disconnect();
      if (p) p.disconnect();
      if (sg) sg.disconnect();
    };
    if (dur > 0) {
      const t = Math.max(when || 0, c.currentTime);
      if (fade > 0) {
        const end = t + dur / rate;
        g.gain.setValueAtTime(vol, Math.max(t, end - fade));
        g.gain.linearRampToValueAtTime(0, end);
      }
      src.start(t, off, dur);
    } else src.start(when || 0);
    return src;
  }

  // positional one-shot on a pooled voice. Optional: [off, dur] slice, extra start delay (s), lowpass.
  _playPos(buf, catName, x, y, z, vol, rate, off = 0, dur = 0, when = 0, lp = 0) {
    const cat = CATS[catName];
    const dx = x - this._lx;
    const dy = y - this._ly;
    const dz = z - this._lz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(d <= cat.max)) return; // also rejects NaN
    const att = cat.ref / (cat.ref + cat.roll * (Math.max(d, cat.ref) - cat.ref));
    const prio = vol * att;
    if (prio < 0.002) return;
    const now = this._ctx.currentTime;
    const ch = this._pool.acquire(prio, catName, cat.cap, now);
    if (!ch) return;
    const p = ch.panner;
    const wantHrtf = d < cat.hrtf && this._hrtfCount < MAX_HRTF;
    const model = wantHrtf ? 'HRTF' : 'equalpower';
    if (ch.model !== model) {
      p.panningModel = model;
      ch.model = model;
    }
    if (wantHrtf) this._hrtfCount++;
    ch.hrtf = wantHrtf;
    p.refDistance = cat.ref;
    p.rolloffFactor = cat.roll;
    setPannerPos(p, x, y, z);
    let fc = 350 + 19650 * Math.exp(-d / cat.air);
    if (lp && lp < fc) fc = lp;
    ch.filter.frequency.value = fc > 18000 ? 20000 : fc;
    ch.gain.gain.value = vol;
    ch.send.gain.value = cat.wet * Math.pow(cat.ref / Math.max(d, cat.ref), cat.sendExp);
    const src = this._ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.connect(ch.filter);
    src.onended = ch.onEnded;
    const delay = cat.delay && d > 20 ? d / 343 : 0;
    const t = now + delay + when;
    if (dur > 0) src.start(t, off, dur);
    else src.start(t);
    ch.src = src;
    ch.start = t;
    ch.end = t + (dur > 0 ? dur : buf.duration) / rate;
    ch.prio = prio;
    ch.cat = catName;
  }

  // ---------------------------------------------------------------- loops
  createLoop(name, x, y, z) {
    if (!LOOPS[name]) return NULL_LOOP;
    const l = new LoopEmitter(this, name, x, y, z);
    this._loops.add(l); // activated (by distance / caps) on the next engine tick
    return l;
  }

  _updateLoops(now) {
    const list = this._loopScratch;
    list.length = 0;
    for (const l of this._loops) {
      const dx = l.x - this._lx;
      const dy = l.y - this._ly;
      const dz = l.z - this._lz;
      l.d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      l._want = l.d < l.def.max * (l.active ? 1.05 : 0.97) && l.vol > 0;
      list.push(l);
    }
    list.sort((a, b) => a.d - b.d);
    const counts = {};
    let total = 0;
    const rec = this._rec;
    for (const l of list) {
      if (l.active && l.def.rec) {
        // a procedural loop hands over to its recording once decoded; a recorded one keeps its buffers in use
        if (l.proc) {
          if (l._recReady()) l._deactivate();
        } else for (const L of l.def.rec) rec.get(L.key);
      }
      if (l._want) {
        const cap = l.def.cap ?? 99;
        const n = counts[l.name] || 0;
        if (!l.def.always && (n >= cap || total >= LOOP_CAP_TOTAL)) l._want = false;
        else {
          counts[l.name] = n + 1;
          total++;
        }
      }
      if (l._want && !l.active) {
        if (!l._activate(now)) this._need(l.def.bank);
      } else if (!l._want && l.active) l._deactivate();
      if (l.active) l._updateFade(now);
    }
  }

  // ---------------------------------------------------------------- ambience / state
  // state: { night 0..1, horde, boss, danger 0..1, lowHealth 0..1, nearFire 0..1, underCover, dead, menu } plus
  // optional extras: cycle (the renderer's day cycle 0..1: day 0.055-0.485, night 0.5-0.99; gives real dawn / dusk
  // windows), wind (the weather's: 0.3 breeze .. ~1.2 gale) and gust 0..1 (to match visible wind; otherwise the engine wanders its own, readable via
  // `audio.wind`), open 0..1 (clearing / road: open-field reverb), indoor 0..1 (inside a building: room reverb and
  // muffled outdoor beds, like underCover).
  setAmbience(state) {
    if (!state) return;
    const s = this._state;
    const dead = !!state.dead;
    const menu = !!state.menu;
    const changed = dead !== s.dead || menu !== s.menu;
    s.night = clamp01(+state.night || 0);
    s.horde = !!state.horde;
    s.boss = !!state.boss;
    s.danger = clamp01(+state.danger || 0);
    s.lowHealth = clamp01(+state.lowHealth || 0);
    s.nearFire = clamp01(+state.nearFire || 0);
    s.underCover = !!state.underCover;
    s.rain = clamp01(+state.rain || 0);
    s.dead = dead;
    s.menu = menu;
    // optional extras (see the setAmbience doc comment)
    const cy = state.cycle == null ? NaN : +state.cycle;
    s.cycle = cy === cy && Number.isFinite(cy) ? cy - Math.floor(cy) : NaN;
    const wv = state.wind == null ? NaN : +state.wind;
    s.wind = wv === wv ? Math.max(0, Math.min(1.3, wv)) : NaN;
    const gv = state.gust == null ? NaN : +state.gust;
    s.gust = gv === gv ? clamp01(gv) : NaN;
    s.open = clamp01(+state.open || 0);
    s.indoor = clamp01(+state.indoor || 0);
    if (changed && this._ready) this._applyStateNow();
  }

  // thunder for a lightning strike at world (x, z), `dist` m away: it rolls in `delay` s after the flash
  thunder(x, z, dist, delay) {
    if (!this._ready) return;
    this._ambience?.thunder(x, z, dist, delay);
  }

  _applyStateNow() {
    const s = this._state;
    const now = this._ctx.currentTime;
    this._rateMul = s.dead ? 0.92 : 1;
    const wf = s.dead ? 600 : 20000;
    if (wf !== this._mix.world) {
      this._mix.world = wf;
      this._worldLP.frequency.setTargetAtTime(wf, now, s.dead ? 0.25 : 0.7);
    }
    this._music?.stateChanged(now, s);
    this._ambience?.stateChanged(now, s);
  }

  _tick() {
    if (!this._ready) return;
    const c = this._ctx;
    this._resume();
    const now = c.currentTime;
    const s = this._state;
    // low health: sfx muffle + heartbeat
    const lh = s.dead || s.menu ? 0 : s.lowHealth;
    const lpf = lh > 0.02 ? Math.round(20000 * Math.pow(2600 / 20000, lh)) : 20000;
    if (Math.abs(lpf - this._mix.sfxLP) > 50) {
      this._mix.sfxLP = lpf;
      this._sfxLP.frequency.setTargetAtTime(lpf, now, 0.4);
    }
    // fear: a faint, slightly quick pulse when zombies are close in the dark (low health overrides it)
    const fear = s.dead || s.menu || !this._ambience ? 0 : this._ambience.fear * (0.3 + 0.7 * s.night);
    if (lh > 0.12 || fear > 0.06) {
      const hurt = lh > 0.12;
      const period = hurt ? 60 / (60 + 70 * lh) : 60 / (74 + 24 * fear);
      if (this._hbNext < now) this._hbNext = now + 0.05;
      const hb = this._pick('heartbeat');
      while (hb && this._hbNext < now + 0.45) {
        this._play2D(hb, hurt ? 0.2 + 0.65 * lh : 0.02 + 0.07 * fear, 1, this._uiIn, 0, this._hbNext);
        this._hbNext += period;
      }
    } else this._hbNext = 0;
    try {
      this._ambience.tick(now, s);
      this._music.tick(now, s);
    } catch (err) {
      console.warn('[audio] tick', err);
    }
    this._updateLoops(now);
    for (const v of this._voices) v.updateFade(now);
    this._updateReverb(now);
    if (now - this._evictAt > 10) {
      this._evictAt = now;
      this._rec.evict(now);
    }
  }

  // reverb environment weights (equal power): room when under cover / indoors, open field when `open`, else forest
  _updateReverb(now) {
    const s = this._state;
    const E = this._envs;
    const room = E.room.conv.buffer ? Math.max(s.underCover ? 1 : 0, s.indoor) : 0;
    const open = E.open.conv.buffer ? s.open * (1 - room) : 0;
    const forest = 1 - room - open;
    for (const name in E) {
      const e = E[name];
      let w = Math.sqrt(Math.max(0, name === 'room' ? room : name === 'open' ? open : forest));
      if (w < 0.03) w = 0;
      if (w > 0 && !e.on) {
        e.gain.gain.cancelScheduledValues(now);
        e.gain.gain.setValueAtTime(0, now);
        this._revIn.connect(e.gain);
        e.on = true;
      }
      if (w === 0) {
        if (!e.zeroAt) e.zeroAt = now;
        if (e.on && now - e.zeroAt > 4) {
          this._revIn.disconnect(e.gain);
          e.on = false;
        }
      } else e.zeroAt = 0;
      if (Math.abs(w - e.w) < 0.01) continue;
      e.w = w;
      e.gain.gain.setTargetAtTime(w, now, 0.4);
    }
  }

  // ---------------------------------------------------------------- stingers / mix
  stinger(name) {
    if (!this._ready) return;
    const d = STINGERS[name];
    if (!d) return;
    this._resume();
    const requested = this._ctx.currentTime;
    const go = () => {
      // skip if it arrives too late to still make sense
      if (this._ctx.currentTime - requested > 2.5) return;
      const buf = this._pick(d.bank);
      if (!buf) return;
      const dest = d.bus === 'music' ? this._musicIn : d.bus === 'ui' ? this._uiIn : d.bus === 'amb' ? this._ambIn : this._sfxIn;
      this._play2D(buf, d.vol, 1, dest, d.bus === 'amb' ? 0.2 : 0, 0);
      if (d.duck) this._music?.duck(this._ctx.currentTime, d.duck);
      if (d.birds) this._ambience?.burst('amb_bird', 5);
    };
    this._need(d.bank, go);
  }

  setVolumes(v = EMPTY) {
    for (const k of ['master', 'music', 'sfx', 'ambience', 'voice']) {
      if (v[k] !== undefined && v[k] !== null && Number.isFinite(+v[k])) this._vol[k] = clamp01(+v[k]);
    }
    if (this._ctx) this._applyVolumes(0.04);
  }

  _applyVolumes(tc) {
    const now = this._ctx.currentTime;
    const set = (node, v) => {
      if (tc) node.gain.setTargetAtTime(v, now, tc);
      else node.gain.value = v;
    };
    const v = this._vol;
    set(this._master, v.master);
    set(this._musicIn, v.music * 0.9);
    set(this._sfxIn, v.sfx);
    set(this._sfxSend, v.sfx);
    set(this._uiIn, v.sfx);
    set(this._ambIn, v.ambience);
    set(this._ambSend, v.ambience);
    set(this._voiceIn, v.voice);
  }

  // debug: every bank referenced by the public API that is not (yet) loaded, plus unmapped SOUND ids
  _selfCheck() {
    const missing = [];
    const need = new Set();
    for (const [k, id] of Object.entries(SOUND)) {
      if (id && !SOUND_MAP[id]) missing.push('SOUND.' + k);
    }
    for (const d of SOUND_MAP) if (d) need.add(d.bank);
    for (const t of [LOCAL, STINGERS, LOOPS]) for (const k in t) need.add(t[k].bank);
    for (const k in STEP_BANKS) need.add(STEP_BANKS[k]);
    for (const b of DEF_BY_BANK.keys()) need.add(b);
    for (const b of need) if (!this._pools.get(b)?.length) missing.push(b);
    for (const k in this._envs) if (!this._envs[k].conv.buffer) missing.push('ir_' + k);
    if (!this._hallIR) missing.push('ir_hall');
    return missing;
  }

  // ---------------------------------------------------------------- voice chat
  createVoiceSource(mediaStream) {
    if (!this._ctx || !mediaStream) return NULL_VOICE;
    try {
      const v = new VoiceSource(this, mediaStream);
      this._voices.add(v);
      return v.handle;
    } catch (err) {
      console.warn('[audio] voice source failed', err);
      return NULL_VOICE;
    }
  }
}

export default AudioEngine;
