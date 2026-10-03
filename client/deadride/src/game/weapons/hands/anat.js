// Hand / arm anatomy shared by the skeleton (hands.js) and the geometry builders. Adult male, gloved, metres.
// Rest pose (right arm): wrist at the origin, fingers along -Z, palm facing -Y (back of the hand +Y), thumb on the -X side, forearm along +Z.
// Reference: hand length (wrist crease -> middle fingertip) 19 cm, palm length (wrist -> middle MCP) 9.1 cm, breadth at the knuckles 8.6 cm,
// finger length ratio middle > ring > index > little, thumb tip reaches the index PIP joint, forearm 27 cm, upper arm 30 cm.
export const UPPER = 0.30, FORE = 0.27;
export const FING = [ // name, MCP [x,y,z], segment lengths (joint to joint, last to the tip), base/tip radius (gloved)
  { n: 'index', mcp: [-0.0262, 0.0012, -0.0875], len: [0.0395, 0.0240, 0.0215], r: [0.0106, 0.0091] },
  { n: 'middle', mcp: [-0.0072, 0.0020, -0.0912], len: [0.0430, 0.0268, 0.0225], r: [0.0109, 0.0093] },
  { n: 'ring', mcp: [0.0118, 0.0012, -0.0878], len: [0.0410, 0.0258, 0.0215], r: [0.0103, 0.0089] },
  { n: 'little', mcp: [0.0292, -0.0010, -0.0795], len: [0.0325, 0.0200, 0.0190], r: [0.0093, 0.0080] },
];
for (const f of FING) f.L = f.len[0] + f.len[1] + f.len[2];
export const THUMB = { cmc: [-0.0205, -0.0095, -0.0165], dir: [-0.56, -0.16, -0.81], up: [-0.62, 0.78, 0.0], len: [0.0460, 0.0320, 0.0290], r: [0.0132, 0.0104] };
THUMB.L = THUMB.len[0] + THUMB.len[1] + THUMB.len[2];
// bone indices within one arm (right). Left arm = +NB.
export const B = { upper: 0, fore: 1, hand: 2, t1: 3, t2: 4, t3: 5 };
for (let f = 0; f < 4; f++) for (let j = 0; j < 3; j++) B['f' + f + j] = 6 + f * 3 + j; // f00..f32 => 6..17
export const NB = 18;
