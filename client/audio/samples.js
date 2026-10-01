// Curated CC0 recordings (Freesound, mostly via the Deadfall asset set; authors in samples/CREDITS.md) layered over
// the procedural engine. Everything here is optional: files are fetched + decoded in the background after init and
// every consumer falls back to the procedural banks while a recording is missing (still loading, fetch or decode
// failed, no Ogg Vorbis support), so without them the game sounds exactly as before.

let URLS = {};
try {
  // Vite rewrites this into { './samples/x.ogg': url }; outside Vite it throws and we simply stay procedural.
  URLS = import.meta.glob('./samples/*.ogg', { query: '?url', import: 'default', eager: true });
} catch {}

// sr: decode rate. The long ambience files are 32 kHz and decode at that rate (a third less memory than the context
// rate); foley decodes at the context rate. lazy: decoded only when first wanted and dropped from memory again
// while unused (re-decoded from the cached bytes): the beds and the wildlife that only calls at some times of day.
// slices: flat [start, dur, start, dur, ...] in seconds.
const BED32 = { sr: 32000, lazy: true };
export const REC = {
  amb_day: BED32,
  amb_day_wind: BED32,
  amb_dawn: BED32,
  amb_dusk: BED32,
  amb_night: BED32,
  amb_crickets: BED32,
  wind_light: BED32,
  wind_mid: BED32,
  wind_strong: BED32,
  fire_loop: { sr: 44100, lazy: true },
  fire_roar: BED32,

  fs_dirt: { slices: [0,0.496, 0.556,0.496, 1.112,0.396, 1.568,0.496, 2.124,0.461, 2.645,0.496, 3.201,0.389, 3.65,0.496, 4.206,0.496, 4.762,0.496, 5.318,0.496, 5.874,0.446, 6.38,0.496, 6.936,0.496, 7.492,0.496, 8.048,0.496, 8.604,0.416, 9.08,0.341] },
  fs_grass: { slices: [0,0.496, 0.556,0.496, 1.112,0.496, 1.668,0.496, 2.224,0.496, 2.78,0.416, 3.256,0.496, 3.812,0.406, 4.278,0.496, 4.834,0.406, 5.3,0.496, 5.856,0.496, 6.412,0.496, 6.968,0.496, 7.524,0.496, 8.08,0.496] },
  fs_forest: { slices: [0,0.496, 0.556,0.496, 1.112,0.496, 1.668,0.496, 2.224,0.496, 2.78,0.496, 3.336,0.496, 3.892,0.496, 4.448,0.496, 5.003,0.496, 5.559,0.481, 6.1,0.496, 6.656,0.436, 7.152,0.496, 7.708,0.496, 8.264,0.496, 8.82,0.496, 9.376,0.496, 9.932,0.496, 10.488,0.496] },
  fs_leaves: { slices: [0,0.406, 0.466,0.496, 1.022,0.496, 1.578,0.496, 2.134,0.496, 2.69,0.496, 3.246,0.356, 3.662,0.496, 4.218,0.496, 4.774,0.496, 5.33,0.496, 5.886,0.496, 6.442,0.496, 6.998,0.496, 7.554,0.496, 8.11,0.496, 8.666,0.496, 9.222,0.496, 9.777,0.496, 10.333,0.496] },
  fs_gravel: { slices: [0,0.431, 0.491,0.471, 1.022,0.476, 1.558,0.481, 2.099,0.476, 2.635,0.496, 3.191,0.496, 3.747,0.496, 4.303,0.496, 4.859,0.496, 5.415,0.496, 5.971,0.496, 6.527,0.496, 7.083,0.411, 7.554,0.496, 8.11,0.411] },
  fs_mud: { slices: [0,0.496, 0.556,0.496, 1.112,0.496, 1.668,0.411, 2.139,0.496, 2.695,0.496, 3.251,0.496, 3.807,0.496, 4.363,0.496, 4.919,0.496, 5.475,0.496, 6.031,0.496, 6.586,0.496, 7.142,0.496] },
  fs_wood: { slices: [0,0.439, 0.499,0.446, 1.005,0.496, 1.561,0.371, 1.992,0.416, 2.468,0.496, 3.024,0.496, 3.58,0.481, 4.121,0.496, 4.677,0.496, 5.233,0.456, 5.749,0.471, 6.28,0.496, 6.836,0.496] },
  fs_water: { slices: [0,1.05, 1.11,1.052, 2.222,0.832, 3.114,1.052, 4.226,0.592, 4.878,1.052, 5.99,0.222, 6.272,0.212, 6.544,1.052, 7.656,1.052, 8.768,0.832, 9.66,0.732, 10.452,0.332, 10.844,0.702] },
  cloth: { slices: [0,0.43, 0.49,0.392, 0.942,1.052, 2.054,1.052, 3.166,0.992, 4.218,1.052, 5.33,0.722, 6.112,0.672, 6.844,0.622, 7.526,1.052, 8.638,0.652, 9.35,0.292] },
  chop: { slices: [0,0.94, 1,0.952, 2.012,0.952, 3.024,0.952, 4.036,0.952, 5.048,0.952, 6.06,0.952, 7.072,0.682, 7.814,0.952, 8.826,0.392, 9.278,0.542, 9.88,0.952, 10.892,0.732, 11.684,0.442, 12.186,0.582, 12.828,0.562] },
  hammer: { slices: [0,0.322, 0.382,0.302, 0.744,0.372, 1.176,0.652, 1.888,0.392, 2.34,0.412, 2.812,0.392, 3.264,0.392, 3.716,0.392] },
  sticks: { slices: [0,1.142, 1.202,1.142, 2.404,0.272, 2.736,0.292, 3.088,0.772, 3.92,1.032, 5.012,1.012, 6.084,0.812] },
  swing: { slices: [0,0.252, 0.312,0.482, 0.854,0.43, 1.344,0.452] },
  hit_flesh: { slices: [0,0.652, 0.712,0.192, 0.964,0.652, 1.676,0.165, 1.901,0.652] },
  fire_ignite: { slices: [0,1.7, 1.76,0.75] },

  // gunshots: every take starts on its transient; full-auto takes are single shots spliced onto their burst's tail
  gun_pistol: { slices: [0,1.28, 1.34,1.2, 2.6,1.2] },
  gun_shotgun: { slices: [0,1.26, 1.32,1.149, 2.53,1.6] },
  gun_dbshotgun: { slices: [0,2, 2.06,1.8, 3.92,1.54] },
  gun_ak47: { slices: [0,0.96, 1.02,0.96, 2.04,0.96, 3.06,0.96, 4.08,1.3] },
  gun_m4a1: { slices: [0,1.3, 1.36,0.72, 2.14,1.139, 3.34,0.86, 4.26,0.84] },
  gun_mp5: { slices: [0,0.708, 0.768,0.708, 1.536,0.708, 2.304,0.708, 3.072,1.1, 4.232,1.1] },
  gun_rifle: { slices: [0,2.2, 2.26,2.2] },
  gun_far: { sr: 32000, slices: [0,1.2, 1.26,1.2, 2.52,1.2, 3.78,1.2, 5.04,1.2, 6.3,2] },
  hit_bullet: { slices: [0,0.149, 0.21,0.144, 0.415,0.22, 0.695,0.19, 0.945,0.299] },
  hit_head: { slices: [0,0.6, 0.66,0.299, 1.02,0.6] },
  // zombie voices
  zv_growl: { sr: 32000, slices: [0,2.629, 2.69,3.149, 5.9,2.24, 8.2,2.479, 10.74,2.369, 13.17,3.419, 16.65,3.529, 20.24,1.169, 21.47,0.69, 22.22,1.88, 24.16,1.55, 25.77,1.12] },
  zv_attack: { sr: 32000, slices: [0,0.8, 0.86,0.77, 1.69,0.97, 2.72,0.81, 3.59,0.99, 4.64,1.039, 5.74,0.91, 6.71,0.78, 7.55,0.939, 8.55,0.87, 9.48,0.78, 10.32,1.05, 11.43,1.089, 12.58,0.519, 13.16,0.88] },
  zv_pain: { sr: 32000, slices: [0,1.07, 1.13,0.51, 1.7,0.649, 2.41,0.538, 3.009,0.81, 3.879,0.878, 4.817,0.309] },
  zv_death: { sr: 32000, slices: [0,0.6, 0.66,0.83, 1.55,1.6, 3.21,1.21, 4.48,1.19] },
  zv_scream: { sr: 32000, slices: [0,1.909, 1.97,1.62, 3.65,1.419] },
  zv_roar: { sr: 32000, slices: [0,1.55, 1.61,2.149] },
  zv_idle: { sr: 32000 },

  branch_snap: { slices: [0,0.432, 0.492,0.282, 0.834,0.232, 1.126,0.852, 2.038,0.222, 2.32,0.852, 3.232,0.852, 4.144,0.852, 5.056,0.352, 5.468,0.852, 6.38,0.302, 6.742,0.412, 7.214,0.852, 8.126,0.192] },
  bush_rustle: { sr: 32000, slices: [0,0.572, 0.632,1.652, 2.344,0.702, 3.106,1.112, 4.278,1.652, 5.99,0.632, 6.682,1.64, 8.382,1.652] },
  animal_steps: { sr: 32000, slices: [0,0.212, 0.272,0.392, 0.724,0.172, 0.956,0.452, 1.468,0.452, 1.98,0.452, 2.492,0.452, 3.004,0.452, 3.516,0.452, 4.028,0.412, 4.5,0.452, 5.012,0.452, 5.524,0.452, 6.036,0.452, 6.548,0.242, 6.85,0.452] },
  tree_creak: { sr: 32000, slices: [0,4.052, 4.112,4.052, 8.224,4.052, 12.336,4.052, 16.448,4.052, 20.56,1.372, 21.992,0.612, 22.664,1.362, 24.086,1.082] },
  owl_barred: { sr: 32000, lazy: true, slices: [0,6.052, 6.112,3.672, 9.844,6.052, 15.956,6.05, 22.066,2.982, 25.108,2.902, 28.07,2.962, 31.092,3.802] },
  owl_horned: { sr: 32000, lazy: true, slices: [0,2.922, 2.982,4.192, 7.234,3.522, 10.816,3.862, 14.738,2.922, 17.72,3.772, 21.552,4.762, 26.374,2.972] },
  raven: { sr: 32000, slices: [0,0.302, 0.362,0.362, 0.784,0.512, 1.356,0.392, 1.808,1.352, 3.22,1.352, 4.632,0.472, 5.164,0.382, 5.606,0.312] },
  woodpecker: { sr: 32000, slices: [0,1.242, 1.302,0.482, 1.844,0.402, 2.306,0.662, 3.028,1.872, 4.96,0.942, 5.962,1.772, 7.794,0.482] },
  wolf_howl: { sr: 32000, lazy: true, slices: [0,9.052, 9.112,9.052, 18.224,9.052, 27.336,6.402] },
  bird_robin: { sr: 32000, lazy: true, slices: [0,2.392, 2.452,4.052, 6.564,1.242, 7.866,4.052, 11.978,3.482, 15.52,2.452, 18.032,3.842, 21.934,3.312, 25.306,4.052, 29.418,4.052] },
  bird_chickadee: { sr: 32000, lazy: true, slices: [0,1.952, 2.012,1.192, 3.264,1.902, 5.226,0.722, 6.008,1.142, 7.21,1.102, 8.372,0.462, 8.894,2.052, 11.006,2.052, 13.118,0.882] },
};

const FETCH_CONCURRENCY = 3;
const EVICT_AFTER = 120; // s a lazy recording may sit unused before its decoded buffer is dropped

const urlOf = (key) => URLS[`./samples/${key}.ogg`];

export class Recordings {
  constructor(ctx, enabled = true) {
    this.ctx = ctx;
    this.buf = new Map(); // key -> AudioBuffer
    this.bytes = new Map(); // key -> compressed ArrayBuffer (lazy ones keep theirs for re-decoding after eviction)
    this.used = new Map(); // key -> ctx time of last use
    this.recent = new Map(); // key -> recently played slice indices
    this.decoding = new Set();
    this.wanted = new Set(); // requested before their bytes arrived
    this.failed = new Set();
    this.decoded = 0;
    this.enabled = !!enabled && typeof fetch === 'function' && Object.keys(URLS).length > 0;
    this.done = false; // every fetch settled
    this._dec = new Map(); // sample rate -> OfflineAudioContext used as a decoder
    this._reported = false;
    this._decodeFails = 0;
    this._fetched = 0;
    this._fetchFails = 0;
  }

  /** decoded and ready to play */
  has(key) {
    return this.buf.has(key);
  }

  /** bytes are here and decoding is (or will be) under way: worth waiting a moment rather than falling back */
  pending(key) {
    return this.enabled && !this.failed.has(key) && (this.decoding.has(key) || this.bytes.has(key));
  }

  /** has() or pending(): the recording will be what plays here */
  covers(key) {
    return this.buf.has(key) || this.pending(key);
  }

  /** decoded buffer or null; marks it used and (re)starts decoding when it is missing */
  get(key) {
    const b = this.buf.get(key);
    if (this.ctx) this.used.set(key, this.ctx.currentTime);
    if (!b) this.want(key);
    return b || null;
  }

  want(key) {
    if (!this.enabled || this.buf.has(key) || this.decoding.has(key) || this.failed.has(key) || !REC[key]) return;
    if (this.bytes.has(key)) this._decode(key);
    else this.wanted.add(key);
  }

  /** random slice [offset, duration] never repeating the last two takes (whole buffer when unsliced) */
  pick(key, buf) {
    const s = REC[key]?.slices;
    if (!s) return [0, buf.duration];
    const n = s.length >> 1;
    let r = this.recent.get(key);
    if (!r) this.recent.set(key, (r = [-1, -1]));
    let k = Math.floor(Math.random() * n);
    for (let t = 0; t < 6 && n > 2 && (k === r[0] || k === r[1]); t++) k = Math.floor(Math.random() * n);
    r[1] = r[0];
    r[0] = k;
    return [s[k * 2], s[k * 2 + 1]];
  }

  /** fetch every file (keys in `first` first); eager ones decode straight away, lazy ones when first wanted */
  async start(first = []) {
    if (!this.enabled) return;
    const keys = [...new Set([...first, ...Object.keys(REC)])].filter((k) => REC[k]);
    for (const k of keys) {
      if (!urlOf(k)) this.failed.add(k);
    }
    let i = 0;
    const next = async () => {
      const key = keys[i++];
      if (this.failed.has(key)) return;
      try {
        const r = await fetch(urlOf(key));
        if (!r.ok) throw new Error('HTTP ' + r.status);
        this.bytes.set(key, await r.arrayBuffer());
        this._fetched++;
        if (!REC[key].lazy || this.wanted.has(key)) this._decode(key);
      } catch (err) {
        this._fail(key, err);
        // offline / files not deployed: give up instead of failing every request
        if (!this._fetched && ++this._fetchFails >= 2) this._disable();
      }
    };
    // one request first, so a missing deployment fails once rather than once per file
    while (i < keys.length && this.enabled && !this._fetched) await next();
    const worker = async () => {
      while (i < keys.length && this.enabled) await next();
    };
    await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
    this.done = true;
    this._report();
  }

  _decoder(sr) {
    if (!sr || sr === this.ctx.sampleRate) return this.ctx;
    let d = this._dec.get(sr);
    if (d === undefined) {
      try {
        const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        d = new OAC(1, 1, sr);
      } catch {
        d = null;
      }
      this._dec.set(sr, d);
    }
    return d || this.ctx;
  }

  _decode(key, fallback = false) {
    const ab = this.bytes.get(key);
    if (!ab || this.decoding.has(key)) return;
    this.decoding.add(key);
    this.wanted.delete(key);
    const dec = fallback ? this.ctx : this._decoder(REC[key].sr);
    new Promise((res, rej) => {
      // old Safari only has the callback form; modern browsers return a promise as well
      const p = dec.decodeAudioData(ab.slice(0), res, rej);
      if (p && p.then) p.then(res, rej);
    }).then(
      (buf) => {
        this.decoding.delete(key);
        if (!this.enabled) return;
        this.buf.set(key, buf);
        this.decoded++;
        if (this.ctx) this.used.set(key, this.ctx.currentTime);
        if (!REC[key].lazy) this.bytes.delete(key);
      },
      (err) => {
        this.decoding.delete(key);
        if (!fallback && dec !== this.ctx) return this._decode(key, true);
        this._fail(key, err);
        // nothing decodes (e.g. no Ogg Vorbis support): stop wasting bandwidth, stay procedural
        if (!this.decoded && ++this._decodeFails >= 2) this._disable();
      },
    );
  }

  _fail(key, err) {
    this.failed.add(key);
    this.bytes.delete(key);
    this.wanted.delete(key);
    if (!this._why) this._why = (err && (err.message || err.name)) || String(err);
  }

  _disable() {
    if (!this.enabled) return;
    this.enabled = false;
    for (const k of Object.keys(REC)) if (!this.buf.has(k)) this.failed.add(k);
    this.bytes.clear();
    this.wanted.clear();
    this._report();
  }

  _report() {
    if (this._reported || !this.failed.size) return;
    this._reported = true;
    console.info(`[audio] ${this.failed.size} recording(s) unavailable (${this._why || 'not shipped'}); using procedural sound for those`);
  }

  /** drop decoded lazy recordings nobody used for a while (their compressed bytes stay cached) */
  evict(now) {
    for (const key of this.buf.keys()) {
      if (REC[key].lazy && this.bytes.has(key) && now - (this.used.get(key) || 0) > EVICT_AFTER) this.buf.delete(key);
    }
  }

  status() {
    return {
      enabled: this.enabled,
      done: this.done,
      decoded: [...this.buf.keys()],
      failed: [...this.failed],
      pending: [...this.decoding],
      total: Object.keys(REC).length,
    };
  }
}
