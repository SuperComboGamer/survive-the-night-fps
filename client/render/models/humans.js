// The people: survivors and the dead that were people. Procedural, like every model in the game (see
// docs/object-clipping.md), but built as one person rather than a stack of primitives:
//   - the head is one surface laid out by azimuth and elevation (headPoint), with the brow, sockets, cheekbones, lips
//     and chin shaped into it, a painted face over it (CR.FACE / CR.FACE_Z, charTextures.js) in the same layout, and
//     eyes, lids, brows, a nose and ears set on it. The jaw is the lower face itself, skinned to the jaw bone, so it
//     drops for speech and gapes on the dead;
//   - the body is lofted: the torso is one surface from the crotch to the neck, the arms and legs each one from the
//     joint to the wrist / ankle, with their vertices weighted across the spine, the elbows and the knees so that they
//     bend instead of cracking apart (two bones a vertex; skinning.js);
//   - clothing is the visible surface of those lofts, cut by where a garment ends (a cuff, a hem, a neckline), with its
//     edges, seams, pockets, collars and the rest laid on it, so nothing under a jacket is drawn.
import * as THREE from 'three';
import { MeshBuilder, mulberry32, fbm3, noise3, clamp, lerp, smooth, color } from './skinning.js';
import { CR } from './charTextures.js';

const PI = Math.PI;
const TAU = PI * 2;
const G = (x) => Math.exp(-x * x);
const mulColorH = (c, k) => color(c).multiplyScalar(k);
const sstep = (a, b, x) => smooth((x - a) / (b - a));

// ====================================================================== the head
// Head space: the head bone's, metres, the face toward -Z. C is the middle of the cranium (the headCenter anchor of
// characters.js: hr * 0.9 above the head bone). A head is described by H, made by headShape(): its sizes, and how far
// each feature goes.

/** The shape of a head (hr: P.headR; o: a look's head options). */
export function headShape(hr, o = {}) {
  const s = hr / 0.105;
  return {
    s, hr,
    cy: hr * 0.9,
    a: 0.073 * s * (o.w ?? 1), // half width at the temples
    b: 0.106 * s * (o.h ?? 1), // crown above C
    b2: 0.1 * s * (o.h ?? 1) * (o.chin ?? 1) ** 0.5, // below C (before the jaw is shaped)
    cf: 0.09 * s, // front
    cb: 0.1 * s * (o.d ?? 1), // back
    jaw: o.jaw ?? 1, // jaw width
    chin: o.chin ?? 1, // how far the chin comes forward / down
    brow: o.brow ?? 1,
    cheek: o.cheek ?? 1,
    gaunt: o.gaunt ?? 0, // hollow cheeks and sockets (the dead, the old)
    lips: o.lips ?? 1,
    fem: o.fem ?? 0, // a softer, smaller jaw and brow
    eyeY: 0.1, // elevation of the eyes (rad)
    eyeA: 0.36, // azimuth of the eyes
    sockets: o.sockets ?? 1, // how deep the eye sockets go (the dead: deeper)
    nose: o.nose ?? 1,
    rot: o.rot ?? 0, // decay: a dead face
  };
}

const _hp = new THREE.Vector3();
/**
 * A point on the head's surface at azimuth phi (0: the middle of the face, + to the right of the head, which is +X)
 * and elevation lam (rad), relative to the head bone. out (Vector3) gets it; also returns the radial push the
 * features gave it (m).
 */
export function headPoint(H, phi, lam, out = _hp, features = true) {
  let cl = Math.cos(lam), sl = Math.sin(lam);
  const cp = Math.cos(phi), sp = Math.sin(phi);
  if (lam < 0 && cp > 0) {
    // the lower face is squarer than the skull: the front comes straight down from the nose to the chin, then turns
    // under it (its depth a superellipse, sharper the nearer the middle of the face)
    const e = 2 / (2 + 1.6 * cp * cp);
    cl = Math.pow(cl, e);
  }
  let x = sp * cl * H.a;
  let y = sl * (lam > 0 ? H.b : H.b2);
  let z = -cp * cl * (cp > 0 ? H.cf : H.cb);
  const s = H.s;
  // the lower face narrows into the jaw and the chin, and comes forward under the mouth
  if (y < 0) {
    const k = sstep(0, -0.1 * s, y);
    const front = clamp(-z / (0.085 * s), 0, 1);
    x *= 1 - (0.13 + 0.1 * (1 - H.jaw) + 0.06 * H.fem) * k - 0.09 * k * k * front * (1.2 - H.jaw * 0.4);
    z -= 0.016 * s * H.chin * sstep(-0.01 * s, -0.08 * s, y) * front;
  }
  // under the jaw: the jawline runs from the chin back and up to the angle under the ear, and the skull's base on to the
  // neck; nothing is left hanging below it
  {
    const zz = z / s;
    const floor = s * (zz < -0.065 ? -0.11 * H.chin : zz < 0.005 ? lerp(-0.11 * H.chin, -0.074, (zz + 0.065) / 0.07) : lerp(-0.074, -0.056, clamp((zz - 0.005) / 0.06, 0, 1)));
    if (y < floor) y = floor + (y - floor) * 0.12;
  }
  // the back of the skull: fuller above, tucked in at the base
  if (z > 0) {
    if (y > -0.02 * s) z *= 1 + 0.05 * G((y / s - 0.02) / 0.05);
    else z *= 1 - 0.18 * sstep(-0.02 * s, -0.07 * s, y);
  }
  let d = 0;
  if (features) {
    const ap = Math.abs(phi);
    const fr = clamp(cp * 1.6, 0, 1); // the face only
    // brow ridge, eye sockets, cheekbones, the hollows under them, the temples
    d += 0.0055 * s * H.brow * (1 - 0.45 * H.fem) * G(phi / 0.62) * G((lam - 0.215) / 0.075);
    d -= 0.0062 * s * H.sockets * G((ap - H.eyeA) / 0.16) * G((lam - H.eyeY) / 0.085);
    d -= 0.0022 * s * G(phi / 0.09) * G((lam - 0.12) / 0.06); // the bridge of the nose sits back between the eyes
    d += 0.0042 * s * H.cheek * G((ap - 0.74) / 0.2) * G((lam + 0.06) / 0.11);
    d -= 0.006 * s * H.gaunt * G((ap - 0.7) / 0.22) * G((lam + 0.33) / 0.13);
    d -= 0.0024 * s * G((ap - 1.08) / 0.22) * G((lam - 0.24) / 0.15); // temples
    // the mouth: the muzzle forward, an upper and a lower lip with the line between, the chin
    d += 0.004 * s * G(phi / 0.42) * G((lam + 0.42) / 0.16) * fr;
    d += 0.0026 * s * H.lips * G(phi / 0.2) * G((lam + 0.395) / 0.04) * fr;
    d += 0.0028 * s * H.lips * G(phi / 0.17) * G((lam + 0.49) / 0.045) * fr;
    d -= 0.0018 * s * G(phi / 0.22) * G((lam + 0.442) / 0.022) * fr;
    d -= 0.002 * s * G(phi / 0.3) * G((lam + 0.57) / 0.05) * fr; // under the lower lip
    d += 0.0045 * s * H.chin * G(phi / 0.3) * G((lam + 0.72) / 0.11) * fr;
    d -= 0.0016 * s * G((ap - 0.3) / 0.06) * G((lam + 0.36) / 0.12) * fr; // the lines from the nose to the mouth
    if (H.rot) d -= 0.004 * s * H.rot * G((ap - 0.62) / 0.3) * G((lam + 0.25) / 0.2); // the face falling in
  }
  const r = Math.hypot(x, y, z) || 1;
  const k = (r + d) / r;
  out.set(x * k, y * k + H.cy, z * k);
  return d;
}

// the head grid: denser over the face than round the back, and over the face's height than at the poles
const phiOf = (u) => PI * (0.42 * u + 0.58 * u * u * u); // u in [-1, 1]
const lamOf = (w) => (PI / 2) * (0.5 * w + 0.5 * w * w * w); // w in [-1, 1]

/**
 * The head surface: a grid over (phi, lam) through headPoint. UV = the head's layout in a FACE region (u: 0.5 + phi /
 * TAU, v: 0.5 + lam / PI). jawW(phi, lam) -> 0..1, how much of a vertex goes with the jaw. Returns { geo, wts }:
 * wts is [head, 1 - w, jaw, w] per vertex.
 */
export function headSurface(H, nu, nv, head, jaw, mask = null, push = 0, uniform = false) {
  const PH = uniform ? (u) => PI * u : phiOf, LA = uniform ? (w) => (PI / 2) * w : lamOf;
  const pos = [], uv = [], wts = [], idx = [];
  const p = new THREE.Vector3();
  // mask.depth(phi, lam): how far inside the shell a point is (> 0 inside). A vertex just outside is moved onto its
  // edge (Newton steps along the depth's gradient), so the shell ends along its line and not in steps of the grid
  const depth = mask && mask.depth;
  const inside = depth ? new Uint8Array((nu + 1) * (nv + 1)) : null;
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      let lam = LA(-1 + (2 * j) / nv);
      let phi = PH(-1 + (2 * i) / nu);
      if (depth) {
        let d = depth(phi, lam);
        inside[j * (nu + 1) + i] = d > 0 ? 1 : 0;
        for (let it = 0; it < 3 && d < 0 && d > -0.35; it++) {
          const e = 0.01;
          const gp = (depth(phi + e, lam) - depth(phi - e, lam)) / (2 * e), gl = (depth(phi, lam + e) - depth(phi, lam - e)) / (2 * e);
          const g2 = gp * gp + gl * gl;
          if (g2 < 1e-6) break;
          let sp = (-d * gp) / g2, sl = (-d * gl) / g2;
          const m = Math.hypot(sp, sl);
          if (m > 0.3) {
            sp *= 0.3 / m;
            sl *= 0.3 / m;
          }
          phi += sp;
          lam = clamp(lam + sl, -PI / 2, PI / 2);
          d = depth(phi, lam);
        }
      }
      headPoint(H, phi, lam, p);
      if (push) {
        // a shell over the head (hair, a beard): out along the head's own normal, approximately the radial
        const r = Math.hypot(p.x, p.y - H.cy, p.z);
        const k = typeof push === 'function' ? push(phi, lam) : push;
        p.set(p.x * (1 + k / r), H.cy + (p.y - H.cy) * (1 + k / r), p.z * (1 + k / r));
      }
      pos.push(p.x, p.y, p.z);
      uv.push(0.5 + phi / TAU, 0.5 + lam / PI);
      const w = jawWeight(phi, lam);
      wts.push(head, 1 - w, jaw, w);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      if (depth) {
        if (!(inside[a] | inside[b] | inside[c] | inside[d])) continue;
      } else if (mask) {
        const phi = PH(-1 + (2 * (i + 0.5)) / nu), lam = LA(-1 + (2 * (j + 0.5)) / nv);
        if (!mask(phi, lam)) continue;
      }
      idx.push(a, d, b, a, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  seamNormals(geo, nu, nv);
  return { geo, wts: new Float32Array(wts) };
}

/** How much of the head at (phi, lam) moves with the jaw: the lower face, below the mouth, out to the jaw's angle. */
export function jawWeight(phi, lam) {
  if (globalThis.__nojaw) return 0;
  return sstep(-0.4, -0.5, lam) * sstep(1.75, 1.2, Math.abs(phi)) * sstep(-1.45, -1.2, lam) + sstep(-1.2, -1.45, lam) * sstep(1.6, 0.9, Math.abs(phi)) * 0.6;
}

// the grid's first and last columns are the same seam (phi = -PI / PI): give both the same normal
function seamNormals(geo, nu, nv) {
  const n = geo.attributes.normal;
  for (let j = 0; j <= nv; j++) {
    const a = j * (nu + 1), b = a + nu;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l);
    n.setXYZ(b, x / l, y / l, z / l);
  }
}

// the facial features' places, in head layout terms
const NOSE_ROOT = 0.12, NOSE_TIP = -0.26;

/**
 * A human head (L.face: the look's head options; L.skin; L.eye: iris colour; L.brows: their colour). Built on the
 * 'head' and 'jaw' bones. dead: a corpse's face (FACE_Z, sunken clouded eyes, no lids to speak of).
 */
export function buildHumanHead(mb, P, L, detail = 1) {
  const fo = L.face || {};
  const H = headShape(P.headR, fo);
  const head = mb.bi('head'), jaw = mb.bi('jaw');
  const hb = mb.bonePos('head');
  const dead = !!L.dead;
  const skin = color(L.skin);
  const region = dead ? CR.FACE_Z : CR.FACE;
  const nu = Math.max(14, Math.round((dead ? 24 : 34) * detail)), nv = Math.max(10, Math.round((dead ? 16 : 22) * detail));
  const ew = detail < 0.7 ? 6 : dead ? 8 : 10; // the eyes' segments
  const { geo, wts } = headSurface(H, nu, nv, head, jaw);
  mb.geom('head', geo, {
    color: skin, region, mottle: 0.04, mf: 30, keepNormals: true, wts,
    tint(p, n, c) {
      if (L.headTint) L.headTint(p.x - hb[0], p.y - hb[1] - H.cy, p.z - hb[2], c);
    },
  });
  // ---- eyes
  const p = new THREE.Vector3(), q = new THREE.Vector3();
  const eyeR = 0.0118 * H.s;
  for (const sd of [-1, 1]) {
    if (L.oneEye === sd) {
      // an empty socket
      headPoint(H, sd * H.eyeA, H.eyeY, p);
      mb.ellip('head', [p.x - hb[0] * 0, p.y, p.z + eyeR * 0.5], [eyeR * 1.1, eyeR * 0.85, eyeR * 0.6], { ws: 8, hs: 6, color: 0x120605, region: CR.FLESH, ao: false, blood: false, mottle: 0 });
      continue;
    }
    headPoint(H, sd * H.eyeA, H.eyeY, p, false);
    // the eyeball sits in the socket: its front a little behind the face's surface before the socket was carved
    const nx = p.x, nz = p.z;
    const nl = Math.hypot(nx * 0.6, nz) || 1;
    const c = [p.x - (nx * 0.6 / nl) * eyeR * 0.62, p.y, p.z - (nz / nl) * eyeR * 0.62 + eyeR * 0.22];
    const toward = new THREE.Vector3(sd * 0.12, 0, -1).normalize(); // the eyes look ahead, a little apart
    const qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), toward);
    mb.ellip('head', c, [eyeR, eyeR, eyeR], {
      ws: ew, hs: ew - 2, q: qq, color: dead ? (L.eye ?? 0xb8b498) : 0xd6cec2, region: CR.PLAIN, ao: false, blood: false, mottle: 0, glow: L.eyeGlow || 0,
      tint(pp, n, cc) {
        // iris and pupil on the front of the ball
        const f = n.dot(toward);
        if (!dead) {
          if (f > 0.78) cc.copy(color(L.eye ?? 0x4a3a28)).multiplyScalar(0.7 + 0.3 * (f - 0.78) / 0.22);
          if (f > 0.95) cc.setRGB(0.02, 0.015, 0.01);
        } else if (f > 0.9) cc.multiplyScalar(0.82); // a clouded iris
        if (n.y > 0.55) cc.multiplyScalar(0.6); // under the lid's shadow
      },
    });
    // the lids: an upper lid over the top of the ball, a thin lower one, both skin; a dark lash line on the upper
    const lidC = [c[0], c[1] + eyeR * 0.05, c[2] + eyeR * 0.05];
    const lidQ = qq;
    const lid = (top) =>
      mb.ellip('head', lidC, [eyeR * 1.1, eyeR * 1.08, eyeR * 1.1], {
        ws: ew, hs: ew > 8 ? 5 : 4, t0: top ? 0 : PI * (dead ? 0.64 : 0.63), tl: top ? PI * (dead ? 0.38 : 0.45) : PI * 0.37, q: lidQ, color: skin, region: CR.SKIN_H, mottle: 0.05, blood: false,
        tint(pp, n, cc) {
          if (top && n.y < 0.32 && !dead) cc.setRGB(0.05, 0.035, 0.03); // the lashes along the lid's edge
          if (dead) cc.lerp(color(0x3a2028), top ? 0.45 : 0.6);
        },
      });
    if (detail >= 0.7) {
      lid(true);
      lid(false);
    }
  }
  // ---- nose: a loft from the root between the eyes to the tip, with the wings either side of the tip
  {
    const nm = H.nose * (fo.noseL ?? 1);
    const rings = [];
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const lam = lerp(NOSE_ROOT, NOSE_TIP, t);
      headPoint(H, 0, lam, q);
      // how far it stands off the face: a little at the root, most at the tip, rounded off under it
      const out = (0.003 + 0.017 * Math.pow(t, 1.25) * nm - (t > 0.86 ? (t - 0.86) * 0.08 : 0)) * H.s;
      const hw = (0.0072 + 0.004 * t + 0.0045 * (fo.noseW ?? 1) * t * t) * H.s;
      rings.push({ c: [q.x, q.y + (t > 0.8 ? (t - 0.8) * 0.01 * H.s : 0), q.z - out * 0.5], w: hw, d: out * 0.55 + 0.002 * H.s });
    }
    const pos = [], idx = [], rs = 8;
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      for (let k = 0; k <= rs; k++) {
        const a = (k / rs) * PI; // half round: the face closes the back
        pos.push(r.c[0] + Math.cos(a) * r.w * (1 - 0.15 * Math.sin(a)), r.c[1], r.c[2] - Math.sin(a) * r.d * (0.6 + 0.4 * Math.sin(a)) + r.d * 0.3);
      }
    }
    for (let i = 0; i < rings.length - 1; i++) {
      for (let k = 0; k < rs; k++) {
        const a = i * (rs + 1) + k, b = a + 1, c = a + rs + 1, d = c + 1;
        idx.push(a, d, b, a, c, d);
      }
    }
    // the tip's underside: a fan to the last ring's middle, set back toward the lip
    const last = rings[rings.length - 1];
    const ci = pos.length / 3;
    pos.push(last.c[0], last.c[1] - 0.004 * H.s, last.c[2] + last.d * 0.4);
    const lr = (rings.length - 1) * (rs + 1);
    for (let k = 0; k < rs; k++) idx.push(lr + k, lr + k + 1, ci);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    if (!(dead && fo.noNose)) {
      mb.geom('head', g, {
        color: skin, region: CR.SKIN_H, mottle: 0.04,
        tint(pp, n, c) {
          if (n.y < -0.6) c.multiplyScalar(0.72); // underside
          if (dead) c.lerp(color(0x5a3a30), 0.15);
        },
      });
      // the wings of the nose, and the nostrils under them
      const tip = rings[rings.length - 2];
      for (const sd of [-1, 1]) {
        mb.ellip('head', [tip.c[0] + sd * tip.w * 0.82, tip.c[1] - 0.004 * H.s, tip.c[2] + tip.d * 0.7], [0.0058 * H.s * (fo.noseW ?? 1) ** 0.5, 0.0052 * H.s, 0.0068 * H.s], {
          ws: 7, hs: 5, color: skin, region: CR.SKIN_H, mottle: 0.04,
          tint(pp, n, c) {
            if (n.y < -0.3 && Math.abs(n.x) < 0.7) c.multiplyScalar(0.45);
          },
        });
      }
    } else {
      // rotted away: two dark slits where it was
      headPoint(H, 0, -0.18, q);
      mb.ellip('head', [q.x, q.y, q.z + 0.004 * H.s], [0.009 * H.s, 0.012 * H.s, 0.004 * H.s], { ws: 6, hs: 4, color: 0x140605, region: CR.FLESH, ao: false, blood: false, mottle: 0 });
    }
  }
  // ---- ears: a flattened shell with a rim, a little behind the middle of each side
  for (const sd of [-1, 1]) {
    if (L.noEar === sd) continue;
    headPoint(H, sd * 1.62, -0.08, q, false);
    const ex = q.x - sd * 0.001 * H.s;
    mb.ellip('head', [ex, q.y, q.z + 0.004 * H.s], [0.0075 * H.s, 0.027 * H.s * (fo.ear ?? 1), 0.016 * H.s * (fo.ear ?? 1)], {
      ws: detail < 0.7 ? 5 : 7, hs: detail < 0.7 ? 4 : 5, rot: [0.18, sd * 0.22, 0], color: mulColorH(skin, 0.92), region: CR.SKIN_H, mottle: 0.05,
      shape(v) {
        if (v.y < 0) v.z *= 0.85; // the lobe
      },
      tint(pp, n, c) {
        if (n.x * sd > 0.55) c.multiplyScalar(0.82); // the bowl
        if (dead) c.lerp(color(0x4a3a40), 0.25);
      },
    });
  }
  // ---- brows: a short, thick tube along the brow line, the hair's colour
  if (!L.noBrows) {
    const bc = color(L.brows ?? L.hair?.color ?? 0x2a2018);
    for (const sd of [-1, 1]) {
      const pts = [];
      for (let i = 0; i < 4; i++) {
        const a = lerp(0.11, 0.6, i / 3);
        headPoint(H, sd * a, 0.2 + 0.035 * Math.sin((i / 3) * PI) - i * 0.006 + (fo.browUp ?? 0), q);
        pts.push([q.x, q.y, q.z - 0.0012 * H.s]);
      }
      const thick = (fo.browT ?? 1) * (H.fem ? 0.0019 : 0.0026) * H.s;
      mb.tube('head', pts, thick * 1.15, thick * 0.6, { rs: 4, ts: 6, sx: 1, color: bc, region: CR.HAIR_H, mottle: 0.15, blood: false, cap: false });
    }
  }
  return H;
}

/** Where the mouth's inside goes (createMouth in characters.js): the lip line in the middle of the face. */
export function mouthAnchor(H) {
  const q = new THREE.Vector3();
  headPoint(H, 0, -0.442, q);
  return q;
}

// ====================================================================== the body
// A surface S is a stack of cross-sections up a body part in bind pose: S.ring(y) -> { cx, cz, w, df, db, n, bumps },
// S.wts(y, x) -> [bone a, weight a, bone b, weight b]. A cross-section's angle t runs from the front (-Z, t = 0) round
// by the right (+X, t = PI / 2). Everything a garment lays on the body (a pocket, a collar, a strap) is sampled off the
// same S, so it follows the body's curves.

const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** A cross-section's point at angle t, pushed out by `push` (m): [x, z] about the section's middle. */
function secXZ(r, t, push = 0) {
  const s = Math.sin(t), c = Math.cos(t), e = 2 / (r.n || 2);
  const dz = c > 0 ? r.df : r.db;
  let x = Math.sign(s) * Math.pow(Math.abs(s), e) * r.w;
  let z = -Math.sign(c) * Math.pow(Math.abs(c), e) * dz;
  let k = push;
  if (r.bumps) for (const b of r.bumps) k += b.k * G(angDiff(t, b.t) / b.s);
  if (k) {
    // out along the section's normal (the ellipse's, near enough)
    const nx = x / (r.w * r.w), nz = z / (dz * dz);
    const l = Math.hypot(nx, nz) || 1;
    x += (nx / l) * k;
    z += (nz / l) * k;
  }
  return [x, z];
}

/** Rings by height from a table of [y, w, df, db, n, cx, cz]: interpolated, so a surface can be cut anywhere. */
function ringTable(rows) {
  return (y) => {
    let i = 0;
    while (i < rows.length - 2 && rows[i + 1][0] < y) i++;
    const a = rows[i], b = rows[i + 1];
    const t = clamp((y - a[0]) / (b[0] - a[0] || 1), 0, 1);
    const u = smooth(t) * 0.5 + t * 0.5;
    return { w: lerp(a[1], b[1], u), df: lerp(a[2], b[2], u), db: lerp(a[3], b[3], u), n: lerp(a[4] || 2, b[4] || 2, u), cx: lerp(a[5] || 0, b[5] || 0, u), cz: lerp(a[6] || 0, b[6] || 0, u) };
  };
}

/** A point on S at (t, y), pushed out by push: [x, y, z]. */
export function surfPoint(S, t, y, push = 0) {
  const r = S.ring(y);
  const [x, z] = secXZ(r, t, push + (S.dr ? S.dr(t, y) : 0));
  return [S.x + r.cx + x, y, S.z + r.cz + z];
}

/**
 * A sheet of S over angles [t0, t1] and heights [y0, y1] (nu x nv quads), pushed out by push (m, or (t, y, u, v) =>
 * m), added to mb as one part on its own skin weights. o: the part's options (colour, region, tint, tear...), plus
 * cap0 / cap1: close the bottom / top with a fan to a point that far below / above the end ring.
 */
export function sheet(mb, S, t0, t1, y0, y1, nu, nv, push, o = {}) {
  const full = Math.abs(t1 - t0 - TAU) < 1e-6;
  const pos = [], uv = [], wts = [], idx = [];
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const y = lerp(y0, y1, v);
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const t = lerp(t0, t1, u);
      const k = typeof push === 'function' ? push(t, y, u, v) : push;
      const p = surfPoint(S, t, y, k);
      pos.push(p[0], p[1], p[2]);
      uv.push(u * (o.uRep || 1), v * (o.vRep || 1));
      const w = S.wts(y, p[0]);
      wts.push(w[0], w[1], w[2], w[3]);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const cap = (j, dy) => {
    const y = lerp(y0, y1, j / nv);
    const r = S.ring(y);
    const ci = pos.length / 3;
    pos.push(S.x + r.cx, y + dy, S.z + r.cz);
    uv.push(0.5, j / nv);
    const w = S.wts(y + dy, S.x + r.cx);
    wts.push(w[0], w[1], w[2], w[3]);
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      if (dy < 0) idx.push(a, a + 1, ci);
      else idx.push(a + 1, a, ci);
    }
  };
  if (o.cap0 !== undefined) cap(0, -o.cap0);
  if (o.cap1 !== undefined) cap(nv, o.cap1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  if (o.normY) {
    // (o.normY(y): how much of its normal's tilt up or down a vertex keeps - the crotch's underside lit like the thighs)
    const n = geo.attributes.normal, pa = geo.attributes.position;
    for (let i = 0; i < n.count; i++) {
      const k = o.normY(pa.getY(i));
      if (k >= 1) continue;
      const x = n.getX(i), y = n.getY(i) * k, z = n.getZ(i);
      const l = Math.hypot(x, y, z) || 1;
      n.setXYZ(i, x / l, y / l, z / l);
    }
  }
  if (full) {
    const n = geo.attributes.normal;
    for (let j = 0; j <= nv; j++) {
      const a = j * (nu + 1), b = a + nu;
      const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
      const l = Math.hypot(x, y, z) || 1;
      n.setXYZ(a, x / l, y / l, z / l);
      n.setXYZ(b, x / l, y / l, z / l);
    }
  }
  return mb.geom('root', geo, { ...o, keepNormals: true, wts: new Float32Array(wts) });
}

/**
 * A pillow on S: a patch over [t0, t1] x [y0, y1] standing `h` proud of `base` in the middle and flush at its edges
 * (a pocket, a patch, a flap, a knee pad). round: how soon it reaches full height from the edge (0..0.5).
 */
export function pillow(mb, S, t0, t1, y0, y1, base, h, o = {}) {
  const round = o.round ?? 0.25;
  const edge = (x) => smooth(Math.min(x, 1 - x) / round);
  return sheet(mb, S, t0, t1, y0, y1, o.nu || 4, o.nv || 3, (t, y, u, v) => base + h * Math.min(edge(u), edge(v)), o);
}

// ---------------------------------------------------------------- skin weights
function blendW(a, b, t) {
  t = clamp(t, 0, 1);
  return t <= 0 ? [a, 1, b, 0] : t >= 1 ? [b, 1, a, 0] : [a, 1 - t, b, t];
}

/** The body's measurements from a look. */
export function bodyBuild(L) {
  const b = L.build || {};
  const f = L.sex === 'f' ? 1 : 0;
  return {
    f,
    w: b.w ?? 1, // width of the trunk
    d: b.d ?? 1, // its depth
    sh: b.sh ?? 1, // shoulders
    hips: b.hips ?? 1,
    belly: b.belly ?? 0, // a gut
    bust: b.bust ?? (f ? 0.6 : 0),
    arm: b.arm ?? 1, // limb thickness
    leg: b.leg ?? 1,
    gaunt: L.gaunt ?? b.gaunt ?? 0, // wasted: thin limbs, a sunken belly, ribs
    bloat: b.bloat ?? 0, // swollen
    neck: b.neck ?? 1,
  };
}

/** The torso: crotch to the base of the neck, weighted hips -> spine -> chest, the tops of the shoulders to the clavicles. */
export function torsoSurf(mb, P, B) {
  const yH = P.hipY, yS = P.spineY, yC = P.chestY, ySh = P.shoulderY;
  const f = B.f;
  const w = B.w, d = B.d * (1 + B.bloat * 0.3);
  const g = B.gaunt;
  const sh = B.sh * (1 - 0.08 * f);
  const hip = B.hips * (1 + 0.06 * f);
  const waist = (1 - 0.13 * f - 0.08 * g) * (1 + 0.12 * B.belly + 0.2 * B.bloat);
  const rows = [
    [yH - 0.125, 0.02 * hip * w, 0.03 * d, 0.04 * d, 2.0],
    [yH - 0.1, 0.075 * hip * w, 0.045 * d, 0.08 * d, 2.4],
    [yH - 0.055, 0.152 * hip * w, 0.076 * d, 0.104 * d * (1 + 0.05 * f), 2.6],
    [yH - 0.01, 0.164 * hip * w, 0.094 * d, 0.112 * d * (1 + 0.06 * f), 2.6],
    [yH + 0.04, lerp(0.16 * hip, 0.155 * waist, 0.3) * w, 0.097 * d * (1 + 0.15 * B.belly), 0.1 * d, 2.5],
    [yH + 0.09, 0.15 * waist * w, 0.099 * d * (1 + 0.32 * B.belly + 0.25 * B.bloat) * (1 - 0.1 * g), 0.094 * d, 2.4],
    [yS + 0.03, 0.144 * waist * w, 0.101 * d * (1 + 0.36 * B.belly + 0.3 * B.bloat) * (1 - 0.12 * g), 0.091 * d, 2.4],
    [yC - 0.04, lerp(0.15, 0.145 * waist, 0.4) * w, 0.106 * d * (1 + 0.22 * B.belly), 0.096 * d, 2.4],
    [yC + 0.03, (0.158 - 0.006 * f) * w * sh, 0.112 * d * (1 - 0.06 * f), 0.103 * d, 2.5],
    [yC + 0.085, (0.168 - 0.01 * f) * w * sh, 0.114 * d * (1 - 0.07 * f), 0.106 * d, 2.6],
    [ySh - 0.03, (0.184 - 0.012 * f) * sh, 0.103 * d, 0.102 * d, 2.8],
    [ySh + 0.008, (0.192 - 0.016 * f) * sh, 0.088 * d, 0.09 * d, 2.5],
    [ySh + 0.03, (0.17 - 0.014 * f) * sh, 0.072 * d, 0.08 * d, 2.5, 0, 0.004],
    [ySh + 0.05, (0.135 - 0.01 * f) * sh * B.neck ** 0.5, 0.064, 0.074, 2.3, 0, 0.007],
    [ySh + 0.066, 0.09 * B.neck, 0.056, 0.064, 2.1, 0, 0.009],
    [ySh + 0.078, 0.06 * B.neck, 0.052, 0.058, 2, 0, 0.01],
  ];
  const ring0 = ringTable(rows);
  const bustY = yC + 0.06;
  const ring = (y) => {
    const r = ring0(y);
    const bumps = [];
    if (B.bust > 0) {
      const k = 0.026 * B.bust * G((y - bustY) / 0.05);
      if (k > 1e-4) for (const sd of [-1, 1]) bumps.push({ t: sd * 0.5, s: 0.36, k });
    }
    if (B.belly > 0 || B.bloat > 0) {
      const k = (0.022 * B.belly + 0.02 * B.bloat) * G((y - (yS - 0.005)) / 0.09);
      if (k > 1e-4) bumps.push({ t: 0, s: 0.95, k });
    }
    if (!f && g < 0.5) {
      // pecs and shoulder blades
      const k = 0.006 * G((y - (yC + 0.08)) / 0.04);
      for (const sd of [-1, 1]) bumps.push({ t: sd * 0.42, s: 0.4, k }, { t: PI + sd * 0.55, s: 0.35, k: k * 0.8 });
    }
    // buttocks
    const kb = 0.012 * (1 + 0.4 * f) * G((y - (yH - 0.03)) / 0.045);
    for (const sd of [-1, 1]) bumps.push({ t: PI + sd * 0.42, s: 0.42, k: kb });
    r.bumps = bumps;
    return r;
  };
  const S = { x: 0, z: 0, ring, yLo: yH - 0.125, yHi: ySh + 0.078, yH, yS, yC, ySh };
  const hips = mb.bi('hips'), spine = mb.bi('spine'), chest = mb.bi('chest');
  const clavL = mb.bi('clavL'), clavR = mb.bi('clavR');
  S.wts = (y, x) => {
    if (y <= yH + 0.02) return [hips, 1, spine, 0];
    if (y <= yS) return blendW(hips, spine, (y - yH - 0.02) / (yS - yH - 0.02));
    if (y <= yC) return blendW(spine, chest, (y - yS) / (yC - yS));
    // the tops of the shoulders go a little with the collarbones (a shrug, a shoulder rolled forward)
    const c = sstep(0.1, 0.17, Math.abs(x)) * sstep(ySh - 0.06, ySh + 0.01, y) * 0.6;
    return c > 0 ? [chest, 1 - c, x < 0 ? clavL : clavR, c] : [chest, 1, spine, 0];
  };
  // the ribs of the starved: ridges round the front and sides of the lower chest
  if (g > 0.3)
    S.dr = (t, y) => {
      if (y < yC - 0.07 || y > yC + 0.09) return 0;
      const fr = clamp(Math.cos(t) * 0.7 + 0.5, 0, 1) * (Math.abs(Math.sin(t)) > 0.06 ? 1 : 0.3);
      const r = Math.abs(Math.sin(((y - yC + 0.07) * PI) / 0.032));
      return (r * r * 0.007 - 0.004) * g * fr;
    };
  return S;
}

/** The neck: a tube from inside the torso up into the head, weighted chest -> neck -> head. */
export function neckSurf(mb, P, B) {
  const nb = mb.bonePos('neck'), hb = mb.bonePos('head');
  const r0 = 0.056 * B.neck * (1 - 0.1 * B.f), r1 = 0.05 * B.neck * (1 - 0.1 * B.f);
  const y0 = nb[1] - 0.05, y1 = hb[1] + 0.022;
  const rows = [
    [y0, r0 * 1.15, r0 * 1.0, r0 * 1.05, 2, 0, nb[2]],
    [nb[1], r0, r0 * 0.92, r0, 2, 0, nb[2] + 0.004],
    [lerp(nb[1], hb[1], 0.6), r1, r1 * 0.92, r1, 2, 0, lerp(nb[2], hb[2], 0.6) + 0.006],
    [y1, r1 * 0.95, r1 * 0.85, r1 * 1.05, 2, 0, hb[2] + 0.016],
  ];
  const ring0 = ringTable(rows);
  const adam = B.f ? 0 : 0.0045;
  const S = {
    x: 0, z: 0, yLo: y0, yHi: y1,
    ring: (y) => {
      const r = ring0(y);
      if (adam) r.bumps = [{ t: 0, s: 0.3, k: adam * G((y - lerp(nb[1], hb[1], 0.45)) / 0.02) }];
      return r;
    },
  };
  const chest = mb.bi('chest'), neck = mb.bi('neck'), head = mb.bi('head');
  S.wts = (y) => (y < nb[1] ? blendW(chest, neck, (y - y0) / (nb[1] - y0)) : y < hb[1] - 0.01 ? [neck, 1, head, 0] : blendW(neck, head, ((y - hb[1] + 0.01) / 0.05) * 0.7));
  return S;
}

/** An arm (side -1 the left, 1 the right): shoulder to wrist, the elbow blended. */
export function armSurf(mb, P, B, side) {
  const n = side < 0 ? 'L' : 'R';
  const ub = mb.bonePos('uarm' + n), fb = mb.bonePos('farm' + n), hb = mb.bonePos('hand' + n);
  const a = 1.06 * B.arm * (1 - 0.12 * B.f) * (1 - 0.3 * B.gaunt) * (1 + 0.35 * B.bloat);
  const yS = ub[1], yE = fb[1], yW = hb[1];
  const lean = 1 - 0.5 * B.gaunt; // muscle bellies
  const rows = [
    [yS + 0.02, 0.034 * a, 0.034 * a, 0.034 * a, 2, -side * 0.012],
    [yS + 0.0, 0.049 * a, 0.048 * a, 0.049 * a, 2, -side * 0.004],
    [yS - 0.03, 0.053 * a, 0.052 * a, 0.052 * a, 2, side * 0.003],
    [yS - 0.075, 0.046 * a, 0.047 * a, 0.046 * a],
    [yS - 0.15, 0.043 * a, (0.042 + 0.006 * lean) * a, 0.045 * a],
    [yE + 0.045, 0.039 * a, 0.038 * a, 0.04 * a],
    [yE + 0.005, 0.037 * a, 0.036 * a, 0.039 * a],
    [yE - 0.05, (0.039 + 0.004 * lean) * a, (0.036 + 0.004 * lean) * a, 0.036 * a],
    [yE - 0.12, 0.036 * a, 0.031 * a, 0.032 * a],
    [yW + 0.03, 0.029 * a, 0.023 * a, 0.024 * a],
    [yW - 0.008, 0.028 * a, 0.022 * a, 0.023 * a],
  ];
  const S = { x: ub[0], z: ub[2], ring: ringTable(rows), yLo: yW - 0.008, yHi: yS + 0.02, yE, yW, yS, side };
  const ua = mb.bi('uarm' + n), fa = mb.bi('farm' + n);
  S.wts = (y) => (y > yE + 0.04 ? [ua, 1, fa, 0] : y < yE - 0.04 ? [fa, 1, ua, 0] : blendW(ua, fa, (yE + 0.04 - y) / 0.08));
  return S;
}

/** A leg (side -1 the left, 1 the right): hip to ankle, the knee blended, the top a little with the pelvis. */
export function legSurf(mb, P, B, side) {
  const n = side < 0 ? 'L' : 'R';
  const tb = mb.bonePos('thigh' + n), sb = mb.bonePos('shin' + n), fb = mb.bonePos('foot' + n);
  const l = B.leg * (1 + 0.05 * B.f) * (1 - 0.3 * B.gaunt) * (1 + 0.3 * B.bloat);
  const yT = tb[1], yK = sb[1], yA = fb[1];
  const lean = 1 - 0.6 * B.gaunt;
  const rows = [
    [yT + 0.085, 0.07 * l, 0.07 * l, 0.07 * l],
    [yT + 0.03, 0.084 * l, 0.083 * l, 0.086 * l],
    [yT - 0.05, 0.086 * l, 0.084 * l, 0.083 * l],
    [yT - 0.15, (0.076 + 0.004 * lean) * l, 0.078 * l, 0.074 * l],
    [yT - 0.27, 0.066 * l, 0.066 * l, 0.062 * l],
    [yK + 0.06, 0.054 * l, 0.054 * l, 0.051 * l],
    [yK + 0.005, 0.05 * l, 0.053 * l, 0.05 * l],
    [yK - 0.08, 0.047 * l, 0.042 * l, (0.053 + 0.006 * lean) * l],
    [yK - 0.17, 0.043 * l, 0.039 * l, 0.047 * l],
    [yK - 0.29, 0.037 * l, 0.036 * l, 0.036 * l],
    [yA + 0.06, 0.032 * l, 0.031 * l, 0.033 * l],
    [yA + 0.01, 0.031 * l, 0.03 * l, 0.034 * l],
  ];
  const ring0 = ringTable(rows);
  const S = {
    x: tb[0], z: tb[2], yLo: yA + 0.01, yHi: yT + 0.085, yK, yA, yT, side,
    ring: (y) => {
      const r = ring0(y);
      // the inside of the thigh flatter where the thighs meet; the kneecap
      r.bumps = [{ t: -side * PI * 0.5, s: 0.6, k: -0.007 * l * G((y - yT + 0.17) / 0.1) + 0.022 * l * G((y - yT + 0.05) / 0.06) }, { t: 0, s: 0.4, k: 0.006 * G((y - yK - 0.01) / 0.025) }];
      return r;
    },
  };
  const hips = mb.bi('hips'), th = mb.bi('thigh' + n), sh = mb.bi('shin' + n);
  S.wts = (y) => (y > yT + 0.01 ? blendW(th, hips, ((y - yT - 0.01) / 0.075) * 0.55) : y > yK + 0.04 ? [th, 1, sh, 0] : y < yK - 0.04 ? [sh, 1, th, 0] : blendW(th, sh, (yK + 0.04 - y) / 0.08));
  return S;
}
