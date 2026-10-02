// Shaping helpers for the ambience director. Dependency-free: `gustField` is deterministic, so visuals (swaying
// foliage) can follow exactly the gusts the audio plays when both evaluate it on the same clock.

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Gaussian bump centred on c with half-width w. */
export const bell = (v, c, w) => Math.exp(-((v - c) / w) * ((v - c) / w));
export const rand = (a, b) => a + (b - a) * Math.random();
/** Exponentially distributed wait (Poisson process) with the given mean. */
export const expWait = (mean) => -Math.log(1 - Math.random() * 0.999) * mean;

/** Gust strength G(t) in 0..1 with bursts roughly every 6-20 s. */
export function gustField(t) {
  const a = Math.sin(t * 0.21 + 1.3) * 0.5 + Math.sin(t * 0.537 + 0.2) * 0.3 + Math.sin(t * 1.31 + 2.1) * 0.2;
  const b = Math.sin(t * 0.083 + 4.1);
  const v = clamp01(0.5 + a * 0.55 + b * 0.2);
  return v * v * (3 - 2 * v);
}

/** Slowly wandering mean wind speed (m/s) for when the game does not drive the wind: 2.5..8.5 over minutes. */
export function windField(t) {
  const a = Math.sin(t * 0.0131 + 0.7) * 0.55 + Math.sin(t * 0.0337 + 2.9) * 0.3 + Math.sin(t * 0.0071 + 5.1) * 0.15;
  return 5.5 + 3 * a;
}
