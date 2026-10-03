// Offline audio analysis (pure JS — runs in Node and in the page). Used by tools/audio-analyze.mjs, tools/audio-lab.mjs and the audio sandbox.
// Everything works on Float32Array channel data. No DOM/canvas here: spectrogram images are returned as RGBA arrays.
import { biquadInPlace } from '../core/dsp.js';

// ------------------------------------------------------------------------------------------------ FFT
const _tw = new Map();
function tw(n) {
  let t = _tw.get(n); if (t) return t; const c = new Float64Array(n >> 1), s = new Float64Array(n >> 1), rev = new Uint32Array(n), bits = Math.round(Math.log2(n));
  for (let i = 0; i < n >> 1; i++) { c[i] = Math.cos(-2 * Math.PI * i / n); s[i] = Math.sin(-2 * Math.PI * i / n); }
  for (let i = 0; i < n; i++) { let r = 0, x = i; for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
  t = { c, s, rev }; _tw.set(n, t); return t;
}
/** In-place radix-2 complex FFT (re, im: Float64Array/Float32Array, power-of-two length). */
export function fft(re, im) {
  const n = re.length, { c, s, rev } = tw(n);
  for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= n; size <<= 1) { const half = size >> 1, step = n / size; for (let i = 0; i < n; i += size) for (let j = 0, k = 0; j < half; j++, k += step) { const a = i + j, b = a + half, wr = c[k], wi = s[k], tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; } }
}
const _hann = new Map();
const hann = (n) => { let w = _hann.get(n); if (!w) { w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); _hann.set(n, w); } return w; };

// ------------------------------------------------------------------------------------------------ level statistics
/** peak, rms, crest, clipping (|x|>=0.999), silence (fraction below -80 dB), head/tail silence ms, DC */
export function levelStats(x, sr) {
  const n = x.length; let pk = 0, s2 = 0, clip = 0, quiet = 0, dc = 0, nan = 0;
  for (let i = 0; i < n; i++) { const v = x[i]; if (v !== v) { nan++; continue; } const a = v < 0 ? -v : v; if (a > pk) pk = a; s2 += v * v; if (a >= 0.999) clip++; if (a < 1e-4) quiet++; dc += v; }
  let head = 0; while (head < n && Math.abs(x[head]) < 1e-3) head++; let tail = 0; while (tail < n && Math.abs(x[n - 1 - tail]) < 1e-3) tail++;
  const rms = Math.sqrt(s2 / Math.max(1, n));
  return { n, dur: n / sr, peak: pk, peakDb: 20 * Math.log10(pk + 1e-12), rms, rmsDb: 20 * Math.log10(rms + 1e-12), crestDb: 20 * Math.log10((pk + 1e-12) / (rms + 1e-12)), clip, clipFrac: clip / n, quietFrac: quiet / n, headMs: head / sr * 1000, tailMs: tail / sr * 1000, dc: dc / Math.max(1, n), nan };
}
/** Welch-averaged power spectrum: returns {f: Float64Array(bins), p: Float64Array(bins)} */
export function welch(x, sr, size = 2048, i0 = 0, i1 = x.length) {
  const w = hann(size), re = new Float64Array(size), im = new Float64Array(size), bins = size / 2 + 1, p = new Float64Array(bins); let cnt = 0; const hop = size / 2;
  for (let s = i0; s + size <= i1 || (s === i0 && cnt === 0); s += hop) { for (let i = 0; i < size; i++) { re[i] = (s + i < i1 ? x[s + i] : 0) * w[i]; im[i] = 0; } fft(re, im); for (let k = 0; k < bins; k++) p[k] += re[k] * re[k] + im[k] * im[k]; cnt++; if (s + size > i1) break; }
  const f = new Float64Array(bins); for (let k = 0; k < bins; k++) { f[k] = k * sr / size; p[k] /= Math.max(1, cnt); } return { f, p };
}
const _A = (f) => { const f2 = f * f, a = 12194 * 12194 * f2 * f2 / ((f2 + 20.6 * 20.6) * Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)) * (f2 + 12194 * 12194)); return a; };
const A1K = _A(1000);
/** A-weighting power gain (1 at 1 kHz) */
export const aw = (f) => { const a = _A(Math.max(f, 1)) / A1K; return a * a; };
/** spectral centroid (Hz), A-weighted centroid, rolloff frequencies (85 %), and energy fractions in [lo,hi] Hz bands */
export function spectralStats(x, sr, i0 = 0, i1 = x.length) {
  const { f, p } = welch(x, sr, 2048, i0, i1); let tot = 0, wsum = 0, at = 0, aws = 0; for (let k = 1; k < f.length; k++) { tot += p[k]; wsum += p[k] * f[k]; const w = aw(f[k]); at += p[k] * w; aws += p[k] * w * f[k]; }
  let acc = 0, roll = 0; for (let k = 1; k < f.length; k++) { acc += p[k]; if (acc >= 0.85 * tot) { roll = f[k]; break; } }
  const band = (lo, hi) => { let e = 0; for (let k = 1; k < f.length; k++) if (f[k] >= lo && f[k] < hi) e += p[k]; return e / (tot || 1); };
  return { centroid: wsum / (tot || 1), acentroid: aws / (at || 1), aLevelDb: 10 * Math.log10(at / (tot || 1) + 1e-12), rolloff85: roll, lf: band(20, 250), mf: band(250, 2000), hf: band(2000, 6000), vhf: band(6000, 24000), band, f, p };
}
/** Schroeder backward integration; returns decay curve (dB) and RT60 estimates (s). Uses a linear fit between -5 dB and -(5+span) dB. */
export function rt60(x, sr, { i0 = 0, i1 = x.length, span = 30 } = {}) {
  const n = i1 - i0, edc = new Float64Array(n); let acc = 0; for (let i = n - 1; i >= 0; i--) { const v = x[i0 + i]; acc += v * v; edc[i] = acc; }
  const tot = edc[0] || 1e-30, db = new Float32Array(n); for (let i = 0; i < n; i++) db[i] = 10 * Math.log10(edc[i] / tot + 1e-30);
  const fit = (a, b) => { let i = 0; while (i < n && db[i] > a) i++; let j = i; while (j < n && db[j] > b) j++; if (j >= n || j - i < 8) return null; let sx = 0, sy = 0, sxx = 0, sxy = 0, m = 0; for (let k = i; k < j; k += 1) { const t = k / sr; sx += t; sy += db[k]; sxx += t * t; sxy += t * db[k]; m++; } const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx); return slope < 0 ? -60 / slope : null; };
  const rt30 = fit(-5, -5 - span), rt20 = fit(-5, -25), edt = fit(0, -10);
  return { rt60: rt30 ?? (rt20 ?? edt ?? 0), t30: rt30, t20: rt20, edt, db, sr };
}
/** octave-band RT60 of an impulse-response-like signal (centres in Hz) */
export function rt60Bands(x, sr, centres = [125, 250, 500, 1000, 2000, 4000, 8000]) {
  return centres.map((fc) => { const y = Float32Array.from(x); biquadInPlace(y, 'bp', fc, 1.414, sr); biquadInPlace(y, 'bp', fc, 1.414, sr); const r = rt60(y, sr); return { fc, rt60: r.rt60, edt: r.edt }; });
}
/** Loop seam click (dB re file peak): peak 2nd difference across the wrap point, minus the largest 2nd difference found anywhere else in the loop (a real click is bigger than
 *  anything the signal does by itself). Returns dB (<= -40 is inaudible), -120 when the seam is no worse than the interior. */
export function seamClick(x, sr) {
  const n = x.length; if (n < 512) return -120; let pk = 1e-9; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(x[i]));
  const d2 = (i) => { const a = x[(i - 1 + n) % n], b = x[i % n], c = x[(i + 1) % n]; return c - 2 * b + a; };
  let interior = 0; for (let i = 64; i < n - 64; i++) { const v = Math.abs(d2(i)); if (v > interior) interior = v; }
  let seam = 0; for (let k = -3; k <= 3; k++) seam = Math.max(seam, Math.abs(d2(k < 0 ? n + k : k)));
  const excess = Math.max(0, seam - interior * 1.05); return excess <= 0 ? -120 : 20 * Math.log10(excess / pk);
}
/** Normalised-autocorrelation F0 tracker. Returns {f0: median Hz of voiced frames, voiced: fraction, track: Float32Array(Hz or 0)} */
export function f0Track(x, sr, { fmin = 60, fmax = 500, win = 0.04, hop = 0.01, thr = 0.45 } = {}) {
  const W = Math.floor(win * sr), H = Math.floor(hop * sr), lagMin = Math.floor(sr / fmax), lagMax = Math.min(W - 1, Math.floor(sr / fmin)), track = []; let pk = 0; for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
  for (let s = 0; s + W + lagMax <= x.length; s += H) {
    let e0 = 0; for (let i = 0; i < W; i++) e0 += x[s + i] * x[s + i]; if (e0 / W < (pk * 0.03) ** 2) { track.push(0); continue; }
    let best = 0, bl = 0; for (let l = lagMin; l <= lagMax; l++) { let c = 0, e1 = 0; for (let i = 0; i < W; i++) { c += x[s + i] * x[s + i + l]; e1 += x[s + i + l] * x[s + i + l]; } const r = c / Math.sqrt(e0 * e1 + 1e-20); if (r > best) { best = r; bl = l; } }
    track.push(best > thr ? sr / bl : 0);
  }
  const v = track.filter((t) => t > 0).sort((a, b) => a - b); return { f0: v.length ? v[v.length >> 1] : 0, voiced: v.length / Math.max(1, track.length), track: Float32Array.from(track), hop: hop };
}
/** LPC spectral-envelope formant peaks (F1..F4) at sample offset s (window w samples). */
export function lpcFormants(x, sr, s, w = 1024, order = 14, maxF = 5500) {
  const seg = new Float64Array(w); let mean = 0; for (let i = 0; i < w; i++) { mean += x[s + i] ?? 0; } mean /= w; for (let i = 0; i < w; i++) { const win = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (w - 1)); seg[i] = ((x[s + i] ?? 0) - mean) * win; }
  for (let i = w - 1; i > 0; i--) seg[i] -= 0.97 * seg[i - 1]; // pre-emphasis
  const r = new Float64Array(order + 1); for (let l = 0; l <= order; l++) { let a = 0; for (let i = 0; i + l < w; i++) a += seg[i] * seg[i + l]; r[l] = a; } r[0] *= 1.0001 + 1e-9;
  const a = new Float64Array(order + 1); a[0] = 1; let err = r[0]; if (err < 1e-12) return [];
  for (let i = 1; i <= order; i++) { let acc = r[i]; for (let j = 1; j < i; j++) acc += a[j] * r[i - j]; const k = -acc / err; const tmp = a.slice(); for (let j = 1; j < i; j++) a[j] = tmp[j] + k * tmp[i - j]; a[i] = k; err *= 1 - k * k; if (err <= 0) break; }
  const N = 256, env = new Float64Array(N); for (let k = 0; k < N; k++) { const om = Math.PI * k / N; let re = 1, im = 0; for (let j = 1; j <= order; j++) { re += a[j] * Math.cos(om * j); im -= a[j] * Math.sin(om * j); } env[k] = 1 / (re * re + im * im + 1e-30); }
  const out = []; for (let k = 2; k < N - 1; k++) { if (env[k] > env[k - 1] && env[k] >= env[k + 1]) { const f = k * sr / 2 / N; if (f < maxF && f > 150) out.push({ f, db: 10 * Math.log10(env[k]) }); } }
  return out.slice(0, 5);
}

// ------------------------------------------------------------------------------------------------ spectrogram image
const INFERNO = [[0, 0, 0, 4], [0.14, 31, 12, 72], [0.29, 85, 15, 109], [0.43, 136, 34, 106], [0.57, 186, 54, 85], [0.71, 227, 89, 51], [0.86, 249, 149, 10], [0.93, 249, 200, 50], [1, 252, 255, 164]];
export function colormap(t, out, o = 0) {
  t = t < 0 ? 0 : t > 1 ? 1 : t; let i = 0; while (i < INFERNO.length - 2 && t > INFERNO[i + 1][0]) i++; const a = INFERNO[i], b = INFERNO[i + 1], u = (t - a[0]) / (b[0] - a[0]);
  out[o] = a[1] + (b[1] - a[1]) * u; out[o + 1] = a[2] + (b[2] - a[2]) * u; out[o + 2] = a[3] + (b[3] - a[3]) * u; out[o + 3] = 255;
}
/** STFT magnitude in dB -> RGBA image (w x h). log-frequency axis fmin..fmax, top = high freq. Includes a waveform strip (waveH px) at the top. */
export function spectrogram(x, sr, { w = 400, h = 200, fmin = 40, fmax = Math.min(20000, sr / 2), size = 1024, range = 80, waveH = 28, t0 = 0, t1 = null } = {}) {
  const i0 = Math.floor(t0 * sr), i1 = t1 == null ? x.length : Math.min(x.length, Math.floor(t1 * sr)), n = Math.max(1, i1 - i0), hop = Math.max(64, Math.floor((n - size) / Math.max(1, w - 1))), win = hann(size), re = new Float64Array(size), im = new Float64Array(size), bins = size / 2;
  const img = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { img[i * 4 + 3] = 255; }
  const specH = h - waveH, cols = new Float32Array(w * bins); let gmax = 1e-20;
  for (let c = 0; c < w; c++) { const s = i0 + c * hop; if (s > i1) { for (let k = 0; k < bins; k++) cols[c * bins + k] = 0; continue; } for (let i = 0; i < size; i++) { re[i] = (x[s + i] ?? 0) * win[i]; im[i] = 0; } fft(re, im); for (let k = 0; k < bins; k++) { const m = re[k] * re[k] + im[k] * im[k]; cols[c * bins + k] = m; if (m > gmax) gmax = m; } }
  const lf0 = Math.log(fmin), lf1 = Math.log(fmax), tmp = new Uint8ClampedArray(4);
  for (let c = 0; c < w; c++) for (let r = 0; r < specH; r++) {
    const fA = Math.exp(lf1 - (lf1 - lf0) * (r / specH)), fB = Math.exp(lf1 - (lf1 - lf0) * ((r + 1) / specH)), kA = Math.max(1, Math.floor(fB / sr * size)), kB = Math.min(bins - 1, Math.max(kA, Math.ceil(fA / sr * size)));
    let m = 0; for (let k = kA; k <= kB; k++) m = Math.max(m, cols[c * bins + k]); const db = 10 * Math.log10(m / gmax + 1e-12); colormap(1 + db / range, tmp); const o = ((r + waveH) * w + c) * 4; img[o] = tmp[0]; img[o + 1] = tmp[1]; img[o + 2] = tmp[2];
  }
  // waveform strip (peak envelope, mirrored)
  for (let c = 0; c < w; c++) { const a = i0 + Math.floor(c * n / w), b = i0 + Math.floor((c + 1) * n / w); let mx = 0; for (let i = a; i < b; i++) { const v = Math.abs(x[i]); if (v > mx) mx = v; } const hh = Math.round(mx * (waveH / 2 - 1)); for (let r = waveH / 2 - hh; r <= waveH / 2 + hh; r++) { const o = (r * w + c) * 4; img[o] = 90; img[o + 1] = 200; img[o + 2] = 255; } }
  for (let c = 0; c < w; c++) { const o = ((waveH >> 1) * w + c) * 4; if (img[o] === 0) { img[o] = 40; img[o + 1] = 60; img[o + 2] = 80; } }
  return { data: img, w, h, hop, dur: n / sr };
}
// 5x7 bitmap font (ASCII 32..126, 5 column bytes per glyph, LSB = top row) for labels
const CH = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
const FONTB = (() => { const h = '000000000000005F00000007000700147F147F14242A7F2A12231308646236495620500008070300001C2241000041221C002A1C7F1C2A08083E080800807030000808080808000060600020100804023E5149453E00427F400072494949462141494D331814127F1027454545393C4A49493141211109073649494936464949291E0000140000004034000000081422411414141414004122140802015909063E415D594E7C1211127C7F494949363E414141227F4141413E7F494949417F090909013E414151737F0808087F00417F41002040413F017F081422417F404040407F021C027F7F0408107F3E4141413E7F090909063E4151215E7F09192946264949493203017F01033F4040403F1F2040201F3F4038403F631408146303047804036159494D43007F4141410204081020004141417F04020102044040404040000307080020545478407F284444383844444428384444287F385454541800087E090218A4A49C787F0804047800447D40002040403D007F1028440000417F40007C047804787C080404783844444438FC1824241818242418FC7C08040408485454542404043F44243C4040207C1C2040201C3C4030403C44281028444C9090907C4464544C440008364100000077000000413608000201020402', o = []; for (let i = 0; i < h.length; i += 2) o.push(parseInt(h.substr(i, 2), 16)); return o; })();
/** draw text into an RGBA image (scale 1 = 5x7 px glyphs) */
export function drawText(img, w, h, x, y, text, rgb = [255, 255, 255], scale = 1, shadow = true) {
  const put = (px, py, c) => { if (px < 0 || py < 0 || px >= w || py >= h) return; const o = (py * w + px) * 4; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; img[o + 3] = 255; };
  let cx = x; for (const ch of String(text)) { const gi = CH.indexOf(ch); if (gi >= 0) { for (let col = 0; col < 5; col++) { const b = FONTB[gi * 5 + col] ?? 0; for (let row = 0; row < 8; row++) if (b & (1 << row)) for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) { if (shadow) put(cx + col * scale + sx + 1, y + row * scale + sy + 1, [0, 0, 0]); } } for (let col = 0; col < 5; col++) { const b = FONTB[gi * 5 + col] ?? 0; for (let row = 0; row < 8; row++) if (b & (1 << row)) for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) put(cx + col * scale + sx, y + row * scale + sy, rgb); } } cx += 6 * scale; }
  return cx;
}
/** compose a labelled contact sheet: items = [{name, x (Float32Array), sr, note}] -> RGBA {data,w,h} with `cols` columns */
export function contactSheet(items, { cols = 3, tileW = 400, tileH = 190, labelH = 20, fmax = 20000, range = 80 } = {}) {
  const rows = Math.ceil(items.length / cols), W = cols * tileW, H = rows * (tileH + labelH), img = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < W * H; i++) { img[i * 4] = 12; img[i * 4 + 1] = 12; img[i * 4 + 2] = 16; img[i * 4 + 3] = 255; }
  items.forEach((it, i) => {
    const cx = (i % cols) * tileW, cy = Math.floor(i / cols) * (tileH + labelH), sp = spectrogram(it.x, it.sr, { w: tileW - 2, h: tileH, fmax, range });
    for (let r = 0; r < tileH; r++) for (let c = 0; c < tileW - 2; c++) { const o = (r * sp.w + c) * 4, d = ((cy + labelH + r) * W + cx + c) * 4; img[d] = sp.data[o]; img[d + 1] = sp.data[o + 1]; img[d + 2] = sp.data[o + 2]; }
    drawText(img, W, H, cx + 3, cy + 2, it.name, [255, 255, 255]); if (it.note) drawText(img, W, H, cx + 3, cy + 11, it.note, [170, 200, 255]);
    // frequency guides (1k, 10k) and time guides
    const lf0 = Math.log(40), lf1 = Math.log(Math.min(fmax, it.sr / 2)); for (const f of [100, 1000, 10000]) { if (f > it.sr / 2 || f > fmax) continue; const r = Math.round((1 - (Math.log(f) - lf0) / (lf1 - lf0)) * (tileH - 28)) + 28; for (let c = 0; c < tileW - 2; c += 4) { const d = ((cy + labelH + r) * W + cx + c) * 4; img[d] = 90; img[d + 1] = 90; img[d + 2] = 90; } drawText(img, W, H, cx + tileW - 32, cy + labelH + r - 8, f >= 1000 ? f / 1000 + 'k' : String(f), [160, 160, 160], 1, false); }
    drawText(img, W, H, cx + tileW - 40, cy + 2, it.x.length / it.sr >= 10 ? (it.x.length / it.sr).toFixed(0) + 's' : (it.x.length / it.sr).toFixed(2) + 's', [255, 220, 120]);
  });
  return { data: img, w: W, h: H };
}
/** plot 1..n curves as an RGBA line chart (used for RT60 / decay curves). series=[{name, y:Float32Array|Array, color}] over x range. */
export function plotLines(series, { w = 800, h = 300, xmin = 0, xmax = 1, ymin = -80, ymax = 0, title = '', xlabel = 's', grid = 4 } = {}) {
  const img = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { img[i * 4] = 14; img[i * 4 + 1] = 14; img[i * 4 + 2] = 18; img[i * 4 + 3] = 255; }
  for (let g = 0; g <= grid; g++) { const gy = Math.round(g * (h - 30) / grid) + 22; for (let c = 30; c < w; c += 2) { const o = (gy * w + c) * 4; img[o] = img[o + 1] = img[o + 2] = 60; } drawText(img, w, h, 2, gy - 3, String(Math.round(ymax - (ymax - ymin) * g / grid)), [150, 150, 150], 1, false); }
  drawText(img, w, h, 34, 4, title, [255, 255, 255]);
  series.forEach((s, si) => { const col = s.color || [[255, 120, 80], [90, 200, 255], [130, 255, 130], [255, 220, 90], [220, 130, 255], [255, 255, 255]][si % 6]; const n = s.y.length; let lastR = -1; for (let c = 30; c < w; c++) { const t = xmin + (xmax - xmin) * (c - 30) / (w - 30), idx = Math.min(n - 1, Math.max(0, Math.floor((t - (s.x0 || 0)) * (s.rate || 1)))); const v = s.y[idx]; const r = Math.round((1 - (v - ymin) / (ymax - ymin)) * (h - 30)) + 22; if (r >= 22 && r < h) { for (let rr = Math.min(r, lastR < 0 ? r : lastR); rr <= Math.max(r, lastR < 0 ? r : lastR); rr++) { if (rr < 22 || rr >= h) continue; const o = (rr * w + c) * 4; img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2]; } lastR = r; } } drawText(img, w, h, w - 150, 6 + si * 9, s.name || '', col, 1, false); });
  return { data: img, w, h };
}

// ------------------------------------------------------------------------------------------------ loudness (ITU-R BS.1770-4 / EBU R128, 48 kHz coefficients)
/** K-weighted loudness of a stereo signal: integrated (absolute -70 LUFS + relative -10 LU gates), momentary max (400 ms), short-term max (3 s), loudness range (10th..95th percentile of short-term, -20 LU gate). */
export function lufs(L, R, sr = 48000) {
  const kw = (x) => { const n = x.length, y = new Float64Array(n); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < n; i++) { const v = x[i], o = 1.53512485958697 * v - 2.69169618940638 * x1 + 1.19839281085285 * x2 + 1.69065929318241 * y1 - 0.73248077421585 * y2; x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o; }
    let p1 = 0, p2 = 0, q1 = 0, q2 = 0; for (let i = 0; i < n; i++) { const v = y[i], o = v - 2 * p1 + p2 + 1.99004745483398 * q1 - 0.99007225036621 * q2; p2 = p1; p1 = v; q2 = q1; q1 = o; y[i] = o; } return y; };
  const kl = kw(L), kr = kw(R || L), blk = Math.round(0.4 * sr), hop = Math.round(0.1 * sr), ms = [];
  for (let i = 0; i + blk <= kl.length; i += hop) { let a = 0, b = 0; for (let j = i; j < i + blk; j++) { a += kl[j] * kl[j]; b += kr[j] * kr[j]; } ms.push((a + b) / blk); }
  const lk = (m) => -0.691 + 10 * Math.log10(m + 1e-20), mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const abs = ms.filter((m) => lk(m) > -70), rel = lk(mean(abs)) - 10, gated = abs.filter((m) => lk(m) > rel), integrated = lk(mean(gated));
  const st = []; for (let i = 0; i + 30 <= ms.length; i += 10) st.push(lk(mean(ms.slice(i, i + 30)))); // 3 s windows, 1 s hop
  const stAbs = st.filter((v) => v > -70), stRel = lk(mean(stAbs.map((v) => Math.pow(10, (v + 0.691) / 10)))) - 20, lra = (() => { const g = stAbs.filter((v) => v > stRel).sort((a, b) => a - b); return g.length > 2 ? g[Math.floor(g.length * 0.95)] - g[Math.floor(g.length * 0.1)] : 0; })();
  return { integrated, momentaryMax: Math.max(...ms.map(lk)), shortTermMax: st.length ? Math.max(...st) : NaN, lra, shortTerm: st };
}

