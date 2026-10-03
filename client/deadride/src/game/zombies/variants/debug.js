// Debug / anatomy reference variants (not used by maps).
import { registerVariants } from '../factory.js';

export const DEBUG_VARIANTS = [
  { id: 'debug_body', name: 'Anatomy (bare)', looks: 1, body: { skin: 0x6f7262, girth: 1, gaunt: 0.4, muscle: 0.4 },
    build(o) { o.body({ skin: 0x6f7262 }); } },
  { id: 'debug_clothed', name: 'Clothed test', looks: 1,
    build(o) { o.body({ skin: 0x6f7262 }); o.garment('shirt', { color: 0x6e6a58 }); o.garment('pants', { color: 0x2c3444 }); o.garment('boots', { color: 0x3a2a1c }); } },
];
registerVariants('debug', DEBUG_VARIANTS);
