// HSB finishes: registered into the shared gun-material library (materials.js DEFS) as 'h*' names. Same PBR bakers as the shared finishes, but
//  - 1024 px sets for the hero surfaces (texel <= 0.1 mm at tile 0.08 m),
//  - `detail` = amplitude of the engine's world-space micro-bump/roughness breakup layer. The default (1.0) is tuned for ground and walls and turns
//    a held gun into hammered tin at 25 cm, so guns use ~0.04 (keeps the specular anti-aliasing, drops the bump),
//  - tuned colours / roughness / wear per real finish.
import { GUN_MAT_DEFS as D } from './materials.js';
// NOTE: core patch() keys shader programs WITHOUT the numeric detail amplitude (only detail:false gets its own key), so materials that share the gun key but differ in
// `detail` would silently reuse whichever program compiled first (the held-gun 'hammered tin' look could come back depending on build order). The finish's own `cloth` value is part
// of the wear patch's program key and is a visual no-op at 0.001 x detail, so each amplitude gets its own program.
const derive = (name, base, o = {}) => { const d = { ...D[base], ...o }; if (typeof d.detail === 'number') d.cloth = d.detail * 0.001; D[name] = d; return name; };
const HD = 0.05; // ONE amplitude for all HSB finishes => the guns share (at most) two shader programs (plain + physical) instead of one per finish
derive('hPaint', 'akPaint', { size: 1024, bump: 0.11, colors: [0x18191c, 0x212327, 0x0f1012], rough: [0.5, 0.72], layers: { scratch: 0.22, grime: 0.05, oil: 0.06 }, p: [18, 0.3, 3, 0, 0.9, 0, 0, 20], bump: 0.42, wear: { color: [0.6, 0.6, 0.58], metal: 1, rough: 0.36, amount: 0.45, scale: 160 }, detail: HD });
derive('hPhos', 'parkerized', { size: 1024, bump: 0.06, colors: [0x3e423c, 0x494d46, 0x2f322e], rough: [0.4, 0.58], layers: { scratch: 0.18, oil: 0.12 }, wear: { color: [0.72, 0.72, 0.7], metal: 1, rough: 0.28, amount: 0.7, scale: 300 }, detail: HD });
derive('hBlue', 'blued', { size: 512, detail: HD, wear: { color: [0.8, 0.8, 0.82], metal: 1, rough: 0.22, amount: 0.8, scale: 300 } });
derive('hBlueWorn', 'bluedWorn', { size: 512, detail: HD });
derive('hCase', 'caseHard', { detail: HD, p: [34, 0, 0, 0, 0, 0, 0, 8] });
derive('hWalnut', 'walnut', { size: 1024, detail: HD });
derive('hWalnutLight', 'walnutLight', { size: 512, detail: HD });
derive('hLaminate', 'laminate', { size: 1024, detail: HD, colors: [0x33201a, 0x422a1f, 0x120a07] });
derive('hPlum', 'plum', { size: 512, detail: HD });
derive('hBake', 'bakeliteBlack', { size: 512, detail: HD, colors: [0x120d0b, 0x201814, 0x33200f] });
derive('hPolymer', 'polymer', { size: 512, bump: 0.14, detail: HD, wear: { color: [0.1, 0.1, 0.105], metal: 0, rough: 0.4, amount: 0.5 } });
derive('hSteelBright', 'steelBright', { detail: HD });
derive('hBrass', 'brassPolished', { detail: HD });
derive('hChrome', 'chrome', { size: 512, detail: HD });
derive('hCopper', 'copper', { detail: HD });
derive('hRed', 'redAnodized', { detail: HD });
derive('hRubber', 'rubber', { detail: HD });
derive('hOd', 'odPaint', { detail: HD });
derive('hShell', 'shellHull', { detail: HD });
derive('hKnurl', 'knurl', { detail: HD });
derive('hDrum', 'apertureDrum', { detail: HD, base: 'hKnurl', defocus: [0, 0.0465, 0.0015, 0.0078] });
