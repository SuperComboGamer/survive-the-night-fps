// The village chapel: whitewashed nave with a steep snow-laden roof, a square bell tower with an open belfry and a slate spire, a lit clock face,
// stained-glass lancet windows glowing red/amber/blue onto the snow, a small porch with lanterns. The tallest thing in the village: its steeple breaks
// the skyline above the chalets. Frame: u across, v along (v = 0 at the tower front, nave runs to +v), front faces -v.
import * as THREE from 'three';
import { Frame, quad, spillMaterial, spill, addIcicles } from './common.js';
import { roofSnow, skyOccluder } from './snowkit.js';
import { canvasTexture } from '../../core/canvas2d.js';
import { std } from '../../core/mats.js';
import { makeRng } from '../../core/util.js';

const P = Math.PI;
function stainedGlass(seed, { w = 256, h = 640 } = {}) {
  const rng = makeRng(seed * 19 + 3), pal = ['#c21a2a', '#2a56c8', '#e8a020', '#2c9a58', '#7a2a9c', '#d8d0b0'];
  return canvasTexture(w, h, (c) => {
    c.clearRect(0, 0, w, h); const arch = () => { c.beginPath(); c.moveTo(6, h - 4); c.lineTo(6, w / 2 + 4); c.arc(w / 2, w / 2 + 4, w / 2 - 6, P, 0); c.lineTo(w - 6, h - 4); c.closePath(); };
    c.save(); arch(); c.clip(); const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#ffe7b0'); g.addColorStop(1, '#ffb060'); c.fillStyle = g; c.fillRect(0, 0, w, h);
    const cols = 4, rows = 10; for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const x = i * w / cols, y = j * h / rows; c.fillStyle = pal[(rng() * pal.length) | 0]; c.globalAlpha = 0.72 + rng() * 0.28; c.beginPath(); c.moveTo(x + w / cols / 2, y); c.lineTo(x + w / cols, y + h / rows / 2); c.lineTo(x + w / cols / 2, y + h / rows); c.lineTo(x, y + h / rows / 2); c.closePath(); c.fill(); c.globalAlpha = 1; c.fillStyle = pal[(rng() * pal.length) | 0]; c.fillRect(x, y, 3, 3); }
    c.globalAlpha = 0.9; c.fillStyle = '#c21a2a'; c.fillRect(w / 2 - 12, h * 0.28, 24, h * 0.42); c.fillRect(w / 2 - 44, h * 0.38, 88, 22); c.globalAlpha = 1;
    c.strokeStyle = '#1a1410'; c.lineWidth = 5; for (let i = 0; i <= cols; i++) { c.beginPath(); c.moveTo(i * w / cols, 0); c.lineTo(i * w / cols, h); c.stroke(); } for (let j = 0; j <= rows; j++) { c.beginPath(); c.moveTo(0, j * h / rows); c.lineTo(w, j * h / rows); c.stroke(); }
    c.restore(); c.strokeStyle = '#2a2622'; c.lineWidth = 10; arch(); c.stroke();
  });
}
function clockTexture(w = 256) {
  return canvasTexture(w, w, (c) => {
    c.fillStyle = '#efe7d2'; c.beginPath(); c.arc(w / 2, w / 2, w / 2 - 4, 0, 7); c.fill(); c.strokeStyle = '#2a2018'; c.lineWidth = 10; c.stroke(); c.fillStyle = '#2a2018';
    for (let i = 0; i < 12; i++) { const a = i / 12 * 2 * P; c.save(); c.translate(w / 2, w / 2); c.rotate(a); c.fillRect(-4, -w / 2 + 16, 8, i % 3 ? 16 : 28); c.restore(); }
    c.save(); c.translate(w / 2, w / 2); c.lineCap = 'round'; c.strokeStyle = '#2a2018'; c.lineWidth = 10; c.rotate(-0.5 * P + 10 / 12 * 2 * P); c.beginPath(); c.moveTo(0, 0); c.lineTo(w * 0.28, 0); c.stroke(); c.restore();
    c.save(); c.translate(w / 2, w / 2); c.lineCap = 'round'; c.strokeStyle = '#2a2018'; c.lineWidth = 7; c.rotate(-0.5 * P + 2 / 12 * 2 * P); c.beginPath(); c.moveTo(0, 0); c.lineTo(w * 0.38, 0); c.stroke(); c.restore();
    for (let i = 0; i < 120; i++) { c.fillStyle = `rgba(230,240,250,${Math.random() * 0.25})`; c.fillRect(Math.random() * w, Math.random() * w, Math.random() * 14, 2); } });
}

export function chapel(ctx, B, M, halos, x, z, yaw) {
  const Ch = new Frame(B, x, z, yaw, 0); const spillM = spillMaterial(); const out = { Ch }; const gtex = {}; for (const k of [1, 2, 3, 4]) gtex[k] = stainedGlass(k);
  const glassMat = (k) => B.m('chGlass' + k, std({ color: 0x120a04, map: gtex[k], emissiveMap: gtex[k], emissive: 0xffffff, emissiveIntensity: 1.5, roughness: 0.3, alphaTest: 0.5, transparent: false }));
  const clockM = B.m('chClock', std({ color: 0x111111, map: clockTexture(), emissiveMap: clockTexture(), emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.5 }));
  const bronze = B.m('vBronze', std({ color: 0x8a5a2b, metalness: 0.9, roughness: 0.4 }));
  const TW = 4.0, TD = 3.6, TH = 9.4, NW = 6.0, NL = 9.0, NH = 4.4, ND = TD;            // tower width/depth/height; nave width/length/wall height
  // ---- plinth + walls (plaster over a stone base course)
  Ch.box({ p: [0, -0.5, TD / 2], s: [TW + 0.5, 0.55, TD + 0.5], mat: M.stone, bevel: 0.03, col: false, cast: false }); Ch.box({ p: [0, -0.5, ND + NL / 2], s: [NW + 0.5, 0.55, NL + 0.5], mat: M.stone, bevel: 0.03, col: false, cast: false });
  Ch.box({ p: [0, 0, TD / 2], s: [TW, TH, TD], mat: M.plaster, bevel: 0.03, col: 'rock' }); Ch.box({ p: [0, 0, ND + NL / 2], s: [NW, NH, NL], mat: M.plaster, bevel: 0.03, col: 'rock' });
  Ch.box({ p: [0, 0, TD / 2], s: [TW + 0.12, 1.0, TD + 0.12], mat: M.stone, bevel: 0.03, col: false, cast: false }); Ch.box({ p: [0, 0, ND + NL / 2], s: [NW + 0.12, 0.9, NL + 0.12], mat: M.stone, bevel: 0.03, col: false, cast: false });
  for (const su of [-1, 1]) for (const v of [ND + 2.2, ND + 4.5, ND + 6.8, ND + 9.0]) Ch.box({ p: [su * (NW / 2 + 0.15), 0, v], s: [0.5, NH - 0.5, 0.55], mat: M.stone, bevel: 0.03, col: false });   // buttresses
  Ch.box({ p: [0, TH, TD / 2], s: [TW + 0.5, 0.35, TD + 0.5], mat: M.stone, bevel: 0.04, col: false });
  // ---- belfry: four posts, louvred openings, the bell
  const by = TH + 0.35, bh = 2.6; for (const su of [-1, 1]) for (const sv of [0, 1]) Ch.box({ p: [su * (TW / 2 - 0.15), by, 0.15 + sv * (TD - 0.3)], s: [0.3, bh, 0.3], mat: M.beam, bevel: 0.03, col: false });
  Ch.box({ p: [0, by, TD / 2], s: [TW - 0.5, bh - 0.4, TD - 0.5], mat: M.dark, col: false, cast: false });
  for (const [ax, sg] of [['v', -1], ['v', 1], ['u', -1], ['u', 1]]) for (let i = 0; i < 6; i++) { const yy = by + 0.35 + i * 0.36; if (ax === 'v') Ch.box({ p: [0, yy, TD / 2 + sg * (TD / 2 - 0.05)], s: [TW - 0.6, 0.06, 0.16], pitch: -sg * 0.5, mat: M.timberV, col: false, cast: false }); else Ch.box({ p: [sg * (TW / 2 - 0.05), yy, TD / 2], s: [0.16, 0.06, TD - 0.6], roll: sg * 0.5, mat: M.timberV, col: false, cast: false }); }
  Ch.cyl({ p: [0, by + 0.55, TD / 2], r: [0.5, 0.22], h: 0.85, seg: 12, mat: bronze, col: false, cast: false }); Ch.cyl({ p: [0, by + 1.42, TD / 2], r: 0.05, h: 0.5, seg: 6, mat: M.iron, col: false, cast: false });
  Ch.box({ p: [0, by + bh, TD / 2], s: [TW + 0.4, 0.3, TD + 0.4], mat: M.beam, bevel: 0.03, col: false });
  // ---- spire: 8-sided slate pyramid, snow in the flutes, gilded cross + weathercock
  Ch.cyl({ p: [0, by + bh + 0.3, TD / 2], r: [2.55, 0.06], h: 6.4, seg: 8, mat: M.slate, yaw: P / 8, col: false }); Ch.cyl({ p: [0, by + bh + 0.3, TD / 2], r: [2.62, 2.5], h: 0.35, seg: 8, mat: M.beam, yaw: P / 8, col: false, cast: false });
  { const ty = by + bh + 6.7; Ch.box({ p: [0, ty, TD / 2], s: [0.07, 1.2, 0.07], mat: bronze, col: false, cast: false }); Ch.box({ p: [0, ty + 0.6, TD / 2], s: [0.55, 0.07, 0.07], mat: bronze, col: false, cast: false }); Ch.box({ p: [0, ty + 0.15, TD / 2], s: [0.5, 0.06, 0.06], mat: bronze, col: false, cast: false }); halos.add(Ch.p(0, ty + 0.7, TD / 2), 0xffd890, 0.5, 0.25, 0); }
  Ch.rock({ p: [0, by + bh + 0.5, TD / 2 - 1.9], r: 0.8, squash: [1.6, 0.25, 0.4], amp: 0.3, seed: 3, detail: 1, mat: M.snow, cast: false });
  // ---- nave roof (ridge along v), gable wall at the back, drifted snow, icicles
  { const N = new Frame(B, Ch.p(0, 0, ND + NL / 2)[0], Ch.p(0, 0, ND + NL / 2)[2], Ch.yaw - P / 2, 0), pitch = 0.98, ov = 0.7, hd = NW / 2, ridgeH = hd * Math.tan(pitch), ry = NH + 0.15, RH = ridgeH + ov * Math.tan(pitch) - 0.05;
    N.prism({ p: [0, ry, 0], s: [NL + 0.02, ridgeH - 0.05, NW + 0.04], mat: M.plaster }); N.prism({ p: [0, ry, 0], s: [NL + ov * 2, RH, NW + ov * 2], mat: M.shingle });
    roofSnow(B, M.snow, N, { w: NL, d: NW, ridgeY: ry + RH, pitch: Math.atan2(RH, hd + ov), ov, seed: 11, depth: 0.34 }); skyOccluder(B, N, -NL / 2 - ov, NL / 2 + ov, -hd - ov, hd + ov, NH, NH + 0.5);
    for (const sv of [-1, 1]) { const e0 = N.p(-NL / 2 - ov + 0.2, 0, sv * (hd + ov - 0.05)), e1 = N.p(NL / 2 + ov - 0.2, 0, sv * (hd + ov - 0.05)); addIcicles(B, M.ice, [e0[0], e0[2]], [e1[0], e1[2]], { seed: 40 + sv, y: ry - 0.1, minLen: 0.2, maxLen: 0.9 }); }
    out.roofTop = ry + RH; }
  // ---- stained glass: three lancets per nave side, rose-less back gable; warm spill on the snow
  const gk = [1, 2, 3, 4]; let gi = 0; const lit = [];
  for (const su of [-1, 1]) for (const v of [ND + 1.9, ND + 4.5, ND + 7.1]) {
    const gp = Ch.p(su * (NW / 2 + 0.03), 2.3, v); const nrm = [su * Ch.c, -su * Ch.s]; const q = Math.atan2(nrm[0], nrm[1]); quad(B, glassMat(gk[gi++ % 4]), gp, 1.15, 2.9, q); lit.push({ gp, nrm });
    Ch.box({ p: [su * (NW / 2 + 0.08), 0.6, v], s: [0.22, 0.14, 1.5], mat: M.stone, bevel: 0.02, col: false, cast: false });                                           // sill
    const sp = Ch.p(su * (NW / 2 + 2.4), 0.03, v); spill(B, spillM, sp[0], 0.03, sp[2], 3.4, 3.0, Ch.yaw + (su < 0 ? P / 2 : -P / 2), [0xffa050, 0xff5040, 0x6a8aff, 0xffb060][gi % 4]);
    halos.add(gp, 0xffc080, 0.9, 0.16, 0); }
  ctx.light({ pos: Ch.p(-NW / 2 - 2.2, 2.2, ND + 4.5), color: 0xffa860, intensity: 9, distance: 9, decay: 2 }); ctx.light({ pos: Ch.p(NW / 2 + 2.2, 2.2, ND + 4.5), color: 0xff8050, intensity: 9, distance: 9, decay: 2 });
  // ---- clock face + door + porch
  quad(B, clockM, Ch.p(0, 7.4, -0.05), 1.7, 1.7, Ch.yaw + P); Ch.cyl({ p: [0, 7.4 - 0.9, -0.03], r: 0.9, h: 0.05, seg: 20, mat: M.stone, pitch: P / 2, anchor: 'center', col: false, cast: false }); halos.add(Ch.p(0, 7.4, -0.5), 0xffe8b0, 1.3, 0.16, 0);
  Ch.box({ p: [0, 0, -0.04], s: [1.9, 2.9, 0.14], mat: M.timberV, bevel: 0.02, col: false, cast: false }); for (const yy of [0.5, 1.5, 2.4]) Ch.box({ p: [0, yy, -0.14], s: [1.7, 0.1, 0.05], mat: M.iron, col: false, cast: false });
  Ch.box({ p: [0, 2.9, -0.06], s: [2.5, 0.35, 0.3], mat: M.stone, bevel: 0.03, col: false, cast: false }); for (const su of [-1, 1]) Ch.box({ p: [su * 1.1, 0, -0.06], s: [0.3, 2.9, 0.3], mat: M.stone, bevel: 0.03, col: false, cast: false });
  for (let i = 0; i < 3; i++) Ch.box({ p: [0, -0.15 + 0, -0.5 - i * 0.42], s: [3.0, 0.16 * (3 - i) + 0.1, 0.5], mat: M.stone, bevel: 0.02, col: 'rock', cast: false });
  for (const su of [-1, 1]) { Ch.box({ p: [su * 1.8, 0, -1.6], s: [0.22, 3.4, 0.22], mat: M.beam, bevel: 0.03, col: 'wood' }); const lp = Ch.p(su * 1.35, 2.35, -0.3); halos.add(lp, 0xffc070, 0.7, 0.5, 0); Ch.box({ p: [su * 1.35, 2.2, -0.3], s: [0.16, 0.3, 0.16], mat: M.lampGlow, bevel: 0.02, col: false, cast: false }); }
  Ch.box({ p: [0, 3.4, -1.0], s: [4.2, 0.18, 2.4], mat: M.beam, pitch: 0.28, bevel: 0.03, col: false }); Ch.box({ p: [0, 3.55, -1.0], s: [4.4, 0.3, 2.5], mat: M.snow, pitch: 0.28, bevel: 0.14, col: false, cast: false });
  { const dp = Ch.p(0, 0.03, -3.2); spill(B, spillM, dp[0], 0.03, dp[2], 5.2, 4.6, Ch.yaw, 0xffb870); ctx.light({ pos: Ch.p(0, 2.6, -1.8), color: 0xffb060, intensity: 12, distance: 10, decay: 2, flicker: 0.05, flickerSpeed: 4 }); }
  // drifts banked against the windward flank
  for (const [u, v, l, h] of [[-3.9, ND + 3, 5, 0.9], [-3.6, ND + 8, 4, 0.7], [3.8, ND + 2, 4.5, 0.6]]) { const p = Ch.p(u, 0.1, v); B.rock({ p: [p[0], 0.1, p[2]], r: 1, squash: [l / 2, h, 1.2], amp: 0.3, seed: 60 + v, detail: 2, mat: M.snow, yaw: Ch.yaw + P / 2, cast: true, col: false }); }
  out.top = Ch.p(0, 20, TD / 2); out.bell = Ch.p(0, by + 1, TD / 2); out.door = Ch.p(0, 0, -2.4);
  return out;
}
