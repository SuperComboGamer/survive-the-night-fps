// Procedural WebAudio engine: every sound, ambience bed and the music is synthesised at runtime.
// Public API documented on the AudioEngine class below. No audio asset files are used.
import { SOUND } from '../../shared/defs.js';
import { jobList, renderJob, DEF_BY_BANK } from './registry.js';
import { Music } from './music.js';
import { Ambience } from './ambience.js';

const S = SOUND;
const EMPTY = Object.freeze({});
const MAX_POS_VOICES = 40;
const MAX_HRTF = 14;
const TICK_MS = 200;

// ------------------------------------------------------------------ positional categories
// ref/roll: inverse distance model; max: culled beyond; air: distance (m) constant of the air-absorption low-pass;
// wet: reverb send; hrtf: use HRTF panning when closer than this; cap: max simultaneous voices of the category;
// delay: apply speed-of-sound delay for far sources.
const CATS = {
  gun: { ref: 7, max: 260, roll: 1.0, air: 60, wet: 0.5, hrtf: 30, cap: 16, delay: true },
  explosion: { ref: 12, max: 320, roll: 0.9, air: 90, wet: 0.55, hrtf: 35, cap: 6, delay: true },
  big: { ref: 6, max: 110, roll: 1.0, air: 45, wet: 0.4, hrtf: 30, cap: 6 },
  zombie: { ref: 2.2, max: 45, roll: 1.1, air: 28, wet: 0.3, hrtf: 18, cap: 16 },
  fx: { ref: 2, max: 36, roll: 1.2, air: 25, wet: 0.22, hrtf: 12, cap: 14 },
  fxfar: { ref: 4, max: 75, roll: 1.0, air: 35, wet: 0.32, hrtf: 18, cap: 8 },
  step: { ref: 1.5, max: 25, roll: 1.4, air: 20, wet: 0.1, hrtf: 8, cap: 10 },
};

// SOUND id -> { bank, cat ('2d' = always non-positional), vol, jit (rate jitter), send (2D reverb send) }
const SOUND_MAP = [];
function def(id, bank, cat, vol = 1, jit = 0.04, send = 0.15) {
  if (id !== undefined) SOUND_MAP[id] = { bank, cat, vol, jit, send };
}
def(S.PISTOL, 'gun_pistol', 'gun', 0.85, 0.04);
def(S.SHOTGUN, 'gun_shotgun', 'gun', 0.9, 0.03);
def(S.AK47, 'gun_ak47', 'gun', 0.8, 0.035);
def(S.RIFLE, 'gun_rifle', 'gun', 0.9, 0.03);
def(S.M4A1, 'gun_m4a1', 'gun', 0.8, 0.035);
def(S.MP5, 'gun_mp5', 'gun', 0.75, 0.04);
def(S.DB_SHOTGUN, 'gun_dbshotgun', 'gun', 0.95, 0.03);
def(S.CROSSBOW, 'xbow_shot', 'fx', 0.8, 0.05); // no blast: it carries about as far as a swing, not a gunshot
def(S.MELEE_SWING, 'swing', 'fx', 0.55, 0.08);
def(S.MELEE_HIT, 'flesh_heavy', 'fx', 0.85, 0.08);
def(S.ZOMBIE_GROWL, 'z_growl', 'zombie', 0.75, 0.1);
def(S.ZOMBIE_ATTACK, 'z_attack', 'zombie', 0.9, 0.08);
def(S.ZOMBIE_DEATH, 'z_death', 'zombie', 0.9, 0.08);
def(S.ZOMBIE_PAIN, 'z_pain', 'zombie', 0.8, 0.1);
def(S.RUNNER_SCREAM, 'z_runner', 'zombie', 1, 0.07);
def(S.TANK_ROAR, 'z_tank', 'big', 1, 0.06);
def(S.SPITTER_SPIT, 'z_spit', 'zombie', 0.9, 0.08);
def(S.LEAPER_SCREECH, 'z_leaper', 'zombie', 0.9, 0.08);
def(S.ROPER_SHOOT, 'z_roper', 'zombie', 0.9, 0.06);
def(S.BOOMER_GURGLE, 'z_boomer', 'zombie', 0.9, 0.08);
def(S.EXPLOSION, 'explosion', 'explosion', 1, 0.05);
def(S.BAT_SCREECH, 'z_bat', 'zombie', 0.7, 0.1);
def(S.BOSS_ROAR, 'z_boss', 'big', 1, 0.05);
def(S.ACID_SIZZLE, 'acid', 'fx', 0.7, 0.08);
def(S.FIRE_WHOOSH, 'fire_whoosh', 'fxfar', 0.9, 0.06);
def(S.GLASS_BREAK, 'glass', 'fx', 0.8, 0.08);
def(S.WOOD_HIT, 'wood_hit', 'fx', 0.8, 0.08);
def(S.WOOD_BREAK, 'wood_break', 'fxfar', 1, 0.06);
def(S.METAL_HIT, 'metal_hit', 'fx', 0.75, 0.06);
def(S.BUILD, 'build', 'fx', 0.8, 0.05);
def(S.PICKUP, 'pickup', 'fx', 0.5, 0.08);
def(S.CRAFT, 'craft', 'fx', 0.6, 0.05);
def(S.RELOAD, 'reload', 'fx', 0.55, 0.04);
def(S.CROSSBOW_COCK, 'xbow_cock', 'fx', 0.5, 0.03);
def(S.DRY_FIRE, 'dry', 'fx', 0.55, 0.05);
def(S.PLAYER_HURT, 'hurt', 'fx', 0.8, 0.06);
def(S.PLAYER_DEATH, 'pdeath', 'fxfar', 1, 0.04);
def(S.HEAL, 'bandage', 'fx', 0.5, 0.05);
def(S.CAR_PART, 'car_part', 'fx', 0.9, 0.03);
def(S.HORDE_HORN, 'horde_horn', '2d', 0.8, 0, 0.35);
def(S.DAWN, 'dawn', '2d', 0.7, 0, 0.3);
def(S.PLANE, 'plane', '2d', 0.8, 0, 0.2);
def(S.CRATE_LAND, 'crate', 'fxfar', 1, 0.05);
def(S.CAMPFIRE_ADD, 'campfire_add', 'fx', 0.8, 0.06);
def(S.FLESH_HIT, 'flesh', 'fx', 0.75, 0.1);
def(S.HEADSHOT, 'headshot_w', 'fx', 0.9, 0.08);
def(S.ZPLAYER_GROWL, 'zp_growl', 'zombie', 0.9, 0.08);
def(S.THROW, 'throw', 'fx', 0.55, 0.08);
def(S.FOOTSTEP, 'step_dirt', 'step', 0.55, 0.08);
def(S.LEAP, 'leap', 'fx', 0.8, 0.08);
def(S.CAR_START, 'car_start', 'fxfar', 1, 0.02);
def(S.SLAM, 'slam', 'explosion', 1, 0.05);
def(S.SWITCH, 'switch', 'fx', 0.45, 0.06);
def(S.CHOP, 'wood_hit', 'fx', 0.9, 0.1);
def(S.SALVAGE, 'metal_hit', 'fx', 0.8, 0.1);
def(S.SEARCH, 'craft', 'fx', 0.4, 0.08);
def(S.PING, 'notify', 'fx', 0.6, 0.02);
def(S.ENGINE_CRANK, 'car_start', 'big', 1, 0.02);
def(S.REVIVE, 'bandage', 'fx', 0.7, 0.05);
def(S.DOWNED, 'hurt', 'fxfar', 1, 0.02);
def(S.FLARE_BURN, 'acid', 'fx', 0.45, 0.1);
def(S.CAT_MEOW, 'cat_meow', 'fx', 0.55, 0.06);
def(S.DOG_BARK, 'dog_bark', 'zombie', 0.95, 0.08);
def(S.DOG_HOWL, 'dog_howl', 'big', 0.8, 0.06);
def(S.DOG_SNARL, 'dog_snarl', 'zombie', 0.85, 0.1);
def(S.DOG_YELP, 'dog_yelp', 'zombie', 0.8, 0.08);
def(S.EAT, 'eat', 'fx', 0.5, 0.05);

// playLocal(name): first-person / UI 2D sounds. bus: 'sfx' (world, muffled when dead) or 'ui' (always clear)
const LOCAL = {
  pistol: { bank: 'fp_pistol', vol: 0.95, jit: 0.03, send: 0.14 },
  shotgun: { bank: 'fp_shotgun', vol: 1, jit: 0.025, send: 0.18 },
  ak47: { bank: 'fp_ak47', vol: 0.88, jit: 0.03, send: 0.13 },
  rifle: { bank: 'fp_rifle', vol: 1, jit: 0.02, send: 0.2 },
  m4a1: { bank: 'fp_m4a1', vol: 0.86, jit: 0.03, send: 0.13 },
  mp5: { bank: 'fp_mp5', vol: 0.8, jit: 0.035, send: 0.1 },
  dbshotgun: { bank: 'fp_dbshotgun', vol: 1, jit: 0.025, send: 0.2 },
  crossbow: { bank: 'fp_crossbow', vol: 0.7, jit: 0.03, send: 0.05 },
  reload_start: { bank: 'reload_start', vol: 0.55 },
  reload_end: { bank: 'reload_end', vol: 0.6 },
  shell_insert: { bank: 'shell_insert', vol: 0.55 },
  bolt: { bank: 'bolt', vol: 0.6 },
  pump: { bank: 'pump', vol: 0.7 },
  xbow_cock: { bank: 'xbow_cock', vol: 0.6, jit: 0.02 },
  xbow_load: { bank: 'xbow_load', vol: 0.5 },
  dry: { bank: 'dry', vol: 0.55 },
  swing: { bank: 'swing', vol: 0.5, jit: 0.08 },
  swing_heavy: { bank: 'swing_heavy', vol: 0.6, jit: 0.06 },
  hit: { bank: 'flesh_heavy', vol: 0.75, jit: 0.08 },
  hit_wood: { bank: 'wood_hit', vol: 0.7, jit: 0.08 },
  switch: { bank: 'switch', vol: 0.45 },
  pickup: { bank: 'pickup', vol: 0.5, jit: 0.06 },
  craft: { bank: 'craft', vol: 0.55 },
  build: { bank: 'build', vol: 0.65 },
  build_fail: { bank: 'build_fail', vol: 0.45, bus: 'ui' },
  hitmarker: { bank: 'hitmarker', vol: 0.3, bus: 'ui', jit: 0.01, send: 0 },
  headshot: { bank: 'headshot_ding', vol: 0.5, bus: 'ui', jit: 0.01, send: 0 },
  kill: { bank: 'kill', vol: 0.35, bus: 'ui', jit: 0.01, send: 0 },
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
  zombie_player_growl: { bank: 'zp_growl', vol: 0.65, jit: 0.07 },
  death: { bank: 'death_local', vol: 0.9, bus: 'ui', send: 0 },
  notify: { bank: 'notify', vol: 0.3, bus: 'ui', jit: 0.02, send: 0 },
  chat: { bank: 'chat', vol: 0.25, bus: 'ui', jit: 0.02, send: 0 },
  install_part: { bank: 'install_part', vol: 0.7 },
  campfire_add: { bank: 'campfire_add', vol: 0.6 },
  eat: { bank: 'eat', vol: 0.5 },
  can_open: { bank: 'can_open', vol: 0.5 },
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

// createLoop(name) definitions
const LOOPS = {
  campfire: { bank: 'loop_campfire', ref: 2.5, max: 32, roll: 1.2, vol: 0.8, wet: 0.12 },
  torch: { bank: 'loop_torch', ref: 1.2, max: 16, roll: 1.4, vol: 0.45, wet: 0.08 },
  fire: { bank: 'loop_fire', ref: 3, max: 45, roll: 1.1, vol: 0.9, wet: 0.15 },
  acid: { bank: 'loop_acid', ref: 1.5, max: 18, roll: 1.4, vol: 0.5, wet: 0.08 },
  zombie_idle: { bank: 'loop_zombie_idle', ref: 1.5, max: 22, roll: 1.3, vol: 0.55, wet: 0.12, cap: 10, jit: 0.14 },
  boss_breath: { bank: 'loop_boss_breath', ref: 5, max: 70, roll: 1.0, vol: 0.9, wet: 0.2, cap: 3 },
  generator: { bank: 'loop_generator', ref: 2.5, max: 40, roll: 1.2, vol: 0.6, wet: 0.1 },
};
const LOOP_CAP_TOTAL = 28;

const STEP_BANKS = { dirt: 'step_dirt', grass: 'step_grass', wood: 'step_wood', water: 'step_water', metal: 'step_metal' };

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
    this.variant = Math.floor(Math.random() * 8);
    this.src = null;
    this.gain = null;
    this.fade = null;
    this.panner = null;
    this.sendG = null;
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
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this._deactivate();
    this.e._loops.delete(this);
  }
  _activate(now) {
    const e = this.e;
    const pool = e._pools.get(this.def.bank);
    if (!pool || !pool.length) return false;
    const c = e._ctx;
    const buf = pool[this.variant % pool.length];
    this.src = c.createBufferSource();
    this.src.buffer = buf;
    this.src.loop = true;
    this.src.playbackRate.value = this.rate;
    this.gain = c.createGain();
    this.gain.gain.value = this.vol * this.def.vol;
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
    this.src.connect(this.gain);
    this.gain.connect(this.fade);
    this.fade.connect(this.panner);
    this.panner.connect(e._sfxIn);
    this.fade.connect(this.sendG);
    this.sendG.connect(e._sfxSend);
    this.src.start(now, Math.random() * buf.duration);
    this.active = true;
    this._fadeTarget = -1;
    return true;
  }
  _deactivate() {
    if (!this.active) return;
    this.active = false;
    const now = this.e._ctx.currentTime;
    const { src, gain, fade, panner, sendG } = this;
    fade.gain.setTargetAtTime(0, now, 0.06);
    try {
      src.stop(now + 0.35);
    } catch {}
    src.onended = () => {
      for (const n of [src, gain, fade, panner, sendG]) {
        try {
          n.disconnect();
        } catch {}
      }
    };
    this.src = this.gain = this.fade = this.panner = this.sendG = null;
  }
  _updateFade(now) {
    const m = this.def.max;
    const f = clamp01((m - this.d) / (m * 0.25));
    if (Math.abs(f - this._fadeTarget) > 0.02) {
      this._fadeTarget = f;
      this.fade.gain.setTargetAtTime(f, now, 0.15);
    }
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

const NULL_LOOP = Object.freeze({ setPosition() {}, setVolume() {}, stop() {} });
const NULL_VOICE = Object.freeze({ setPosition() {}, setVolume() {}, setMuffled() {}, disconnect() {} });

// ------------------------------------------------------------------ engine
export class AudioEngine {
  constructor() {
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
    this._state = { night: 0, horde: false, boss: false, danger: 0, lowHealth: 0, nearFire: 0, underCover: false, rain: 0, wind: 0.3, dead: false, menu: false };
    this._vol = { master: 1, music: 1, sfx: 1, ambience: 1, voice: 1 };
    this._rateMul = 1;
    this._hrtfCount = 0;
    this._hbNext = 0;
    this._lastResume = 0;
    this._timer = null;
    this._loopScratch = [];
    this._mix = { world: -1, sfxLP: -1 };
    this._queue = null;
  }

  get ready() {
    return this._ready;
  }
  get context() {
    return this._ctx;
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
    this._pre = g(1);
    this._pre.connect(this._master);
    this._master.connect(this._comp);
    this._comp.connect(this._makeup);
    this._makeup.connect(this._limit);
    this._limit.connect(c.destination);

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

    // shared forest reverb (buffer assigned when its IR is rendered)
    this._revIn = g(1);
    this._revIn.channelCount = 1;
    this._revIn.channelCountMode = 'explicit';
    this._conv = c.createConvolver();
    this._revOut = g(0.9);
    this._revIn.connect(this._conv);
    this._conv.connect(this._revOut);
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
    if (bank === 'ir_forest') {
      this._conv.buffer = buf;
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
    const buf = this._pick(d.bank, o.variant);
    if (!buf) {
      this._need(d.bank);
      return;
    }
    this._resume();
    const vol = (o.volume ?? 1) * d.vol * (0.92 + Math.random() * 0.16);
    const rate = (o.rate ?? 1) * (1 + (Math.random() - 0.5) * 2 * d.jit) * this._rateMul;
    if (d.cat === '2d' || o.x === undefined || o.x === null) {
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
    const buf = this._pick(d.bank, o.variant);
    if (!buf) {
      this._need(d.bank);
      return;
    }
    this._resume();
    const ui = d.bus === 'ui';
    const jit = d.jit ?? 0.04;
    const vol = (o.volume ?? 1) * d.vol * (ui ? 1 : 0.94 + Math.random() * 0.12);
    const rate = (o.rate ?? 1) * (1 + (Math.random() - 0.5) * 2 * jit) * (ui ? 1 : this._rateMul);
    this._play2D(buf, vol, rate, ui ? this._uiIn : this._sfxIn, d.send ?? 0.06, 0);
  }

  footstep(surface, x, y, z, volume = 1) {
    if (!this._ready) return;
    const bank = STEP_BANKS[surface] || 'step_dirt';
    const buf = this._pick(bank);
    if (!buf) return;
    const vol = (volume ?? 1) * (0.88 + Math.random() * 0.24);
    const rate = (1 + (Math.random() - 0.5) * 0.14) * this._rateMul;
    if (x === undefined || x === null) {
      this._resume();
      this._play2D(buf, vol * 0.32, rate, this._sfxIn, 0.03, 0);
      return;
    }
    this._playPos(buf, 'step', +x, +(y ?? this._ly), +(z ?? 0), vol * 0.6, rate);
  }

  _play2D(buf, vol, rate, dest, send, when) {
    const c = this._ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(g);
    g.connect(dest);
    let sg = null;
    if (send > 0 && dest !== this._uiIn) {
      sg = c.createGain();
      sg.gain.value = send;
      g.connect(sg);
      sg.connect(dest === this._ambIn ? this._ambSend : this._sfxSend);
    }
    src.onended = () => {
      src.disconnect();
      g.disconnect();
      if (sg) sg.disconnect();
    };
    src.start(when || 0);
    return src;
  }

  _playPos(buf, catName, x, y, z, vol, rate) {
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
    const fc = 350 + 19650 * Math.exp(-d / cat.air);
    ch.filter.frequency.value = fc > 18000 ? 20000 : fc;
    ch.gain.gain.value = vol;
    const far = d / cat.max;
    ch.send.gain.value = cat.wet * (0.25 + 0.75 * far) * Math.pow(cat.ref / Math.max(d, cat.ref), 0.35);
    const src = this._ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.connect(ch.filter);
    src.onended = ch.onEnded;
    const delay = cat.delay && d > 20 ? d / 343 : 0;
    const t = now + delay;
    src.start(t);
    ch.src = src;
    ch.start = t;
    ch.end = t + buf.duration / rate;
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
    for (const l of list) {
      if (l._want) {
        const cap = l.def.cap ?? 99;
        const n = counts[l.name] || 0;
        if (n >= cap || total >= LOOP_CAP_TOTAL) l._want = false;
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
    s.wind = Number.isFinite(state.wind) ? Math.max(0, Math.min(2, state.wind)) : 0.3;
    s.dead = dead;
    s.menu = menu;
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
    if (lh > 0.12) {
      const period = 60 / (60 + 70 * lh);
      if (this._hbNext < now) this._hbNext = now + 0.05;
      const hb = this._pick('heartbeat');
      while (hb && this._hbNext < now + 0.45) {
        this._play2D(hb, 0.2 + 0.65 * lh, 1, this._uiIn, 0, this._hbNext);
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
    if (!this._conv.buffer) missing.push('ir_forest');
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
