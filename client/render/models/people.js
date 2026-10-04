// A whole person from a look: the body (humans.js), what they wear, their hair, hat and kit. Survivors (the roster in
// shared/characters.js, the looks in looks.js) and the dead who were people (walkers, runners, the specials' bodies)
// are all built here.
//
// A look L (everything optional):
//   sex 'm' | 'f', build { w, d, sh, hips, belly, bust, arm, leg, gaunt, bloat, neck } (humans.js bodyBuild)
//   skin, eye (iris), face { w, h, jaw, chin, brow, cheek, lips, nose, noseL, noseW, ear, browT, browUp, fem, gaunt }
//   hair { style: short | buzz | fade | crop | bob | long | ponytail | bun | braid | balding | patchy, color, length }
//   beard { style: stubble | full | short | goatee | mustache, color }, brows (colour)
//   top { kind: tee | tank | shirt | flannel | jacket | coat | hoodie | scrubs | fleece, color, region, sleeves:
//         long | short | rolled | none, open (half angle of an open front, rad), under { color, region } (what shows
//         in it), collar: crew | v | shirt | jacket | high | hood, hem (m below the hip joint), zip, tint, tear }
//   vest { kind: hivis | blaze | down, color }, overalls { color }, coverall (top and trousers in one)
//   pants { color, region, cargo, shorts, tear, tearY }, shoes { kind: boot | work | sneaker | dress, color, sole }
//   hat { kind: cap | trucker | beanie | ranger | cowboy | hardhat | bandana, color, front }
//   gear { belt, buckle, holster, radio, badge, lanyard, gloves, glasses, toolbelt, patch, watch, knife }
//   dead: a corpse's version: dead skin and face, clothes torn (top.tear / pants.tear), blood (L.blood), dirt
//   wounds [[x, y, z, r]], missingArm 'L' | 'R', oneEye, noEar, cheekTear, skullPatch [dx, dy, dz, angle], claws,
//   fist (survivors: closed hands round what they hold)
import * as THREE from 'three';
import { mulberry32, fbm3, clamp, lerp, smooth, color } from './skinning.js';
import { CR } from './charTextures.js';
import { buildHumanHead, headSurface, headPoint, headShape, jawWeight, bodyBuild, torsoSurf, neckSurf, armSurf, legSurf, sheet, pillow, surfPoint } from './humans.js';

const PI = Math.PI;
const TAU = PI * 2;
const G = (x) => Math.exp(-x * x);
const sstep = (a, b, x) => smooth((x - a) / (b - a));
const C_BLOOD = color(0x3a0303);
const C_WOUND = color(0x4a0806);
const C_WOUND2 = color(0x8a2a20);

const bloodTint = (p, n, c) => {
  if (fbm3(p.x * 8, p.y * 8, p.z * 8, 2, 77) > 0.58) c.lerp(C_BLOOD, 0.6);
};

function woundTint(L, p, c) {
  if (!L.wounds) return;
  for (const w of L.wounds) {
    const d = Math.hypot(p.x - w[0], p.y - w[1], p.z - w[2]) / w[3];
    if (d < 1.4) {
      const nn = fbm3(p.x * 30, p.y * 30, p.z * 30, 2, 13);
      const t = clamp((1.1 - d - (nn - 0.5) * 0.7) * 3, 0, 1);
      if (t > 0) c.lerp(nn > 0.5 ? C_WOUND2 : C_WOUND, t);
      if (t >= 1 && nn < 0.4) c.lerp(color(0x0c0605), 0.6);
    }
  }
}

/** The skin's tint: wounds, a dead body's mottling, the look's own (L.skinTint). */
function skinTint(L) {
  return (p, n, c) => {
    if (L.dead) {
      const m = fbm3(p.x * 9, p.y * 9, p.z * 9, 2, 33);
      if (m > 0.6) c.lerp(color(0x4a3040), 0.35 * (m - 0.6) * 5);
    }
    woundTint(L, p, c);
    if (L.skinTint) L.skinTint(p, n, c);
  };
}

// a garment's tear (a dead body's clothes): random holes plus the look's own cut (fn)
// the detail the person in hand is built at (buildPerson): under 0.7 it is the far copy, and the small things go
let D = 1;
const FAR = () => D < 0.7;

function tearOf(g, seed, fn) {
  const amt = FAR() ? 0 : g.tear || 0; // (far away, no holes: nothing would be drawn under them)
  if (!amt && !fn) return null;
  return { amt, f: 13, seed, fn };
}

/** Everything in one: a person on the humanoid rig of characters.js (addHumanoidBones). Returns what the rig keeps. */
export function buildPerson(mb, P, L, detail = 1) {
  const B = bodyBuild(L);
  const dead = !!L.dead;
  D = detail;
  const rs = Math.max(10, Math.round((dead ? 16 : 22) * detail));
  const T = torsoSurf(mb, P, B);
  const N = neckSurf(mb, P, B);
  const arms = [armSurf(mb, P, B, -1), armSurf(mb, P, B, 1)];
  const legs = [legSurf(mb, P, B, -1), legSurf(mb, P, B, 1)];
  const skin = color(L.skin);
  const skinO = { color: skin, region: dead ? CR.ROT : CR.SKIN_H, mottle: dead ? 0.12 : 0.04, tint: skinTint(L) };
  const top = L.top || null, pants = L.pants || null;
  const cover = L.coverall;
  // ---- the cuts down the torso
  const yH = P.hipY, yS = P.spineY, yC = P.chestY, ySh = P.shoulderY;
  const rise = pants ? yH + (pants.rise ?? 0.065) : T.yLo;
  const hem = top ? yH - (top.hem ?? (top.kind === 'jacket' || top.kind === 'coat' ? 0.07 : top.tucked ? -0.06 : 0.035)) : rise;
  const collarY = ySh + (top && top.collar === 'v' ? 0.055 : 0.062);
  const pP = pants ? 0.006 + (pants.loose || 0) : 0;
  const thick = top ? (top.kind === 'jacket' || top.kind === 'coat' ? 0.014 : top.kind === 'hoodie' || top.kind === 'fleece' ? 0.012 : top.kind === 'flannel' || top.kind === 'shirt' ? 0.007 : 0.004) + (top.loose || 0) : 0;
  const pT = pP + thick; // the top over the trousers
  const nvT = (y0, y1) => Math.max(2, Math.round(((y1 - y0) / 0.034) * Math.min(1, detail * 1.2)));
  const nvL = (y0, y1) => Math.max(2, Math.round(((y1 - y0) / 0.048) * Math.min(1, detail * 1.2))); // (the limbs: long straight runs)
  // the skin under torn clothes: a dead body's torso is drawn under its rags
  if (dead && !FAR() && ((top && top.tear) || (pants && pants.tear) || !top)) {
    const y1 = top ? collarY : T.yHi;
    sheet(mb, T, 0, TAU, T.yLo, y1, Math.max(8, rs - 4), nvL(T.yLo, y1), 0, { ...skinO, cap0: 0.02 });
  }
  // ---- trousers (and a coverall's legs)
  const pantsCol = pants ? color(pants.color) : skin;
  const pantsO = pants ? { color: pantsCol, region: pants.region ?? CR.DENIM, mottle: 0.12, tint: pants.tint, tear: tearOf(pants, 71) } : skinO;
  if (pants && !(dead && !top && !pants)) {
    const yTop = top ? Math.max(rise, Math.min(rise, hem + 0.04)) : rise;
    sheet(mb, T, 0, TAU, T.yLo, yTop, rs, nvT(T.yLo, yTop), pP, { ...pantsO, cap0: 0.02, cap1: 0, normY: (y) => clamp(0.15 + (y - yH + 0.09) * 12, 0.15, 1) });
  }
  // the top over the trousers' waist
  const topCol = top ? color(top.color) : null;
  const topReg = top ? top.region ?? CR.COTTON : 0;
  const open = top && top.open ? top.open : 0;
  if (top) {
    const fnTop = top.collar === 'v' ? (x, y, z) => z < 0 && Math.abs(x) < (y - (ySh - 0.075)) * 0.55 : top.backOpen ? (x, y, z) => z > 0.04 && Math.abs(x) < 0.03 + (yC + 0.1 - y) * 0.12 : null;
    const topO = { color: topCol, region: topReg, mottle: 0.12, tint: top.tint, tear: tearOf(top, 31, fnTop) };
    const y0 = pants ? hem : T.yLo;
    if (open) {
      // an open front: the jacket round the sides and back, what is under it between
      sheet(mb, T, open, TAU - open, y0, collarY, rs - 4, nvT(y0, collarY), pT, topO);
      const u = top.under || { color: 0x3a3a38, region: CR.COTTON };
      sheet(mb, T, -open, open, Math.max(y0, rise - 0.03), collarY, 4, nvT(y0, collarY), pP + 0.004, { color: u.color, region: u.region ?? CR.COTTON, mottle: 0.1, tint: u.tint, tear: tearOf(top, 37, fnTop) });
      // the jacket's edges: a turned facing down each side of the opening
      for (const sd of [-1, 1]) {
        const pts = [];
        for (let i = 0; i <= 6; i++) {
          const y = lerp(y0 + 0.004, collarY - 0.01, i / 6);
          const p = surfPoint(T, sd * open, y, pT + 0.002);
          pts.push(p);
        }
        if (!FAR()) edgeTube(mb, T, pts, 0.0055, { color: mulC(topCol, 0.8), region: topReg });
      }
    } else {
      sheet(mb, T, 0, TAU, y0, collarY, rs, nvT(y0, collarY), pT, {
        ...topO,
        cap1: 0.004,
        tint: (p, n, c) => {
          if (top.zip && Math.abs(p.x) < 0.006 && p.z < 0 && p.y > y0 + 0.01) c.multiplyScalar(0.5); // the zip
          if (top.buttons && Math.abs(p.x) < 0.01 && p.z < 0) c.multiplyScalar(0.82); // the placket
          if (top.tint) top.tint(p, n, c);
        },
      });
      if (top.collar === 'v') {
        // skin in the neckline
        sheet(mb, T, -0.7, 0.7, ySh - 0.09, collarY, 6, 4, pP, skinO);
      }
    }
    // a hem band (jackets, hoodies), a stitched hem on the rest
    if (top.kind === 'jacket' || top.kind === 'hoodie' || top.kind === 'fleece' || top.kind === 'coat') {
      const band = top.kind === 'jacket' ? 0.035 : 0.045;
      sheet(mb, T, open, TAU - open, y0, y0 + band, rs - (open ? 4 : 0), 2, pT + 0.0035, { color: mulC(topCol, 0.88), region: topReg, mottle: 0.1, tear: tearOf(top, 41) });
    }
  } else if (!dead || !pants) {
    // bare-chested (a dead body): the skin from the trousers up
    sheet(mb, T, 0, TAU, pants ? rise - 0.01 : T.yLo, T.yHi, rs, nvT(rise, T.yHi), 0, { ...skinO, cap1: 0.004 });
  }
  if (top && (top.hem ?? 0) > 0.15) {
    // what hangs below the hips (a dress, a hospital gown, a long coat's tails): flared, so striding thighs stay inside
    const y0 = yH - 0.05, y1 = yH - top.hem;
    const r0 = T.ring(y0);
    const rows = [];
    for (let j = 0; j <= 4; j++) {
      const v = j / 4, y = lerp(y0, y1, v);
      rows.push([0.0, y, (r0.w + pT + 0.004) * (1 + 0.42 * v), (Math.max(r0.df, r0.db) + pT + 0.004) * (1 + 0.55 * v)]);
    }
    const nu = 18;
    const pos = [], idx = [], uv = [];
    for (let j = 0; j < rows.length; j++) {
      const [, y, rx, rz] = rows[j];
      for (let i = 0; i <= nu; i++) {
        const a = (i / nu) * TAU;
        const fold = 1 + 0.03 * Math.sin(a * 7) * (j / 4);
        pos.push(Math.sin(a) * rx * fold, y, -Math.cos(a) * rz * fold + 0.008 * (j / 4));
        uv.push(i / nu, 1 - j / 4);
      }
    }
    for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const hipsB = mb.bi('hips');
    const w = new Float32Array((pos.length / 3) * 4);
    for (let i = 0; i < w.length; i += 4) w.set([hipsB, 1, 0, 0], i);
    const back = top.backOpen ? (x, y, z) => z > 0.05 && Math.abs(x) < 0.03 + (yH - y) * 0.2 : null;
    const open = top.open && top.kind === 'coat' ? (x, y, z) => z < -0.05 && Math.abs(x) < 0.03 + (yH - y) * 0.12 : null;
    mb.geom('root', geo, { color: topCol, region: topReg, mottle: 0.12, double: true, keepNormals: true, wts: w, tint: top.tint, tear: tearOf(top, 61, back || open || (dead ? (x, y, z) => y < y1 + 0.06 * fbm3(x * 20, 0, z * 20, 2, 4) : null)) });
  }
  if (cover) {
    // a coverall's waist seam and its belt loops of the same cloth
    sheet(mb, T, 0, TAU, yH + 0.05, yH + 0.075, rs, 1, pT + 0.003, { color: mulC(topCol, 0.85), region: topReg });
  }
  // ---- neck (skin), and a collar round it
  sheet(mb, N, 0, TAU, N.yLo, N.yHi, Math.max(8, rs - 8), 4, 0, { ...skinO, cap0: 0.004, cap1: 0.004 });
  if (top) collar(mb, P, T, top, topCol, topReg, collarY, pT, open);
  // ---- arms
  for (let i = 0; i < 2; i++) {
    const A = arms[i];
    const side = i ? 1 : -1;
    const n = side < 0 ? 'L' : 'R';
    const missing = L.missingArm === n;
    const sleeves = top ? top.sleeves ?? 'long' : 'none';
    const sl = sleeves === 'long' ? A.yW + 0.03 : sleeves === 'rolled' ? A.yE - 0.035 : sleeves === 'short' ? A.yS - 0.12 : A.yS + 0.036;
    const yEnd = missing ? A.yE - 0.03 : A.yLo;
    const rsA = Math.max(10, rs - (dead ? 6 : 8));
    const tearS = top ? tearOf(top, 51 + i) : null;
    if (top && sleeves !== 'none' && top.kind !== 'tank') {
      const pS = thick * 0.75 + 0.003;
      const ys = Math.max(sl, yEnd);
      sheet(mb, A, 0, TAU, ys, A.yHi, rsA, nvL(ys, A.yHi), pS, { color: topCol, region: topReg, mottle: 0.12, tint: top.tint, tear: tearS, cap0: 0, cap1: 0.003 });
      if (sleeves === 'rolled') sheet(mb, A, 0, TAU, sl, sl + 0.04, rsA, 2, pS + 0.008, { color: mulC(topCol, 0.92), region: topReg });
      else if (sleeves === 'long' && (top.kind === 'jacket' || top.kind === 'hoodie' || top.kind === 'fleece' || top.kind === 'coat')) sheet(mb, A, 0, TAU, sl, sl + 0.03, rsA, 1, pS + 0.004, { color: mulC(topCol, 0.85), region: topReg });
      else if (sleeves === 'short') sheet(mb, A, 0, TAU, sl, sl + 0.015, rsA, 1, pS + 0.002, { color: mulC(topCol, 0.9), region: topReg });
      // skin from inside the sleeve down
      const under = dead && top.tear && !FAR() ? A.yHi : Math.min(A.yHi, sl + 0.03); // (torn: the arm shows through the holes)
      if (yEnd < under) sheet(mb, A, 0, TAU, yEnd, under, rsA - (dead ? 2 : 0), nvL(yEnd, under), 0, { ...skinO, cap0: 0, cap1: 0 });
    } else {
      sheet(mb, A, 0, TAU, yEnd, A.yHi, rsA, nvL(yEnd, A.yHi), 0, { ...skinO, cap0: 0, cap1: 0.003 });
    }
    if (missing) {
      stump(mb, 'farm' + n, 0.034 * B.arm, 0.0);
      continue;
    }
    hand(mb, P, L, side, skin, dead, detail);
  }
  // ---- legs
  for (let i = 0; i < 2; i++) {
    const Lg = legs[i];
    const side = i ? 1 : -1;
    const shoe = L.shoes;
    const rsL = Math.max(10, rs - 6);
    const shorts = pants && pants.shorts;
    if (pants) {
      const yb = shorts ? Lg.yK + 0.08 : pants.tearY !== undefined && dead ? Lg.yA + 0.04 + pants.tearY : Lg.yA + (shoe ? 0.035 : 0.02);
      const flare = (t, y) => pP + (shorts ? 0.01 : 0) + (pants.cargo ? 0.004 : 0) + 0.007 * sstep(Lg.yK - 0.2, Lg.yA + 0.03, y) * (shoe && !shorts ? 1 : 0.3);
      const fnHem = dead && pants.tearY !== undefined ? (x, y, z) => y < yb + 0.05 * fbm3(x * 25, y * 4, z * 25, 2, 11 + i) : null;
      sheet(mb, Lg, 0, TAU, yb, Lg.yHi, rsL, nvL(yb, Lg.yHi), flare, { ...pantsO, tear: tearOf(pants, 81 + i, fnHem), cap0: fnHem ? undefined : 0, cap1: 0 });
      const under = dead && pants.tear && !FAR() ? Lg.yHi : yb + 0.04; // (torn: the leg shows through the holes)
      if (shorts || dead) sheet(mb, Lg, 0, TAU, Lg.yLo, under, rsL - (dead ? 2 : 0), nvL(Lg.yLo, under), 0, { ...skinO, cap0: 0, cap1: 0 });
      if (pants.cargo) {
        // a bellows pocket on the outside of each thigh, its flap over it
        const t0 = side * PI * 0.5;
        pillow(mb, Lg, t0 - side * 0.55, t0 + side * 0.25, Lg.yT - 0.27, Lg.yT - 0.13, flare(0, Lg.yT - 0.2) - 0.001, 0.01, { color: mulC(pantsCol, 0.92), region: pantsO.region, nu: 4, nv: 3 });
        pillow(mb, Lg, t0 - side * 0.6, t0 + side * 0.3, Lg.yT - 0.145, Lg.yT - 0.115, flare(0, Lg.yT - 0.13) + 0.006, 0.004, { color: mulC(pantsCol, 0.85), region: pantsO.region, nu: 4, nv: 1 });
      }
    } else {
      sheet(mb, Lg, 0, TAU, Lg.yLo, Lg.yHi, rsL, nvL(Lg.yLo, Lg.yHi), 0, { ...skinO, cap0: 0, cap1: 0 });
    }
    if (shoe) boot(mb, P, L, side, shoe);
    else bareFoot(mb, P, L, side, skin);
  }
  // ---- overalls: the bib and its straps over the top, buttons
  if (L.overalls) overalls(mb, P, T, L, pT);
  if (L.vest) vest(mb, P, T, L.vest, pT, rs);
  if (top && top.kind === 'hoodie') hoodPouch(mb, T, top, topCol, topReg, pT, yH, yS);
  if (top && top.pockets) chestPockets(mb, T, top, topCol, topReg, pT, yC, open);
  if (pants && pants.belt !== false && !cover && !L.overalls) belt(mb, T, L, rise, pT, open, top);
  // ---- head, hair, beard, hat
  const H = buildHumanHead(mb, P, L, detail);
  // (the dead's hair and beards: fewer, coarser clumps)
  const hd = detail * (dead ? 0.6 : 1);
  if (L.beard) beard(mb, P, H, L.beard, L, hd);
  hair(mb, P, H, L, hd);
  if (L.hat) hat(mb, P, H, L.hat, L);
  if (L.gear) gear(mb, P, T, L.gear, L, { pT, pP, rise, open, arms, legs, H });
  if (dead) deadExtras(mb, P, H, L, T);
  return { H, T, arms, legs, B, pT, pP };
}

const mulC = (c, k) => color(c).multiplyScalar(k);

// a tube laid along points on S (a facing, a strap, a seam), skinned like S where it lies
function edgeTube(mb, S, pts, r, o) {
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]))), Math.max(4, pts.length * 2), r, o.rs || 4, false);
  const pa = geo.attributes.position;
  const wts = new Float32Array(pa.count * 4);
  for (let i = 0; i < pa.count; i++) {
    const w = S.wts(pa.getY(i), pa.getX(i));
    wts.set(w, i * 4);
  }
  return mb.geom('root', geo, { ...o, wts });
}

// ---------------------------------------------------------------- the top's collar
function collar(mb, P, T, top, col, reg, y, pT, open) {
  const kind = top.collar || (top.kind === 'jacket' || top.kind === 'coat' ? 'jacket' : top.kind === 'shirt' || top.kind === 'flannel' ? 'shirt' : top.kind === 'hoodie' ? 'hood' : top.kind === 'fleece' ? 'high' : 'crew');
  const yN = P.neckY;
  const ring = (t, yy, out) => surfPoint(T, t, yy, out);
  const band = (h, out, flare, c, t0 = 0, t1 = TAU) => {
    // a band round the neck opening: rings from y up h, leaning out by flare
    const pos = [], idx = [], wts = [], uv = [];
    const nu = 18, nv = 2;
    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      for (let i = 0; i <= nu; i++) {
        const t = lerp(t0, t1, i / nu);
        const p = ring(t, y - 0.004, pT + out);
        // up the neck from the opening, the top edge out by the flare
        const yy = y - 0.004 + h * v;
        const k = 1 - 0.18 * v + flare * v;
        pos.push(p[0] * k, yy, (p[2] - 0.004) * k + 0.004 * v);
        uv.push(i / nu, v);
        const w = T.wts(Math.min(yy, y), p[0]);
        wts.push(...w);
      }
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, cc = a + nu + 1, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    mb.geom('root', geo, { color: c, region: reg, mottle: 0.1, double: true, wts: new Float32Array(wts) });
  };
  if (kind === 'crew') band(0.012, 0.002, 0, mulC(col, 0.9));
  else if (kind === 'v') band(0.006, 0.002, 0, mulC(col, 0.85));
  else if (kind === 'high') band(0.05, 0.004, 0.05, mulC(col, 0.95), open || 0, TAU - (open || 0));
  else if (kind === 'shirt') band(0.032, 0.003, 0.32, mulC(col, 0.95), 0.12, TAU - 0.12);
  else if (kind === 'jacket') band(0.045, 0.005, 0.45, mulC(col, 0.88), Math.max(0.2, open || 0), TAU - Math.max(0.2, open || 0));
  else if (kind === 'hood') {
    // the hood down: a thick roll of it behind the neck, lying on the shoulders
    band(0.02, 0.003, 0.1, mulC(col, 0.92));
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = lerp(-1.3, 1.3, i / 8) + PI;
      const p = ring(t, y - 0.012, pT + 0.016 + 0.014 * Math.cos((i / 8 - 0.5) * PI));
      pts.push([p[0] * 1.08, p[1] + 0.012 * Math.cos((i / 8 - 0.5) * PI), p[2] + 0.012]);
    }
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 16, 1, 7, false);
    const pa = geo.attributes.position;
    // a flattened, tapering roll
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    const q = new THREE.Vector3();
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      curve.getPointAt(t, q);
      const r = 0.012 + 0.022 * Math.sin(t * PI);
      for (let j = 0; j <= 7; j++) {
        const k = i * 8 + j;
        const vx = pa.getX(k) - q.x, vy = pa.getY(k) - q.y, vz = pa.getZ(k) - q.z;
        pa.setXYZ(k, q.x + vx * r, q.y + vy * r * 0.6, q.z + vz * r);
      }
    }
    geo.computeVertexNormals();
    const wts = new Float32Array(pa.count * 4);
    for (let i = 0; i < pa.count; i++) wts.set(T.wts(Math.min(pa.getY(i), y), pa.getX(i)), i * 4);
    mb.geom('root', geo, { color: mulC(col, 0.95), region: reg, mottle: 0.12, keepNormals: true, wts });
    // drawstrings
    for (const sd of [-1, 1]) {
      const a = surfPoint(T, sd * 0.22, y - 0.01, pT + 0.004), b = surfPoint(T, sd * 0.2, y - 0.16, pT + 0.004);
      edgeTube(mb, T, [a, [lerp(a[0], b[0], 0.5), lerp(a[1], b[1], 0.5), Math.min(a[2], b[2]) - 0.003], b], 0.0028, { color: 0xd8d4c8, region: CR.PLAIN, rs: 4 });
    }
  }
  void yN;
}

// ---------------------------------------------------------------- pockets, pouch, belt, bib, vest
function chestPockets(mb, T, top, col, reg, pT, yC, open) {
  if (FAR()) return;
  const pc = mulC(col, 0.93);
  for (const sd of [-1, 1]) {
    if (top.pockets === 'one' && sd < 0) continue;
    const t0 = sd * Math.max(open + 0.08, 0.2), t1 = sd * Math.max(open + 0.62, 0.72);
    pillow(mb, T, Math.min(t0, t1), Math.max(t0, t1), yC + 0.01, yC + 0.085, pT - 0.001, 0.006, { color: pc, region: reg, nu: 4, nv: 3 });
    pillow(mb, T, Math.min(t0, t1) - 0.02, Math.max(t0, t1) + 0.02, yC + 0.07, yC + 0.095, pT + 0.004, 0.003, { color: mulC(col, 0.82), region: reg, nu: 4, nv: 1 });
  }
}

function hoodPouch(mb, T, top, col, reg, pT, yH, yS) {
  pillow(mb, T, -0.75, 0.75, yH + 0.0, yS + 0.06, pT - 0.001, 0.008, { color: mulC(col, 0.92), region: reg, nu: 6, nv: 3, round: 0.18 });
}

function belt(mb, T, L, rise, pT, open, top) {
  const b = (L.gear && L.gear.belt) || {};
  const y0 = rise - 0.042, y1 = rise - 0.008;
  const out = (L.pants.loose || 0) + 0.0095;
  // under an untucked top only what shows below its hem would be seen: drawn whole, it costs little
  if (top && !top.tucked && !open && (top.hem ?? 0.035) > 0.03) return;
  sheet(mb, T, 0, TAU, y0, y1, 22, 1, out, { color: b.color ?? 0x2a1f16, region: CR.LEATHER, mottle: 0.15 });
  // the buckle
  const p = surfPoint(T, 0, (y0 + y1) / 2, out + 0.004);
  mb.box('hips', [p[0], p[1] - mb.bonePos('hips')[1], p[2] + 0.002], [0.048, 0.036, 0.008], { color: L.dead ? 0x3a3630 : b.buckle ?? 0x9a9488, region: CR.PLAIN, mottle: 0.2, blood: false, round: 0.3 });
}

function overalls(mb, P, T, L, pT) {
  const col = color(L.overalls.color ?? L.pants.color);
  const yS = P.spineY, yC = P.chestY, ySh = P.shoulderY;
  const top = yC + 0.1;
  // the bib: a panel up the front, its edges hemmed
  sheet(mb, T, -0.62, 0.62, yS - 0.06, top, 6, 6, pT + 0.006, { color: col, region: CR.DENIM, mottle: 0.12 });
  pillow(mb, T, -0.32, 0.32, yC - 0.02, yC + 0.07, pT + 0.006, 0.004, { color: mulC(col, 0.9), region: CR.DENIM, nu: 4, nv: 2 });
  // straps from the bib's corners over the shoulders and down to the back's middle
  for (const sd of [-1, 1]) {
    const pts = [surfPoint(T, sd * 0.55, top - 0.01, pT + 0.008), surfPoint(T, sd * 0.62, ySh - 0.03, pT + 0.006), surfPoint(T, sd * 0.85, ySh + 0.03, pT + 0.006), surfPoint(T, PI - sd * 0.75, ySh, pT + 0.006), surfPoint(T, PI - sd * 0.25, yC + 0.02, pT + 0.006), surfPoint(T, PI - sd * 0.1, yS + 0.02, pT + 0.006)];
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 18, 1, 4, false);
    flatten(geo, pts, 0.017, 0.0035);
    const pa = geo.attributes.position;
    const wts = new Float32Array(pa.count * 4);
    for (let i = 0; i < pa.count; i++) wts.set(T.wts(pa.getY(i), pa.getX(i)), i * 4);
    mb.geom('root', geo, { color: col, region: CR.DENIM, mottle: 0.12, wts });
    const b = surfPoint(T, sd * 0.52, top - 0.012, pT + 0.012);
    mb.ellip('chest', [b[0], b[1] - mb.bonePos('chest')[1], b[2]], [0.009, 0.009, 0.004], { ws: 6, hs: 4, color: 0x8a8a7e, region: CR.PLAIN, blood: false });
  }
}

/** A tube made into a flat strap: width w across the surface, thickness h out of it (its points lie on a surface). */
function flatten(geo, pts, w, h) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const pa = geo.attributes.position;
  const segs = geo.parameters.tubularSegments, rad = geo.parameters.radialSegments;
  const q = new THREE.Vector3(), out = new THREE.Vector3(), tan = new THREE.Vector3(), side = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, q);
    curve.getTangentAt(t, tan);
    out.set(q.x, 0, q.z).normalize(); // away from the body's axis
    side.crossVectors(tan, out).normalize();
    out.crossVectors(side, tan).normalize();
    for (let j = 0; j <= rad; j++) {
      const a = (j / rad) * TAU;
      const k = i * (rad + 1) + j;
      pa.setXYZ(k, q.x + side.x * Math.cos(a) * w * 0.5 + out.x * Math.sin(a) * h, q.y + side.y * Math.cos(a) * w * 0.5 + out.y * Math.sin(a) * h, q.z + side.z * Math.cos(a) * w * 0.5 + out.z * Math.sin(a) * h);
    }
  }
  geo.computeVertexNormals();
}

function vest(mb, P, T, v, pT, rs) {
  const col = color(v.color);
  const yH = P.hipY, ySh = P.shoulderY;
  const pV = pT + (v.kind === 'down' ? 0.02 : 0.009);
  const open = v.open ?? 0.12;
  // armholes: the vest stops short of the shoulders' ends
  const fn = (x, y) => Math.abs(x) > 0.135 && y > ySh - 0.13;
  const reg = v.kind === 'down' ? CR.CLOTH : CR.CANVAS;
  sheet(mb, T, open, TAU - open, yH - 0.02, ySh + 0.05, rs, 14, (t, y) => pV + (v.kind === 'down' ? 0.004 * Math.abs(Math.sin((y - yH) * 60)) : 0), {
    color: col, region: reg, mottle: 0.1, double: true, tear: { amt: v.tear || 0, f: 13, seed: 91, fn },
    tint: v.tint,
  });
  if (v.kind === 'hivis' || v.stripes) {
    // reflective tape: two bands round it, faintly self-lit so they catch the eye at night
    for (const y of [P.chestY + 0.03, P.spineY + 0.0]) sheet(mb, T, open, TAU - open, y - 0.016, y + 0.016, rs, 1, pV + 0.002, { color: 0xd8d8cc, region: CR.PLAIN, glow: 0.3, mottle: 0.08, blood: false, tear: { amt: 0, fn } });
  }
  if (v.kind === 'blaze') {
    // a game pocket low on the back
    pillow(mb, T, PI - 0.8, PI + 0.8, yH + 0.02, yH + 0.14, pV - 0.001, 0.01, { color: mulC(col, 0.9), region: reg, nu: 6, nv: 3 });
  }
}

// ---------------------------------------------------------------- hands and feet
/**
 * A hand on the 'handL' / 'handR' bone. Survivors (L.fist) make a fist round what they hold: the back of the hand, a
 * roll of curled fingers with their knuckles, the thumb across it; the held item's mount (characters.js MOUNT_POS)
 * goes through the middle of the roll. The dead keep theirs open and clawing.
 */
function hand(mb, P, L, s, skin, dead, detail = 1) {
  const bone = 'hand' + (s < 0 ? 'L' : 'R');
  const gl = L.gear && L.gear.gloves;
  const col = gl ? color(gl.color ?? gl) : skin;
  const reg = gl ? gl.region ?? CR.LEATHER : dead ? CR.ROT : CR.SKIN_H;
  const hs = L.handScale || 1;
  const o = { color: col, region: reg, mottle: 0.06, tint: dead ? skinTint(L) : null };
  if (L.fist) {
    // (s = 1 the right hand: the palm faces -X, the thumb is toward -Z; mirrored for the left)
    mb.box(bone, [s * 0.002, -0.049, 0.001], [0.033, 0.08, 0.084], { ...o, round: 0.6, seg: 2 });
    const zs = [-0.029, -0.0095, 0.01, 0.0285];
    for (let i = 0; i < 4; i++) {
      const sm = i === 3 ? 0.88 : 1;
      // each finger curled round under the knuckles and folded back into the palm: one rounded block
      mb.box(bone, [-s * 0.01, -0.092 + (i === 3 ? 0.004 : 0), zs[i]], [0.042 * sm, 0.032 * sm, 0.0195], { ...o, round: 0.7, seg: 2, rot: [0, 0, s * 0.25] });
    }
    mb.tube(bone, [[-s * 0.008, -0.022, -0.036], [-s * 0.02, -0.05, -0.042], [-s * 0.026, -0.072, -0.03]], 0.0115, 0.0088, { rs: 6, ts: 5, ...o });
    if (gl) mb.lathe(bone, [0, 0, 0], [[0.03, -0.012], [0.032, 0.0], [0.031, 0.022]], { rs: 10, sz: 1.25, sx: 0.8, color: mulC(col, 0.8), region: reg });
    if (L.gear && L.gear.watch && s < 0) mb.lathe(bone, [0, 0, 0], [[0.03, 0.006], [0.031, 0.016], [0.03, 0.026]], { rs: 10, sz: 1.2, sx: 0.85, color: 0x1a1a1a, region: CR.LEATHER });
    return;
  }
  // an open hand: palm, four jointed fingers curling in, a thumb, nails or claws
  const curl = L.curl ?? 0.45;
  const fm = (L.fingerMul || 1) * hs;
  mb.box(bone, [s * 0.001, -0.045 * hs, 0], [0.024 * hs, 0.076 * hs, 0.07 * hs], { ...o, round: 0.55, seg: 2 });
  const lens = [0.95, 1.0, 0.95, 0.78];
  for (let i = 0; i < 4; i++) {
    const z = (-0.025 + i * 0.0167) * hs;
    const len = 0.085 * lens[i] * fm;
    const y0 = -0.08 * hs;
    const a1 = 0.35 * curl, a2 = 0.85 * curl, a3 = 1.25 * curl;
    const p0 = [0, y0, z * 1.02];
    const p1 = [p0[0] - s * Math.sin(a1) * len * 0.45, p0[1] - Math.cos(a1) * len * 0.45, z * 1.04];
    const p2 = [p1[0] - s * Math.sin(a2) * len * 0.32, p1[1] - Math.cos(a2) * len * 0.32, z * 1.05];
    const p3 = [p2[0] - s * Math.sin(a3) * len * 0.26, p2[1] - Math.cos(a3) * len * 0.26, z * 1.05];
    if (detail < 0.7) {
      // (far away: one block of fingers, curled)
      if (i === 0) mb.box(bone, [-s * 0.012 * curl * hs, -0.105 * hs, 0], [0.022 * hs, 0.06 * hs * fm, 0.066 * hs], { ...o, round: 0.5, seg: 1, rot: [0, 0, s * 0.35 * curl] });
      continue;
    }
    mb.tube(bone, [p0, p1, p2, p3], 0.0088 * hs, 0.0058 * hs, { rs: 5, ts: 4, ...o, cap: !L.claws });
    if (L.claws) {
      const cl = L.claws * hs;
      mb.spike(bone, p3, [p3[0] - s * cl * 0.7 * curl, p3[1] - cl * 0.8, p3[2] - cl * 0.1], 0.0055 * hs, { rs: 4, color: 0x2a2016, region: CR.BONE, mottle: 0.2 });
    }
  }
  mb.tube(bone, [[-s * 0.008, -0.02 * hs, -0.03 * hs], [-s * 0.022 * hs, -0.052 * hs, -0.046 * hs], [-s * 0.034 * hs, -0.078 * hs, -0.048 * hs]], 0.0105 * hs, 0.0072 * hs, { rs: 5, ts: 4, ...o });
}

/** A boot or shoe on the 'foot' bone: lofted heel to toe, a sole round its bottom, a shaft up the ankle. */
function boot(mb, P, L, s, shoe) {
  const n = s < 0 ? 'L' : 'R';
  const fb = mb.bonePos('foot' + n);
  const kind = shoe.kind || 'boot';
  const col = color(shoe.color ?? 0x3a2a1c);
  const sneaker = kind === 'sneaker';
  const fw = L.footW || 1, fl = (L.footL || 1) * (L.sex === 'f' ? 0.93 : 1);
  const sole = color(shoe.sole ?? (sneaker ? 0xe0ddd4 : 0x1e1a16));
  const shaft = kind === 'boot' || kind === 'work' ? 0.115 : sneaker ? 0.075 : 0.06;
  // sections from the heel to the toe: [z, half width, top]
  const secs = [
    [0.07, 0.032, 0.06],
    [0.05, 0.04, shaft],
    [0.0, 0.044, shaft + 0.005],
    [-0.05, 0.047, 0.078],
    [-0.105, 0.05, 0.058],
    [-0.15, 0.048, 0.05],
    [-0.185, 0.04, 0.042],
    [-0.205, 0.026, 0.032],
  ];
  const ns = FAR() ? 8 : 14;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i < secs.length; i++) {
    const [z, w, top] = secs[i];
    for (let k = 0; k <= ns; k++) {
      // round the section: the sole flat on the ground, the sides near upright, the top rounded
      const a = (k / ns) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      const x = Math.sign(sa) * Math.pow(Math.abs(sa), 0.7) * w * fw;
      const yy = ca > 0 ? top * Math.pow(ca, 0.8) : -Math.pow(-ca, 1.6) * 0.004;
      const y = Math.max(0, yy + 0.004);
      pos.push(fb[0] + x, y, fb[2] + z * fl);
      uv.push(i / (secs.length - 1), y < 0.013 ? (y / 0.013) * 0.13 : 0.14 + clamp((y - 0.013) / 0.11, 0, 1) * 0.86);
    }
  }
  for (let i = 0; i < secs.length - 1; i++) for (let k = 0; k < ns; k++) {
    const a = i * (ns + 1) + k, b = a + 1, c = a + ns + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  // close the heel and the toe
  for (const [i, back] of [[0, true], [secs.length - 1, false]]) {
    const ci = pos.length / 3;
    const [z, , top] = secs[i];
    pos.push(fb[0], top * 0.45, fb[2] + z * fl + (back ? 0.006 : -0.006));
    uv.push(back ? 0 : 1, 0.5);
    for (let k = 0; k < ns; k++) {
      const a = i * (ns + 1) + k;
      if (back) idx.push(a + 1, a, ci);
      else idx.push(a, a + 1, ci);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const foot = mb.bi('foot' + n);
  const wts = new Float32Array((pos.length / 3) * 4);
  for (let i = 0; i < pos.length / 3; i++) wts.set([foot, 1, 0, 0], i * 4);
  mb.geom('root', geo, {
    color: col, region: sneaker ? CR.COTTON : CR.BOOT, mottle: 0.1, keepNormals: true, wts,
    tint(p, nn, c) {
      if (p.y < 0.018) c.copy(sole).multiplyScalar(0.9); // the sole, all round
      else if (sneaker && p.y < 0.03) c.lerp(sole, 0.7);
      if (kind === 'work' && p.z < fb[2] - 0.14 && p.y > 0.02) c.multiplyScalar(0.8); // a scuffed toe cap
      if (shoe.tint) shoe.tint(p, nn, c);
    },
  });
  // laces up the front of a boot / shoe
  if (kind !== 'dress' && !FAR()) {
    const lc = shoe.laces ?? (sneaker ? 0xe8e4dc : 0x2a2016);
    for (let i = 0; i < (sneaker ? 3 : 4); i++) {
      const z = lerp(-0.075, 0.0, i / 3) * fl, y = lerp(0.068, shaft - 0.01, i / 3);
      mb.box('foot' + n, [0, y - fb[1] + 0.004, z - 0.004 * i], [0.03 * fw, 0.004, 0.006], { color: lc, region: CR.PLAIN, mottle: 0.1, rot: [-0.5, 0, 0] });
    }
  }
}

function bareFoot(mb, P, L, s, skin) {
  const n = s < 0 ? 'L' : 'R';
  const fb = mb.bonePos('foot' + n);
  const fw = L.footW || 1, fl = L.footL || 1;
  const o = { color: skin, region: L.dead ? CR.ROT : CR.SKIN_H, mottle: 0.1, tint: L.dead ? skinTint(L) : null };
  const ay = fb[1];
  mb.box('foot' + n, [0, -ay + 0.028, -0.045 * fl], [0.075 * fw, 0.05, 0.2 * fl], { round: 0.55, seg: 2, ...o });
  mb.ellip('foot' + n, [0, -ay + 0.045, 0.02], [0.03 * fw, 0.04, 0.035], { ws: 7, hs: 5, ...o });
  for (let i = 0; i < 5; i++) {
    const x = (i - 1.6) * 0.0145 * fw * s;
    if (!FAR()) mb.ellip('foot' + n, [x, -ay + 0.012, (-0.148 + Math.abs(i - 1) * 0.006) * fl], [0.0075, 0.0075, 0.012], { ws: 4, hs: 3, ...o });
  }
}

/** Ragged, bloody limb stump with the bone poking out, at the joint of `bone` (hangs along -Y). */
export function stump(mb, bone, r, y) {
  mb.ellip(bone, [0, y, 0], [r * 1.05, r * 0.9, r * 1.0], { ws: 7, hs: 5, color: 0x5a1210, region: CR.FLESH, mottle: 0.3, noise: r * 0.12, nf: 60, blood: false });
  mb.spike(bone, [0, y - r * 0.3, 0.003], [r * 0.12, y - r * 2.1, -0.004], r * 0.34, { rs: 5, color: 0xd8ccb0, region: CR.BONE, blood: false });
  mb.tube(bone, [[-r * 0.4, y - r * 0.5, -r * 0.2], [-r * 0.5, y - r * 1.3, -r * 0.1], [-r * 0.3, y - r * 2.0, 0]], r * 0.13, r * 0.05, { rs: 4, ts: 3, color: 0x6a1a18, region: CR.FLESH, blood: false });
}

// ---------------------------------------------------------------- hair, beards, hats
// hairlines: how far into a style's hair a point of the head (phi, lam) is, in elevation (rad): > 0 it grows there.
// Soft, so the hair can thin out to nothing at its edge instead of ending in steps of the grid
const FRONT = (ap) => 0.43 + 0.12 * Math.min(1, ap / 0.9) ** 2; // the hairline over the forehead
function hairDepth(style, phi, lam, len = 0) {
  const ap = Math.abs(phi);
  let line;
  if (style === 'fade' || style === 'crop') line = ap < 0.9 ? FRONT(ap) : lerp(0.5, 0.26, sstep(0.9, 1.4, ap));
  else if (style === 'bob') line = ap < 0.85 ? FRONT(ap) - 0.13 : lerp(FRONT(0.85) - 0.13, -0.68, sstep(0.85, 1.35, ap));
  else {
    // the forehead, the temples down to the sideburns, the tops of the ears, the nape
    const front = style === 'long' ? FRONT(ap) - 0.08 : FRONT(ap);
    const temple = lerp(front, -0.03, sstep(0.95, 1.3, ap)); // down to the sideburn in front of the ear
    const ear = lerp(-0.03, 0.12, sstep(1.36, 1.46, ap)) ; // up over the ear
    const nape = lerp(0.12, -0.36 - len, sstep(1.78, 2.05, ap));
    line = ap < 0.95 ? front : ap < 1.36 ? temple : ap < 1.78 ? ear : nape;
  }
  let d = lam - line;
  if (style === 'balding') d = Math.min(d, 0.32 - lam, ap - 1.0); // a fringe round the back and sides
  return d;
}

function hair(mb, P, H, L, detail = 1) {
  const h = L.hair;
  const head = mb.bi('head'), jaw = mb.bi('jaw');
  if (!h) return;
  const col = color(h.color ?? 0x2a2018);
  const style = h.style || 'short';
  const hatLow = L.hat && L.hat.kind !== 'bandana' ? hatBand(L.hat.kind) : 9; // under a hat, only what shows below its band
  if (style === 'buzz') return; // painted onto the scalp (headTint, see looks.js)
  const patchy = style === 'patchy' ? h.patchy ?? 0.5 : 0; // the dead's: torn out in clumps
  const nu = Math.max(16, Math.round(52 * detail)), nv = Math.max(10, Math.round(30 * detail));
  const vol = style === 'short' ? 0.006 : style === 'crop' || style === 'fade' ? 0.005 : style === 'balding' ? 0.005 : style === 'bob' ? 0.012 : 0.009;
  const fade = style === 'crop' || style === 'fade' ? 0.1 : 0.16; // how far in from its edge the hair reaches its full depth
  const push = (phi, lam) => {
    // (the distance in from the hairline across it, not straight up: a steep hairline thins out as soon as a flat one)
    const dl = (hairDepth(style, phi + 0.02, lam, h.length) - hairDepth(style, phi - 0.02, lam, h.length)) / 0.04;
    const d = hairDepth(style, phi, lam, h.length) / Math.sqrt(1 + dl * dl);
    const full = vol * (1 + 0.5 * clamp(lam, 0, 1)) + (style === 'bob' || style === 'long' ? 0.005 * sstep(0.4, -0.4, lam) : 0);
    return 0.0012 + (full - 0.0012) * sstep(0, fade, d);
  };
  const mask = { depth: (phi, lam) => Math.min(hairDepth(style, phi, lam, h.length), hatLow + 0.08 - lam, patchy ? (fbm3(Math.sin(phi) * 2.5, lam * 2.5, Math.cos(phi) * 2.5, 3, 7) - patchy * 0.85) * 3 : 1) };
  const { geo, wts } = headSurface(H, nu, nv, head, jaw, mask, push, true);
  // the hair's own layout: v runs down it (the strands)
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * 3) % 1, uv.getY(i));
  for (let i = 0; i < wts.length; i += 4) {
    wts[i + 1] = 1;
    wts[i + 3] = 0;
  }
  mb.geom('head', geo, {
    color: col, region: CR.HAIR_H, mottle: 0.15, keepNormals: true, wts, blood: false,
    tint(p, n, c) {
      if (n.y < -0.2) c.multiplyScalar(0.8);
      c.multiplyScalar(1 + 0.35 * Math.max(0, n.y) ** 4); // a sheen on top
    },
  });
  const hb = mb.bonePos('head');
  const nb = mb.bonePos('neck');
  const p = new THREE.Vector3();
  if (style === 'bun' || style === 'ponytail' || style === 'braid') {
    headPoint(H, PI, style === 'bun' ? 0.42 : 0.12, p);
    if (style === 'bun') {
      mb.ellip('head', [p.x, p.y + 0.012, p.z + 0.03], [0.038 * (h.size || 1), 0.034 * (h.size || 1), 0.036 * (h.size || 1)], { ws: 10, hs: 7, color: col, region: CR.HAIR_H, mottle: 0.15, blood: false });
    } else {
      // a tail of hair down the back of the neck: on the head at its root, the neck further down, the chest at its end
      const len = h.length ?? 0.2;
      const pts = [[p.x, p.y, p.z + 0.004], [p.x, p.y - 0.04, p.z + 0.03], [p.x, p.y - len * 0.6, p.z + 0.04], [p.x, p.y - len, p.z + 0.03]];
      const geo2 = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(q[0] + hb[0], q[1] + hb[1], q[2] + hb[2]))), 10, 1, 7, false);
      const pa = geo2.attributes.position;
      const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(q[0] + hb[0], q[1] + hb[1], q[2] + hb[2])));
      const q = new THREE.Vector3();
      const wts2 = new Float32Array(pa.count * 4);
      const neck = mb.bi('neck'), chest = mb.bi('chest');
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        curve.getPointAt(t, q);
        const r = (style === 'braid' ? 0.016 * (1 - 0.3 * t) * (1 + 0.25 * Math.abs(Math.sin(t * 22))) : 0.02 * (1 - 0.25 * t) * (t < 0.12 ? 0.8 : 1)) * (h.size || 1);
        for (let j = 0; j <= 7; j++) {
          const k = i * 8 + j;
          pa.setXYZ(k, q.x + (pa.getX(k) - q.x) * r, q.y + (pa.getY(k) - q.y) * r, q.z + (pa.getZ(k) - q.z) * r);
          const w = t < 0.25 ? [head, 1, neck, 0] : t < 0.7 ? [head, 1 - (t - 0.25) / 0.45, neck, (t - 0.25) / 0.45] : [neck, 1 - (t - 0.7) / 0.3 * 0.6, chest, ((t - 0.7) / 0.3) * 0.6];
          wts2.set(w, k * 4);
        }
      }
      geo2.computeVertexNormals();
      mb.geom('root', geo2, { color: col, region: CR.HAIR_H, mottle: 0.15, keepNormals: true, wts: wts2, blood: false });
      // the band round it
      mb.ellip('head', [p.x, p.y - 0.015, p.z + 0.016], [0.016, 0.01, 0.016], { ws: 8, hs: 4, color: h.band ?? 0x1a1a1a, region: CR.PLAIN });
    }
  }
  if (style === 'long') {
    // hanging down the back past the shoulders: a curtain off the back of the head, skinned head -> neck -> chest
    const pos = [], idx = [], uvs = [], wts2 = [];
    const nuC = 10, nvC = 6;
    const len = h.length ?? 0.24;
    const neck = mb.bi('neck'), chest = mb.bi('chest');
    for (let j = 0; j <= nvC; j++) {
      const v = j / nvC;
      for (let i = 0; i <= nuC; i++) {
        const phi = PI + lerp(-1.25, 1.25, i / nuC);
        headPoint(H, phi, -0.15, p);
        const r = Math.hypot(p.x, p.z) + 0.012 + 0.012 * v;
        const ang = Math.atan2(p.x, p.z);
        const x = Math.sin(ang) * r * (1 + 0.25 * v), z = Math.cos(ang) * r * (1 - 0.1 * v) + 0.015 * v;
        pos.push(x + hb[0], p.y - len * v + hb[1], z + hb[2]);
        uvs.push(i / nuC, 1 - v);
        const w = v < 0.3 ? [head, 1, neck, 0] : v < 0.7 ? [head, 1 - (v - 0.3) / 0.4, neck, (v - 0.3) / 0.4] : [neck, 1 - (v - 0.7) / 0.3 * 0.7, chest, ((v - 0.7) / 0.3) * 0.7];
        wts2.push(...w);
      }
    }
    for (let j = 0; j < nvC; j++) for (let i = 0; i < nuC; i++) {
      const a = j * (nuC + 1) + i, b = a + 1, c = a + nuC + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    mb.geom('root', g, { color: col, region: CR.HAIR_H, mottle: 0.15, double: true, wts: new Float32Array(wts2), blood: false, tear: h.ragged ? { amt: h.ragged, f: 30, seed: 9 } : null });
  }
  void nb;
}

function beard(mb, P, H, b, L, detail = 1) {
  const head = mb.bi('head'), jaw = mb.bi('jaw');
  const col = color(b.color ?? L.hair?.color ?? 0x2a2018);
  const style = b.style || 'full';
  if (style === 'stubble') return; // painted (looks.js headTint)
  const vol = style === 'full' ? 0.01 : style === 'short' ? 0.005 : 0.0042;
  const depth = (phi, lam) => {
    const ap = Math.abs(phi);
    // the mustache: over the upper lip from under the nose to the mouth's corners
    const mus = Math.min(lam + 0.425 + 0.05 * (ap / 0.3) ** 2, -0.315 - 0.07 * (ap / 0.3) ** 2 - lam, 0.31 - ap);
    if (style === 'mustache') return mus;
    // clear of the lips
    const lips = Math.max(lam + 0.53 - 0.04 * (ap / 0.26) ** 2, -0.38 - lam + 0.1 * (ap / 0.26) ** 2) < 0 ? 0 : 1;
    const mouth = Math.max(ap - 0.27, -0.53 - lam, lam + 0.385);
    if (style === 'goatee') return Math.max(mus, Math.min(0.28 - ap, -0.53 - lam, lam + 1.2, mouth));
    // the cheeks' line from the nose's side down and back to the sideburns; under the jaw to the throat
    const top = ap < 0.5 ? -0.3 : ap < 1.2 ? -0.3 + (ap - 0.5) * 0.36 : -0.05;
    void lips;
    return Math.min(top - lam, 1.45 - ap, lam + 1.35, Math.max(mouth, mus > 0 ? 1 : -1));
  };
  const mask = { depth };
  const push = (phi, lam) => 0.001 + vol * sstep(0, 0.07, depth(phi, lam)) * (1 + (style === 'full' ? 0.9 * G((lam + 0.85) / 0.25) * G(phi / 0.6) : 0));
  const { geo, wts } = headSurface(H, Math.max(16, Math.round(44 * detail)), Math.max(10, Math.round(30 * detail)), head, jaw, mask, push);
  mb.geom('head', geo, { color: col, region: CR.HAIR_H, mottle: 0.15, keepNormals: true, wts, blood: false });
}

// how low each hat's band comes (head elevation, rad): the hair stops there
function hatBand(kind) {
  return kind === 'beanie' ? 0.14 : kind === 'bandana' ? 0.33 : kind === 'cap' || kind === 'trucker' ? 0.3 : kind === 'hardhat' ? 0.3 : 0.28;
}

function hat(mb, P, H, h, L) {
  const head = mb.bi('head'), jaw = mb.bi('jaw');
  const col = color(h.color ?? 0x3a4a30);
  const kind = h.kind;
  const p = new THREE.Vector3();
  const on = (o) => ({ mottle: 0.12, blood: false, ...o });
  const shell = (low, push, o) => {
    const { geo, wts } = headSurface(H, 26, 14, head, jaw, { depth: (phi, lam) => lam - low }, push);
    for (let i = 0; i < wts.length; i += 4) {
      wts[i + 1] = 1;
      wts[i + 3] = 0;
    }
    return mb.geom('head', geo, on({ keepNormals: true, wts, ...o }));
  };
  if (kind === 'cap' || kind === 'trucker') {
    const hbH = mb.bonePos('head');
    const front = h.front !== undefined ? color(h.front) : null;
    shell(0.28, (phi, lam) => 0.013 + 0.006 * clamp(lam - 0.5, 0, 1) + 0.006 * G(phi / 0.8) * G((lam - 0.55) / 0.3), {
      color: col, region: kind === 'trucker' ? CR.CLOTH : CR.CANVAS,
      tint(pp, n, c) {
        if (front) {
          // the front panel: over the forehead, up to the crown
          const lx = pp.x - hbH[0], ly = pp.y - hbH[1] - H.cy, lz = pp.z - hbH[2];
          if (lz < 0 && Math.abs(Math.atan2(lx, -lz)) < 0.62 && Math.atan2(ly, Math.hypot(lx, lz)) < 0.95) c.copy(front);
        }
        if (kind === 'trucker' && n.z > -0.1) c.multiplyScalar(0.75 + 0.25 * ((Math.floor(pp.x * 400) + Math.floor(pp.y * 400)) & 1)); // the mesh back
      },
    });
    // the bill: a curved plate out over the eyes
    // (its inner edge round the cap's band, out furthest in the middle and curving down at the sides)
    const pos = [], idx = [], nuB = 12, nvB = 3;
    for (let j = 0; j <= nvB; j++) for (let i = 0; i <= nuB; i++) {
      const a = lerp(-1.0, 1.0, i / nuB), v = j / nvB;
      headPoint(H, a, 0.31, p);
      const rr = Math.hypot(p.x, p.z) || 1;
      const out = 0.012 + 0.07 * v * Math.cos(a * 0.85) * H.s;
      pos.push(p.x * (1 + out / rr), p.y + 0.003 - 0.016 * v * v - 0.012 * v * Math.abs(a), p.z * (1 + out / rr) - 0.004 * v);
    }
    for (let j = 0; j < nvB; j++) for (let i = 0; i < nuB; i++) {
      const a = j * (nuB + 1) + i, b = a + 1, c = a + nuB + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    mb.geom('head', g, on({ color: mulC(h.bill ?? h.color ?? 0x3a4a30, 0.9), region: CR.CANVAS, double: true }));
    headPoint(H, 0, PI / 2, p);
    mb.ellip('head', [p.x, p.y + 0.012, p.z], [0.007, 0.004, 0.007], { ws: 6, hs: 3, color: col, region: CR.CANVAS });
  } else if (kind === 'beanie') {
    shell(0.12, (phi, lam) => 0.009 + 0.012 * clamp(lam - 0.6, 0, 1), { color: col, region: CR.KNIT });
    // the turned-up cuff
    const { geo, wts } = headSurface(H, 26, 18, head, jaw, { depth: (phi, lam) => Math.min(lam - 0.12, 0.36 - lam) }, 0.016);
    for (let i = 0; i < wts.length; i += 4) {
      wts[i + 1] = 1;
      wts[i + 3] = 0;
    }
    mb.geom('head', geo, on({ keepNormals: true, wts, color: mulC(col, 0.88), region: CR.KNIT }));
  } else if (kind === 'hardhat') {
    shell(0.28, (phi, lam) => 0.02 + 0.006 * clamp(lam, 0, 1) + 0.005 * G(phi / 0.12) * clamp(lam, 0, 1), { color: col, region: CR.PLAIN, mottle: 0.08 });
    // the brim all round, wider at the front (the peak)
    brim(mb, H, 0.3, (a) => 0.022 + 0.03 * Math.max(0, Math.cos(a)) ** 3, -0.006, mulC(col, 0.93), CR.PLAIN);
  } else if (kind === 'ranger' || kind === 'cowboy') {
    // the crown: a lathe on top of the head, pinched (ranger: four dents to a peak; cowboy: a crease down the middle)
    headPoint(H, 0, PI / 2, p);
    const top = p.y + 0.012;
    const base = H.cy + 0.035 * H.s;
    const pos = [], idx = [], nuC = 20, nvC = 5;
    for (let j = 0; j <= nvC; j++) for (let i = 0; i <= nuC; i++) {
      const a = (i / nuC) * TAU, v = j / nvC;
      const rr = (0.082 + 0.004 * (1 - v)) * H.s * (1 - 0.35 * v * v);
      let y = lerp(base, top + (kind === 'ranger' ? 0.035 : 0.025), v);
      if (kind === 'ranger') y -= v * v * 0.022 * (0.5 + 0.5 * Math.cos(a * 4)) * (v > 0.5 ? 1 : 0.5);
      else y -= v * v * 0.02 * Math.cos(a) ** 2;
      pos.push(Math.sin(a) * rr * (H.a / (0.073 * H.s)), y, -Math.cos(a) * rr * 1.08 + 0.004);
    }
    for (let j = 0; j < nvC; j++) for (let i = 0; i < nuC; i++) {
      const a = j * (nuC + 1) + i, b = a + 1, c = a + nuC + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const ci = pos.length / 3;
    pos.push(0, top + (kind === 'ranger' ? 0.035 : 0.01), 0.004);
    for (let i = 0; i < nuC; i++) idx.push(nvC * (nuC + 1) + i + 1, nvC * (nuC + 1) + i, ci);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    mb.geom('head', g, on({ color: col, region: CR.CANVAS }));
    // the band round its foot, the brim
    mb.lathe('head', [0, base + 0.003, 0.004], [[0.0868 * H.s, 0], [0.0868 * H.s, 0.009]], { rs: 20, sx: H.a / (0.073 * H.s), sz: 1.08, color: h.band ?? 0x3a2a1a, region: CR.LEATHER });
    const roll = kind === 'cowboy';
    brimFlat(mb, base, H, kind === 'ranger' ? 0.1 : 0.095, roll, col);
  } else if (kind === 'bandana') {
    const { geo, wts } = headSurface(H, 26, 18, head, jaw, { depth: (phi, lam) => Math.min(lam - 0.28, 0.5 - lam) }, L.hair ? 0.0125 : 0.006); // (over the hair)
    for (let i = 0; i < wts.length; i += 4) {
      wts[i + 1] = 1;
      wts[i + 3] = 0;
    }
    mb.geom('head', geo, on({ keepNormals: true, wts, color: col, region: CR.COTTON, tint: h.tint }));
    // the knot at the back and its two tails
    headPoint(H, PI, 0.38, p);
    mb.ellip('head', [p.x, p.y, p.z + 0.008], [0.014, 0.012, 0.01], { ws: 6, hs: 4, color: col, region: CR.COTTON });
    for (const sd of [-1, 1]) mb.box('head', [p.x + sd * 0.012, p.y - 0.035, p.z + 0.014], [0.018, 0.06, 0.004], { color: mulC(col, 0.9), region: CR.COTTON, rot: [0.25, 0, sd * 0.3] });
  }
}

// a brim round a hat at head elevation lam: its width out from the head by angle (0 the front)
function brim(mb, H, lam, width, drop, col, region) {
  const pos = [], idx = [], nu = 24;
  const p = new THREE.Vector3();
  for (let i = 0; i <= nu; i++) {
    const a = (i / nu) * TAU;
    headPoint(H, a > PI ? a - TAU : a, lam, p);
    const r = Math.hypot(p.x, p.z), w = width(a);
    pos.push(p.x * (1 + 0.012 / r), p.y, p.z * (1 + 0.012 / r));
    pos.push(p.x * (1 + (0.012 + w) / r), p.y + drop, p.z * (1 + (0.012 + w) / r));
  }
  for (let i = 0; i < nu; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  mb.geom('head', g, { color: col, region, mottle: 0.1, double: true, blood: false });
}

// a felt hat's brim: flat (ranger) or rolled up at the sides (cowboy)
function brimFlat(mb, y, H, w, roll, col) {
  const pos = [], idx = [], nu = 28, nv = 3;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const a = (i / nu) * TAU, v = j / nv;
    const r0x = 0.088 * H.s * (H.a / (0.073 * H.s)), r0z = 0.095 * H.s;
    const r = v * w;
    const side = Math.abs(Math.sin(a));
    const yy = y + 0.002 + (roll ? side ** 2 * v * v * 0.045 - (1 - side) * v * 0.012 : -v * 0.004);
    pos.push(Math.sin(a) * (r0x + r), yy, -Math.cos(a) * (r0z + r) + 0.004);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  mb.geom('head', g, { color: mulC(col, 0.95), region: CR.CANVAS, mottle: 0.1, double: true, blood: false });
}

// ---------------------------------------------------------------- kit
function gear(mb, P, T, g, L, k) {
  const chest = mb.bonePos('chest'), hips = mb.bonePos('hips');
  const yC = P.chestY, yH = P.hipY;
  if (g.badge) {
    // a star or shield over the heart (or on the belt: badge 'belt')
    const at = g.badge === 'belt' ? surfPoint(T, -0.35, k.rise - 0.025, k.pP + 0.016) : surfPoint(T, -0.48, yC + 0.07, k.pT + 0.003);
    const bone = g.badge === 'belt' ? 'hips' : 'chest';
    const bp = bone === 'hips' ? hips : chest;
    mb.ellip(bone, [at[0] - bp[0], at[1] - bp[1], at[2] - bp[2] - 0.002], [0.017, 0.02, 0.004], { ws: 6, hs: 4, color: 0xc8a848, region: CR.PLAIN, glow: 0.05, mottle: 0.15, blood: false, rot: [0.15, -0.4, 0] });
  }
  if (g.radio) {
    // a radio clipped high on the chest, its aerial up
    const at = surfPoint(T, 0.6, yC + 0.1, k.pT + 0.012);
    mb.box('chest', [at[0] - chest[0], at[1] - chest[1], at[2] - chest[2]], [0.032, 0.06, 0.02], { color: 0x1c1c1c, region: CR.LEATHER, rot: [0.1, 0.5, 0], round: 0.25 });
    mb.seg('chest', [at[0] - chest[0] + 0.008, at[1] - chest[1] + 0.03, at[2] - chest[2]], [at[0] - chest[0] + 0.01, at[1] - chest[1] + 0.085, at[2] - chest[2] + 0.004], 0.0035, 0.003, { rs: 5, color: 0x141414, region: CR.PLAIN });
  }
  if (g.holster) {
    // a pistol in a holster on the right hip
    const at = surfPoint(T, PI * 0.56, k.rise - 0.06, k.pP + 0.022);
    mb.box('hips', [at[0] - hips[0], at[1] - hips[1] - 0.03, at[2] - hips[2]], [0.03, 0.13, 0.05], { color: 0x1a1612, region: CR.LEATHER, round: 0.3, rot: [0.1, 0, 0] });
    mb.box('hips', [at[0] - hips[0], at[1] - hips[1] + 0.05, at[2] - hips[2] + 0.012], [0.026, 0.05, 0.03], { color: 0x202020, region: CR.PLAIN, round: 0.3, rot: [-0.3, 0, 0] });
  }
  if (g.toolbelt) {
    // pouches round the hips, a hammer through a loop
    for (const sd of [-1, 1]) {
      const at = surfPoint(T, sd * 1.2, k.rise - 0.07, k.pP + 0.026);
      mb.box('hips', [at[0] - hips[0], at[1] - hips[1], at[2] - hips[2]], [0.06, 0.09, 0.05], { color: 0x6a4a2a, region: CR.LEATHER, round: 0.35, rot: [0, sd * 1.2, 0] });
    }
    const at = surfPoint(T, PI * 0.62, k.rise - 0.05, k.pP + 0.03);
    mb.seg('hips', [at[0] - hips[0], at[1] - hips[1] + 0.03, at[2] - hips[2]], [at[0] - hips[0], at[1] - hips[1] - 0.14, at[2] - hips[2]], 0.009, 0.009, { rs: 6, color: 0x8a6a40, region: CR.CANVAS });
    mb.box('hips', [at[0] - hips[0], at[1] - hips[1] + 0.035, at[2] - hips[2] - 0.01], [0.022, 0.022, 0.08], { color: 0x3a3a3a, region: CR.PLAIN });
  }
  if (g.lanyard) {
    // a lanyard round the neck, a badge card on it
    const pts = [surfPoint(T, -0.75, P.shoulderY + 0.045, k.pT + 0.004), surfPoint(T, -0.35, yC + 0.06, k.pT + 0.004), surfPoint(T, 0, yC - 0.02, k.pT + 0.006), surfPoint(T, 0.35, yC + 0.06, k.pT + 0.004), surfPoint(T, 0.75, P.shoulderY + 0.045, k.pT + 0.004)];
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 16, 1, 4, false);
    flatten(geo, pts, 0.01, 0.0015);
    const pa = geo.attributes.position;
    const wts = new Float32Array(pa.count * 4);
    for (let i = 0; i < pa.count; i++) wts.set(T.wts(pa.getY(i), pa.getX(i)), i * 4);
    mb.geom('root', geo, { color: g.lanyard, region: CR.PLAIN, wts, blood: false });
    const at = surfPoint(T, 0, yC - 0.06, k.pT + 0.008);
    mb.box('chest', [at[0] - chest[0], at[1] - chest[1], at[2] - chest[2]], [0.04, 0.055, 0.004], { color: 0xe8e8e0, region: CR.PLAIN, blood: false, tint: (p, n, c) => p.y > at[1] + 0.012 && c.setHex(0x3a6a9a) });
  }
  if (g.patch) {
    // a name patch over the heart
    const at = surfPoint(T, -0.45, yC + 0.06, k.pT + 0.002);
    pillow(mb, T, -0.7, -0.25, yC + 0.045, yC + 0.08, k.pT - 0.0005, 0.0025, { color: g.patch, region: CR.PLAIN, nu: 3, nv: 1, blood: false });
    void at;
  }
  if (g.glasses) {
    // wire-rimmed glasses: two rims, the bridge, the arms back to the ears
    const H = k.H;
    const p = new THREE.Vector3();
    const rimR = 0.019 * H.s;
    for (const sd of [-1, 1]) {
      headPoint(H, sd * H.eyeA, H.eyeY - 0.01, p);
      const t = new THREE.TorusGeometry(rimR, 0.0016, 4, 14);
      t.rotateY(sd * -0.15);
      mb.geom('head', t, { at: [p.x, p.y, p.z - 0.01], color: g.glasses, region: CR.PLAIN, blood: false });
      const ear = new THREE.Vector3();
      headPoint(H, sd * 1.5, 0.02, ear);
      mb.seg('head', [p.x + sd * rimR, p.y + 0.004, p.z - 0.006], [ear.x + sd * 0.004, ear.y, ear.z], 0.0013, 0.0013, { rs: 3, color: g.glasses, region: CR.PLAIN, blood: false });
    }
    headPoint(H, 0, H.eyeY + 0.02, p);
    mb.seg('head', [-0.012, p.y, p.z - 0.008], [0.012, p.y, p.z - 0.008], 0.0013, 0.0013, { rs: 3, color: g.glasses, region: CR.PLAIN, blood: false });
  }
  if (g.tie) {
    // a tie: the knot at the collar, its blade down the shirt front
    const pts = [P.shoulderY + 0.04, yC + 0.06, yC - 0.04, P.spineY + 0.02].map((y) => surfPoint(T, 0, y, k.pT + 0.004));
    edgeTube(mb, T, pts, 0.004, { color: g.tie, region: CR.COTTON, rs: 4 });
    for (let i = 0; i < 3; i++) {
      const a = surfPoint(T, -0.06 - i * 0.03, lerp(pts[1][1], pts[3][1], i / 2), k.pT + 0.006), b = surfPoint(T, 0.06 + i * 0.03, lerp(pts[1][1], pts[3][1], i / 2), k.pT + 0.006);
      edgeTube(mb, T, [a, [0, (a[1] + b[1]) / 2, Math.min(a[2], b[2]) - 0.002], b], 0.004, { color: mulC(g.tie, 0.9), region: CR.COTTON, rs: 4 });
    }
  }
  if (g.apron) {
    // an apron tied at the waist, hanging down the front of the thighs (on the hips)
    const y0 = k.rise - 0.02, y1 = P.hipY - 0.32;
    const pos = [], idx = [], nu = 6, nv = 4;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv;
      const y = lerp(y0, y1, v);
      const p = surfPoint(T, lerp(-0.85, 0.85, u), Math.max(y, T.yLo + 0.03), k.pT + 0.006);
      pos.push(p[0] * (1 + 0.15 * v), y, p[2] - 0.035 * v);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const hipsB = mb.bi('hips');
    const wts = new Float32Array(pos.length / 3 * 4);
    for (let i = 0; i < wts.length; i += 4) wts.set([hipsB, 1, 0, 0], i);
    mb.geom('root', geo, { color: g.apron, region: CR.COTTON, mottle: 0.12, double: true, keepNormals: true, wts, tint: L.dead ? bloodTint : null });
  }
  if (g.wristband) {
    const A = k.arms[g.wristband === 'L' ? 0 : 1];
    sheet(mb, A, 0, TAU, A.yW + 0.025, A.yW + 0.045, 10, 1, 0.003, { color: 0xd8dcd4, region: CR.PLAIN, blood: false });
  }
  if (g.knife) {
    const at = surfPoint(T, -PI * 0.55, k.rise - 0.05, k.pP + 0.02);
    mb.box('hips', [at[0] - hips[0], at[1] - hips[1] - 0.05, at[2] - hips[2]], [0.022, 0.15, 0.04], { color: 0x3a2a1c, region: CR.LEATHER, round: 0.3 });
  }
  void yH;
}

// ---------------------------------------------------------------- the dead
function deadExtras(mb, P, H, L, T) {
  const head = mb.bi('head'), jaw = mb.bi('jaw');
  const p = new THREE.Vector3();
  // teeth: an upper row under the lip line on the head, a lower row on the jaw (their mouths hang open)
  const rnd = mulberry32((L.missingTeeth || 0) + 17);
  const C_TEETH = color(0xcfc29a);
  const nT = 8;
  for (let i = 0; i < (FAR() ? 0 : nT); i++) {
    const phi = ((i + 0.5) / nT - 0.5) * 0.62 * (L.jawScale || 1);
    const tc = C_TEETH.clone().multiplyScalar(0.62 + rnd() * 0.4);
    const fang = L.fang && (i === 1 || i === 6) ? 1.7 : 1;
    if (!((L.missingTeeth || 0) & (1 << i))) {
      headPoint(H, phi, -0.425, p, false);
      const h = (0.012 + rnd() * 0.006) * H.s * fang;
      mb.box('head', [p.x * 0.95, p.y - h * 0.5 + 0.001, p.z + 0.0035 * H.s], [0.0078 * H.s, h, 0.0055 * H.s], { color: tc, region: CR.BONE, ao: false, blood: false, rot: [-0.1, phi, (rnd() - 0.5) * 0.3], mottle: 0.25 });
    }
    if (!((L.missingTeeth || 0) & (1 << ((i + 3) % 8)))) {
      headPoint(H, phi, -0.462, p, false);
      const h = (0.012 + rnd() * 0.007) * H.s * fang;
      const g = new THREE.BoxGeometry(0.0078 * H.s, h, 0.0055 * H.s);
      g.rotateX(0.1);
      g.rotateY(phi);
      g.translate(p.x * 0.95, p.y + h * 0.5 - 0.001, p.z + 0.0045 * H.s);
      const hb = mb.bonePos('head');
      g.translate(hb[0], hb[1], hb[2]);
      const w = new Float32Array(g.attributes.position.count * 4);
      for (let k = 0; k < w.length; k += 4) w.set([jaw, 1, head, 0], k);
      mb.geom('root', g, { color: tc, region: CR.BONE, ao: false, blood: false, mottle: 0.25, wts: w });
    }
  }
  // the inside of the mouth, dark, behind the teeth (on the head; the jaw's half drops away from it)
  headPoint(H, 0, -0.45, p, false);
  mb.ellip('head', [p.x, p.y, p.z + 0.016 * H.s], [0.026 * H.s, 0.016 * H.s, 0.014 * H.s], { ws: 8, hs: 5, color: 0x1a0303, region: CR.FLESH, ao: false, blood: false, mottle: 0.1 });
  if (L.cheekTear) {
    // a cheek torn open: a dark hole with the back teeth in it
    const sd = L.cheekTear;
    headPoint(H, sd * 0.62, -0.42, p);
    mb.ellip('head', [p.x - sd * 0.002, p.y, p.z + 0.002], [0.012 * H.s, 0.014 * H.s, 0.01 * H.s], { ws: 7, hs: 5, color: 0x1a0303, region: CR.FLESH, ao: false, blood: false });
    for (let i = 0; i < 3; i++) mb.box('head', [p.x - sd * 0.003 * i, p.y - 0.002, p.z + 0.004 + i * 0.006], [0.005, 0.009, 0.006], { color: C_TEETH, region: CR.BONE, ao: false, blood: false, rot: [0, sd * 0.6, 0] });
  }
  if (L.skullPatch) {
    // scalp torn away: bare, blood-rimmed skull showing through
    const sp = L.skullPatch;
    const dl = Math.hypot(sp[0], sp[1], sp[2]);
    const dx = sp[0] / dl, dy = sp[1] / dl, dz = sp[2] / dl;
    const cosR = Math.cos(sp[3]), cosRim = Math.cos(sp[3] * 0.75);
    const dot = (phi, lam) => {
      const cl = Math.cos(lam);
      return Math.sin(phi) * cl * dx + Math.sin(lam) * dy - Math.cos(phi) * cl * dz;
    };
    const { geo, wts } = headSurface(H, 28, 18, head, jaw, { depth: (phi, lam) => dot(phi, lam) - cosR }, 0.0015);
    for (let i = 0; i < wts.length; i += 4) {
      wts[i + 1] = 1;
      wts[i + 3] = 0;
    }
    const hb = mb.bonePos('head');
    mb.geom('head', geo, {
      color: 0xcfc2a0, region: CR.BONE, mottle: 0.25, keepNormals: true, wts, blood: false,
      tint(pp, n, c) {
        const lx = pp.x - hb[0], ly = pp.y - hb[1] - H.cy, lz = pp.z - hb[2];
        const l = Math.hypot(lx, ly, lz) || 1;
        const d = (lx * dx + ly * dy - lz * -dz * -1) / l;
        if (d < cosRim) c.lerp(C_WOUND, clamp((cosRim - d) / (cosRim - cosR), 0, 1) * 0.9);
      },
    });
  }
  // blood: the look's spatter (world-space spheres the builder tints every part with)
  if (L.blood) for (const b of L.blood) mb.blood(b[0], b[1], b[2]);
  void T;
}

/**
 * For the bosses, whose trunks and arms are their own (characters.js): a dead face on the 'head' / 'jaw' bones (teeth,
 * injuries and all) and legs from the hips down - trousers to their ragged hems, bare shins and feet below.
 */
export function deadHead(mb, P, L) {
  const H = buildHumanHead(mb, P, L);
  const f = L.face || {};
  if ((f.brow || 1) > 1.8) {
    // a brute's brow: a shelf of bone over sunken eyes, and the cheekbones under them
    const p = new THREE.Vector3();
    headPoint(H, 0, 0.21, p);
    mb.ellip('head', [p.x, p.y + 0.002 * H.s, p.z + 0.006 * H.s], [0.062 * H.s * (f.w || 1), 0.016 * H.s, 0.024 * H.s], { ws: 12, hs: 5, color: mulC(L.skin, 0.9), region: CR.ROT, mottle: 0.15, tint: skinTint(L), shape: (v) => { v.z += (v.x * v.x) * 9 / H.s; } });
    for (const sd of [-1, 1]) {
      headPoint(H, sd * 0.72, -0.06, p);
      mb.ellip('head', [p.x - sd * 0.004 * H.s, p.y, p.z + 0.006 * H.s], [0.02 * H.s, 0.014 * H.s, 0.02 * H.s], { ws: 7, hs: 5, color: mulC(L.skin, 0.95), region: CR.ROT, mottle: 0.15, tint: skinTint(L) });
    }
  }
  if (L.hair) hair(mb, P, H, L, 0.6);
  deadExtras(mb, P, H, L, null);
  return H;
}
export function deadLegs(mb, P, L) {
  const B = bodyBuild(L);
  const skin = color(L.skin);
  const skinO = { color: skin, region: CR.ROT, mottle: 0.12, tint: skinTint(L) };
  for (const side of [-1, 1]) {
    const Lg = legSurf(mb, P, B, side);
    const rsL = 14;
    const nv = (a, b) => Math.max(2, Math.round((b - a) / (0.048 * Math.max(1, B.leg * 0.6))));
    if (L.pants) {
      const yb = Lg.yA + 0.04 + (L.pants.tearY ?? 0.2) * (Lg.yT - Lg.yA) * 0.9;
      const fnHem = (x, y, z) => y < yb + 0.06 * B.leg * fbm3(x * 25, y * 4, z * 25, 2, 11 + side);
      sheet(mb, Lg, 0, TAU, yb, Lg.yHi, rsL, nv(yb, Lg.yHi), 0.006 * B.leg, { color: L.pants.color, region: L.pants.region ?? CR.DENIM, mottle: 0.12, tint: L.pants.tint, tear: { amt: L.pants.tear || 0.1, f: 13, seed: 81 + side, fn: fnHem } });
    }
    sheet(mb, Lg, 0, TAU, Lg.yLo, Lg.yHi, rsL, nv(Lg.yLo, Lg.yHi), 0, skinO);
    bareFoot(mb, P, L, side, skin);
  }
}

export { woundTint, skinTint };
