// MV CHARON — detail pass (round 2): real-torus life rings, panelled saloon (wainscot boards, skirting, chair rail, ceiling beams, lamp housings, pendant shades,
// grab poles, hanging straps, luggage rails), lit portholes, funnel badge + ladder + guys. Everything is batched into the ferry's Builder (no extra draw calls beyond new materials).
import { std } from '../../core/mats.js';
import { canvasTexture } from '../../core/canvas2d.js';
import { halfWidth, keelY, sectionF } from './ferryPhys.js';
import { fitTex } from './kit.js';
const P = Math.PI;

export function addFerryDetail(B, M, C) {
  const { teak, whitePlain, chrome, brass, steelDark, paintRed, lifeRing, lampCold, frameDark, orange } = M; M.rope = M.rope || M.chrome; const { SX, Z0, Z1, SH, halos, RA } = C;
  const portGlow = B.m('portGlow', std({ color: 0x000000, emissive: 0xffc070, emissiveIntensity: 1.7, roughness: 0.3 }));
  const trimWood = B.m('trimWood', std({ color: 0x4a2c14, roughness: 0.5 }));
  // ---------------------------------------------------------------- life rings: real tori (white body, four red bands as tube arcs, brass wall hooks)
  const ring = (cx, cy, cz, a, b, R = 0.3, r = 0.072) => {
    const pt = (t) => [cx + (a[0] * Math.cos(t) + b[0] * Math.sin(t)) * R, cy + (a[1] * Math.cos(t) + b[1] * Math.sin(t)) * R, cz + (a[2] * Math.cos(t) + b[2] * Math.sin(t)) * R];
    const arc = (t0, t1, rr, mat, n, closed) => B.tube({ pts: Array.from({ length: closed ? n : n + 1 }, (_, i) => pt(t0 + (t1 - t0) * i / n)), r: rr, mat, seg: 10, segs: n * 2, closed, cast: false });
    arc(0, P * 2, r, lifeRing, 28, true); for (let i = 0; i < 4; i++) { const t0 = i * P / 2 + P / 8; arc(t0, t0 + P / 4, r * 1.07, paintRed, 6, false); }
    const h = pt(P / 2); B.box({ p: [h[0], h[1] - 0.04, h[2]], s: [0.05, 0.1, 0.05], mat: brass, bevel: 0.005, cast: false });
  };
  for (const [x, z] of [[-SX - 0.1, -1.4], [-SX - 0.1, 4.0], [SX + 0.1, -3.4], [SX + 0.1, 4.1]]) ring(x, 0.68, z, [0, 0, 1], [0, 1, 0]);
  ring(-1.35, 1.25, Z1 + 0.1, [1, 0, 0], [0, 1, 0]); ring(1.35, 1.25, Z1 + 0.1, [1, 0, 0], [0, 1, 0]);
  // ---------------------------------------------------------------- saloon panelling: vertical tongue-and-groove boards up to the window sills, chair rail, skirting
  const bw = 0.14, X0 = SX - 0.085, ZF = Z0 + 0.085, ZA = Z1 - 0.085;
  for (let z = Z0 + 0.16; z < Z1 - 0.1; z += bw) { B.box({ p: [-X0, 0.06, z], s: [0.024, 0.92, bw - 0.014], mat: teak, bevel: 0, cast: false }); if (z < 0.48 || z > 1.72) B.box({ p: [X0, 0.06, z], s: [0.024, 0.92, bw - 0.014], mat: teak, bevel: 0, cast: false }); }
  for (let x = -SX + 0.2; x < SX - 0.15; x += bw) { B.box({ p: [x, 0.06, ZF], s: [bw - 0.014, 0.92, 0.024], mat: teak, bevel: 0, cast: false }); if (Math.abs(x) > 0.66) B.box({ p: [x, 0.06, ZA], s: [bw - 0.014, 0.92, 0.024], mat: teak, bevel: 0, cast: false }); }
  const rail = (x0, z0, x1, z1, y, h, d, mat) => { const L = Math.hypot(x1 - x0, z1 - z0); if (L < 0.05) return; B.beam([x0, y, z0], [x1, y, z1], d, h, { mat, bevel: 0.004, cast: false }); };
  for (const [y, h, d, mat] of [[0.985, 0.04, 0.06, trimWood], [0.03, 0.1, 0.05, trimWood]]) { rail(-X0, Z0 + 0.1, -X0, Z1 - 0.1, y, h, d, mat); rail(X0, Z0 + 0.1, X0, 0.5, y, h, d, mat); rail(X0, 1.7, X0, Z1 - 0.1, y, h, d, mat); rail(-SX + 0.1, ZF, SX - 0.1, ZF, y, h, d, mat); rail(-SX + 0.1, ZA, -0.6, ZA, y, h, d, mat); rail(0.6, ZA, SX - 0.1, ZA, y, h, d, mat); }
  // ---------------------------------------------------------------- ceiling: beams, lamp housings, pendant shades
  for (let z = Z0 + 0.55; z < Z1; z += 1.1) B.box({ p: [0, SH - 0.1, z], s: [SX * 2 - 0.12, 0.085, 0.1], mat: trimWood, bevel: 0.006, cast: false });
  B.box({ p: [0, SH - 0.095, (Z0 + Z1) / 2], s: [0.12, 0.075, Z1 - Z0 - 0.2], mat: trimWood, bevel: 0.006, cast: false });
  for (const [x, z] of [[-0.9, -3.0], [0.9, -3.0], [-0.9, 1.0], [0.9, 1.0], [-0.9, 4.3], [0.9, 4.3]]) { for (const sd of [-1, 1]) B.box({ p: [x + sd * 0.1, SH - 0.09, z], s: [0.02, 0.085, 1.0], mat: steelDark, bevel: 0.004, cast: false }); for (const sd of [-1, 1]) B.box({ p: [x, SH - 0.09, z + sd * 0.5], s: [0.22, 0.085, 0.02], mat: steelDark, bevel: 0.004, cast: false }); }
  for (const z of [-3.2, 2.9]) { B.cyl({ p: [-0.15, SH - 0.62, z], r: [0.2, 0.05], h: 0.2, seg: 14, mat: brass, cast: false }); B.cyl({ p: [-0.15, SH - 0.42, z], r: 0.012, h: 0.42, seg: 4, mat: steelDark, cast: false }); B.cyl({ p: [-0.15, SH - 0.635, z], r: 0.17, h: 0.012, seg: 14, mat: M.lampWarm, cast: false }); halos.add([-0.15, SH - 0.66, z], 0xffd090, 0.14, 0.7, 0, { mist: 0.3 }); }
  // ---------------------------------------------------------------- grab poles, ceiling hand rails with hanging straps, luggage rails over the benches
  for (const [x, z] of [[-1.25, -0.2], [-1.25, 0.5], [1.25, -0.4], [1.25, 2.0]]) B.cyl({ p: [x, 0.05, z], r: 0.022, h: SH - 0.12, seg: 8, mat: chrome, cast: false });
  for (const x of [-0.7, 0.7]) { B.tube({ pts: [[x, SH - 0.28, Z0 + 0.4], [x, SH - 0.28, (Z0 + Z1) / 2], [x, SH - 0.28, Z1 - 0.4]], r: 0.016, mat: chrome, seg: 6, segs: 6, cast: false }); for (let z = Z0 + 0.9; z < Z1 - 0.5; z += 0.85) { const pts = Array.from({ length: 8 }, (_, i) => { const t = i / 8 * P * 2; return [x + Math.sin(t) * 0.028, SH - 0.28 - 0.09 - 0.09 * Math.cos(t) * 1.2, z + Math.cos(t) * 0.0]; }); B.tube({ pts: [[x, SH - 0.29, z], [x + 0.04, SH - 0.42, z], [x, SH - 0.52, z], [x - 0.04, SH - 0.42, z]], r: 0.009, mat: M.vinyl, seg: 5, segs: 12, closed: true, cast: false }); } }
  for (const sd of [-1, 1]) { B.tube({ pts: [[sd * 1.72, 1.85, -4.6], [sd * 1.72, 1.85, 4.6]], r: 0.014, mat: brass, seg: 6, segs: 4, cast: false }); for (const z of [-4.5, -2.3, 0, 2.3, 4.5]) B.beam([sd * 1.72, 1.85, z], [sd * 1.86, 1.75, z], 0.02, 0.02, { mat: brass, bevel: 0, cast: false }); }
  // ---------------------------------------------------------------- portholes along the topsides (brass ring + warm lit glass), skipping the ramp opening
  for (let z = -9.6; z <= 10.2; z += 1.9) for (const sd of [-1, 1]) {
    if (sd === 1 && z > RA.z0 - 0.7 && z < RA.z1 + 0.7) continue; if (z < -7.4 && z > -10.2) continue; const y = -0.38, K = keelY(z), u = (y - K) / (0 - K), x = sd * (halfWidth(z) * sectionF(u) + 0.014);
    B.tube({ pts: Array.from({ length: 12 }, (_, i) => { const t = i / 12 * P * 2; return [x, y + Math.sin(t) * 0.125, z + Math.cos(t) * 0.125]; }), r: 0.02, mat: brass, seg: 6, segs: 24, closed: true, cast: false });
    B.cyl({ p: [x - sd * 0.004, y, z], r: 0.105, h: 0.012, seg: 12, roll: P / 2, anchor: 'center', mat: portGlow, cast: false });
  }
  // ---------------------------------------------------------------- funnel: company badge on the white band, ladder on the after side, guy wires to the roof, steam pipe bracket
  const badge = B.m('funBadge', std({ map: fitTex(canvasTexture(256, 256, (c, w, h) => { c.fillStyle = '#0e2a4a'; c.fillRect(0, 0, w, h); c.strokeStyle = '#e8c860'; c.lineWidth = 12; c.beginPath(); c.arc(w / 2, h / 2, w * 0.4, 0, P * 2); c.stroke(); c.fillStyle = '#f2eee0'; c.font = 'bold 150px "Arial Black", Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('H', w / 2, h / 2 + 8); }), 0.44, 0.44), roughness: 0.55, key: 'funBadge' }));
  for (const sd of [-1, 1]) B.box({ p: [sd * 0.94, SH + 1.72, 2.6], s: [0.03, 0.44, 0.44], mat: badge, bevel: 0, cast: false });
  for (const sd of [-1, 1]) B.cyl({ p: [sd * 0.14, SH + 0.12, 3.34], r: 0.014, h: 2.55, seg: 5, mat: steelDark, cast: false });
  for (let y = SH + 0.3; y < SH + 2.6; y += 0.28) B.cyl({ p: [0, y, 3.34], r: 0.01, h: 0.28, seg: 4, mat: steelDark, roll: P / 2, anchor: 'center', cast: false });
  for (const [x, z] of [[-1.5, 1.4], [1.5, 1.4], [-1.5, 3.9], [1.5, 3.9]]) B.cable([x, SH + 0.1, z], [x * 0.4, SH + 2.6, 2.6 + (z - 2.6) * 0.3], 0.03, 0.008, chrome, { n: 6 });
  // mushroom cowl vents (engine room supply) on the after deck: bolted base ring, cylindrical trunk, flared cowl with rolled lip
  for (const [vx, vz] of [[3.3, 6.5], [-3.3, 6.4]]) { B.cyl({ p: [vx, 0, vz], r: 0.26, h: 0.05, seg: 14, mat: steelDark, cast: false }); B.lathe({ p: [vx, 0.05, vz], profile: [[0.2, 0], [0.16, 0.05], [0.16, 0.5], [0.2, 0.58], [0.34, 0.86], [0.37, 1.04], [0.33, 1.1], [0.27, 1.02], [0.16, 0.9]], seg: 14, mat: paintRed, cast: true });
    for (let i = 0; i < 8; i++) { const a = i / 8 * P * 2; B.cyl({ p: [vx + Math.cos(a) * 0.23, 0.05, vz + Math.sin(a) * 0.23], r: 0.012, h: 0.025, seg: 5, mat: brass, cast: false }); } }
  // starboard lifeboat on davits above the after deck: planked hull (ellipsoid), gunwale, thwarts, canvas cover strip, davit arms + falls
  { const cx = 2.95, cy = 2.95, cz = 3.5, LB = 2.05; B.sphere({ p: [cx, cy, cz], r: 1, seg: 18, ps: 0.5, pitch: P, scale: [0.62, 0.55, LB], mat: whitePlain, cast: true });
    B.tube({ pts: Array.from({ length: 24 }, (_, i) => { const a = i / 24 * P * 2; return [cx + Math.cos(a) * 0.62, cy, cz + Math.sin(a) * LB]; }), r: 0.03, mat: teak, seg: 5, segs: 48, closed: true, cast: false });
    for (const dz of [-1.1, -0.35, 0.4, 1.15]) B.box({ p: [cx, cy - 0.28, cz + dz], s: [1.2, 0.05, 0.22], mat: teak, bevel: 0.01, cast: false });
    B.sphere({ p: [cx, cy, cz], r: 1, seg: 14, ps: 0.2, scale: [0.6, 0.32, LB - 0.5], mat: orange, cast: true });
    for (const dz of [-1.35, 1.35]) { B.tube({ pts: [[2.0, 2.42, cz + dz], [2.15, 3.55, cz + dz], [2.6, 4.15, cz + dz], [2.95, 3.95, cz + dz]], r: 0.04, mat: steelDark, seg: 6, segs: 16, cast: true }); B.cyl({ p: [2.0, 2.4, cz + dz], r: 0.09, h: 0.16, seg: 8, mat: steelDark, cast: false }); B.tube({ pts: [[2.95, 3.95, cz + dz], [2.95, 3.45, cz + dz], [2.95, cy + 0.02, cz + dz * 0.75]], r: 0.009, mat: M.rope, seg: 4, segs: 8, cast: false }); B.sphere({ p: [2.95, 3.97, cz + dz], r: 0.06, mat: steelDark, seg: 8, cast: false }); } }
  // benches: stitched seat seams, upholstery buttons on the backs, cast end frames; wheelhouse binnacle + engine-order telegraph; strake weld beads; raft canister bands + cradles
  for (const [bxx, bz0, bz1, fc] of [[-1.55, -4.6, -0.2, 1], [-1.55, 0.5, 4.6, 1], [1.55, -4.6, -0.6, -1], [1.55, 2.0, 4.6, -1]]) { for (let z = bz0 + 0.55; z < bz1 - 0.2; z += 0.55) B.box({ p: [bxx, 0.536, z], s: [0.46, 0.006, 0.012], mat: steelDark, bevel: 0, cast: false });
    for (let z = bz0 + 0.3; z < bz1 - 0.2; z += 0.28) for (const by of [0.72, 0.88, 1.02]) B.sphere({ p: [bxx - fc * 0.22 + fc * 0.038, by, z], r: 0.017, mat: steelDark, seg: 5, cast: false });
    for (const ez of [bz0 - 0.03, bz1 + 0.03]) B.box({ p: [bxx, 0.02, ez], s: [0.56, 0.5, 0.05], mat: steelDark, bevel: 0.01, cast: false }); }
  { const WH0 = 2.55, WZ0 = -5.4; B.lathe({ p: [-0.6, WH0, WZ0 + 1.15], profile: [[0.16, 0], [0.14, 0.12], [0.11, 0.5], [0.15, 0.62], [0.17, 0.7], [0.14, 0.78], [0.08, 0.86], [0, 0.88]], seg: 14, mat: brass, cast: true });
    B.cyl({ p: [-1.25, WH0 + 1.03, WZ0 + 0.5], r: 0.05, h: 0.28, seg: 8, mat: brass, cast: false }); B.cyl({ p: [-1.25, WH0 + 1.33, WZ0 + 0.55], r: 0.17, h: 0.05, seg: 20, mat: brass, pitch: P / 2, anchor: 'center', cast: false }); B.beam([-1.25, WH0 + 1.33, WZ0 + 0.59], [-1.12, WH0 + 1.43, WZ0 + 0.59], 0.03, 0.03, { mat: brass, bevel: 0, cast: false });
    for (let i = 0; i < 24; i++) B.cyl({ p: [-1.3 + (i % 12) * 0.26, WH0 + 1.03, WZ0 + 0.32 + Math.floor(i / 12) * 0.13], r: 0.012, h: 0.03, seg: 6, mat: chrome, cast: false}); }
  for (const sd of [-1, 1]) for (const u of [0.6, 0.72, 0.84, 0.94]) { const pts = []; for (let z = -13.2; z <= 13.4; z += 0.6) { const W = halfWidth(z), K = keelY(z); pts.push([sd * (W * sectionF(u) + 0.004), K + u * (0 - K), z]); } B.tube({ pts, r: 0.006, mat: M.hullTop || steelDark, seg: 4, segs: pts.length * 2, cast: false }); }
  for (const [rx, rz] of [[-1.5, 0.9], [1.5, 2.1]]) { for (const dz of [-0.4, 0.4]) B.cyl({ p: [rx, SH + 0.36, rz + dz], r: 0.29, h: 0.05, seg: 12, mat: steelDark, pitch: P / 2, anchor: 'center', cast: false }); B.box({ p: [rx, SH + 0.08, rz], s: [0.62, 0.12, 1.2], mat: steelDark, bevel: 0.01, cast: false }); }
}
