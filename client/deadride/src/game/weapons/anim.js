// Keyframe animation for the view-model: clips with numeric tracks (gun offset, parts), hand-target tracks and timed events.
// clip = { dur, tracks: { name: [[t, value, ease], ...] }, events: [[t, type, arg], ...] }
//  - numeric track value: number | [n...] ; the ease on a key shapes the segment ARRIVING at that key.
//  - hand track value: { f: frameName, p?: [dx,dy,dz] (frame-local), r?: [rx,ry,rz] deg (frame-local), pose?: 'name' | Float32Array, pw?: poseBlend }
// All sampling is allocation-free (outputs into caller arrays / a shared segment object).
import * as THREE from 'three';
import { POSE_ARR, handQuat } from './hands.js';

const c1 = 1.70158, c3 = c1 + 1;
export const EASE = {
  lin: (t) => t,
  in: (t) => t * t, out: (t) => 1 - (1 - t) * (1 - t),
  in3: (t) => t * t * t, out3: (t) => 1 - Math.pow(1 - t, 3), out5: (t) => 1 - Math.pow(1 - t, 5),
  io: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2), sine: (t) => 0.5 - 0.5 * Math.cos(Math.PI * t),
  back: (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2), // overshoot then settle
  snap: (t) => 1 - Math.pow(1 - t, 8), step: (t) => (t < 1 ? 0 : 1), hold: (t) => 0,
  spring: (t) => 1 - Math.exp(-7 * t) * Math.cos(9 * t), // damped overshoot (slaps, seats)
};

/** Normalise a clip definition in place: sort keys, resolve pose names, precompute event list. */
export function makeClip(def) {
  const sc = def.scale || 1; // uniform retime
  const c = { dur: def.dur * sc, tracks: {}, events: (def.events || []).map((e) => [e[0] * sc, ...e.slice(1)]).sort((a, b) => a[0] - b[0]), name: def.name || '', speedable: def.speedable !== false, def };
  for (const [name, keys] of Object.entries(def.tracks || {})) {
    const ks = keys.map((k) => { const v = k[1]; let val = v; if (v && typeof v === 'object' && !Array.isArray(v)) { val = { ...v }; if (typeof val.pose === 'string') val.poseArr = POSE_ARR[val.pose]; else if (val.pose) val.poseArr = val.pose;
      if (val.c) { val.camP = new THREE.Vector3(...val.c); val.camQ = handQuat(val.fd || [0, 0, -1], val.pn || [0, -1, 0]); if (val.rr) val.camQ.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(val.rr[0] * Math.PI / 180, val.rr[1] * Math.PI / 180, val.rr[2] * Math.PI / 180, 'XYZ'))); } }
      return { t: k[0] * sc, v: val, e: EASE[k[2] || 'io'] || EASE.io }; });
    ks.sort((a, b) => a.t - b.t); c.tracks[name] = ks;
  }
  return c;
}

const SEG = { i0: 0, i1: 0, e: 0 };
/** find the segment for time t: returns shared {i0, i1, e} (e = eased blend 0..1 from key i0 to key i1) */
export function seg(keys, t) {
  const n = keys.length; if (n === 1 || t <= keys[0].t) { SEG.i0 = SEG.i1 = 0; SEG.e = 0; return SEG; }
  if (t >= keys[n - 1].t) { SEG.i0 = SEG.i1 = n - 1; SEG.e = 0; return SEG; }
  let i = 0; while (i < n - 2 && t >= keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1]; const u = (t - a.t) / Math.max(1e-6, b.t - a.t); SEG.i0 = i; SEG.i1 = i + 1; SEG.e = b.e(u); return SEG;
}
/** numeric track -> out (array) ; returns out. Scalars are written to out[0]. */
export function sampleNum(keys, t, out) {
  const s = seg(keys, t); const a = keys[s.i0].v, b = keys[s.i1].v, e = s.e;
  if (typeof a === 'number') { out[0] = a + (b - a) * e; return out; }
  for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * e; return out;
}
/** fire events whose time is in (t0, t1] */
export function fireEvents(clip, t0, t1, cb) { const ev = clip.events; for (let i = 0; i < ev.length; i++) { const t = ev[i][0]; if (t > t0 && t <= t1) cb(ev[i][1], ev[i][2], ev[i]); } }
/** blend two finger pose arrays into out */
export function blendPose(a, b, e, out) { for (let i = 0; i < 25; i++) out[i] = a[i] + (b[i] - a[i]) * e; return out; }
