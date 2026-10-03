// LAST FERRY — atmospheres (one per stop). Each differs in palette, fog colour/density, sky, moon, weather, exposure/grade, lamp colour temperature.
export const ATMO = [
  { // 1 CITY PIER — sodium-orange mist over black harbour water, overcast, drizzle
    name: 'Last Ferry · City Pier',
    fog: { color: 0x16131a, scatter: 0x4a3a2c, density: 0.0115, falloff: 0.055, base: 0, power: 8 },
    sky: { zenith: 0x0a1424, horizon: 0x33261c, ground: 0x050403, gradPow: 1.7, sunColor: 0x8aa0cc, sunSize: 0.03, sunGlow: 0.1, disc: 0, stars: 0, cloud: 0.8, cloudColor: 0x0b0d13, cloudLit: 0x36405a, cloudSpeed: 0.004, cloudScale: 1.3, cloudDark: 0.5, horizonFog: 0.9 },
    sun: { dir: [-0.55, 0.5, -0.45], color: 0x92aad8, intensity: 2.0, shadow: true }, env: { intensity: 0.45 },
    exposure: 1.0, bloom: 0.36, vignette: 0.42, grain: 0.04, chroma: 0.002, ao: 0.8,
    grade: { sat: 1.05, contrast: 1.14, lift: [0.008, 0.005, 0.004], gain: [1.03, 1.0, 0.96], tint: [1.02, 1.0, 0.97] },
    autoExposure: { key: 0.1, min: 0.85, max: 1.5 }, wind: [2.4, 0, 1.0], wet: 0.8, reverb: 'open',
  },
  { // 2 FISH-MARKET WHARF — teal haze, neon pink/cyan/green, wet and slimy, steam
    name: 'Last Ferry · Fish-Market Wharf',
    fog: { color: 0x0a1a1e, scatter: 0x1d5a66, density: 0.0105, falloff: 0.05, base: 0, power: 6 },
    sky: { zenith: 0x050b12, horizon: 0x14262c, ground: 0x04070a, gradPow: 0.9, sunColor: 0x86c4e0, sunSize: 0.03, sunGlow: 0.15, disc: 0, stars: 0, cloud: 0.75, cloudColor: 0x0a141c, cloudLit: 0x2c4650, cloudSpeed: 0.005, cloudScale: 1.5, cloudDark: 0.5, horizonFog: 0.9 },
    sun: { dir: [-0.5, 0.5, 0.55], color: 0x8cc6d8, intensity: 1.35, shadow: true }, env: { intensity: 0.5 },
    exposure: 1.0, bloom: 0.42, vignette: 0.4, grain: 0.04, chroma: 0.0028, ao: 0.8,
    grade: { sat: 1.12, contrast: 1.14, lift: [0.0, 0.006, 0.01], gain: [0.98, 1.02, 1.04], tint: [0.98, 1.02, 1.03] },
    autoExposure: { key: 0.1, min: 0.85, max: 1.35 }, wind: [1.6, 0, -1.2], wet: 0.95, reverb: 'open',
  },
  { // 3 ISLAND PRISON DOCK — cold mercury/sodium, greenish-grey concrete, clear-ish air, hard moon shadows, searchlights
    name: 'Last Ferry · Island Prison Dock',
    fog: { color: 0x141c1a, scatter: 0x7d9a90, density: 0.0085, falloff: 0.06, base: 0, power: 5 },
    sky: { zenith: 0x05080d, horizon: 0x1a2622, ground: 0x040606, gradPow: 0.6, sunColor: 0xcfe4ee, sunSize: 0.03, sunGlow: 0.3, disc: 2, stars: 0.35, cloud: 0.35, cloudColor: 0x101816, cloudLit: 0x6a8a84, cloudSpeed: 0.003, cloudScale: 1.6, cloudDark: 0.5, horizonFog: 0.75 },
    sun: { dir: [0.45, 0.65, 0.5], color: 0xb0c8dc, intensity: 2.2, shadow: true }, env: { intensity: 0.38 },
    exposure: 1.0, bloom: 0.42, vignette: 0.46, grain: 0.045, chroma: 0.0018, ao: 0.85,
    grade: { sat: 0.82, contrast: 1.2, lift: [0.0, 0.006, 0.004], gain: [0.96, 1.02, 1.0], tint: [0.97, 1.02, 1.0] },
    autoExposure: { key: 0.1, min: 0.85, max: 1.25 }, wind: [4.0, 0, 1.6], wet: 0.5, reverb: 'open',
  },
  { // 4 LIGHTHOUSE ROCK — storm: deep blue-black, white foam, wind-driven rain, warm beam
    name: 'Last Ferry · Lighthouse Rock',
    fog: { color: 0x090f17, scatter: 0x3a5573, density: 0.0135, falloff: 0.035, base: 0, power: 4 },
    sky: { zenith: 0x03060a, horizon: 0x0e1822, ground: 0x030509, gradPow: 0.5, sunColor: 0x8aa4d0, sunSize: 0.03, sunGlow: 0.25, disc: 0, stars: 0, cloud: 1.0, cloudColor: 0x090d14, cloudLit: 0x27384c, cloudSpeed: 0.012, cloudScale: 1.2, cloudDark: 0.6, horizonFog: 0.85 },
    sun: { dir: [0.55, 0.55, -0.4], color: 0x9ab0d4, intensity: 3.0, shadow: true }, env: { intensity: 0.5 },
    exposure: 1.0, bloom: 0.46, vignette: 0.46, grain: 0.05, chroma: 0.0024, ao: 0.8, lightning: 0,
    grade: { sat: 0.95, contrast: 1.16, lift: [0.0, 0.004, 0.012], gain: [0.96, 1.0, 1.06], tint: [0.96, 1.0, 1.05] },
    autoExposure: { key: 0.1, min: 0.85, max: 1.5 }, wind: [9.0, 0, 4.0], wet: 1.0, reverb: 'open',
  },
];
// IBL colour patches: ONLY near-zenith soft fills. Low/horizontal coloured patches mirror on wet ground and water as hard-edged flat rectangles, so all coloured spill comes from real lights + reflected glares instead.
export const ENV = [
  [{ dir: [0, 1, 0], color: 0x6a86c0, size: 7, intensity: 0.4 }, { dir: [0.2, 0.8, 0.3], color: 0xff9a4a, size: 4, intensity: 0.12 }],
  [{ dir: [0, 1, 0], color: 0x5a9ab0, size: 7, intensity: 0.35 }, { dir: [0.3, 0.8, 0.2], color: 0xff3fb0, size: 4, intensity: 0.1 }],
  [{ dir: [0, 1, 0], color: 0xb0c8dc, size: 7, intensity: 0.45 }],
  [{ dir: [0, 1, 0], color: 0x6a86b0, size: 7, intensity: 0.4 }],
];
