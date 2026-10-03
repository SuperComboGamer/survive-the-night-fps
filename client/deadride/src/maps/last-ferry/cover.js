// LAST FERRY — elevated decks and raised docks (extra levels, sight lines, mid-height cover). Stop-local coordinates. Decks are walkable colliders, legs / rails / stair sides are solid,
// stairs are stacked step boxes (0.18 m rise) so the player and the zombie nav grid can use them.
const P = Math.PI;

/** o: {x0,z0,x1,z1 deck rectangle, y deck TOP, base floor height under it, mat deck material, frame legs/rails material, legs:'nsew' subset (posts along those edges), rails:'nsew' subset,
 *  solid:true -> filled dock instead of legs, baseMat, surface/baseSurface collider surfaces, stairs:[{side:'n'|'s'|'e'|'w', at: centre along that edge, w: width, run: 0.27}], lamps:[[x,y,z,opts]]} */
export function platform(K, o) {
  const B = K.B, { x0, z0, x1, z1, y, base, mat, frame } = o; const h = y - base, W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, surf = o.surface || 'metal'; const stairs = o.stairs || [];
  B.box({ p: [cx, y - 0.14, cz], s: [W, 0.14, D], mat, bevel: 0.008, col: surf, walk: true, cast: true });
  if (o.solid) B.box({ p: [cx, base, cz], s: [W - 0.06, h - 0.14, D - 0.06], mat: o.baseMat || mat, bevel: 0.02, col: o.baseSurface || 'wood', walk: false, cast: true });
  const edge = (s) => (s === 'n' ? [[x0, z0], [x1, z0]] : s === 's' ? [[x0, z1], [x1, z1]] : s === 'w' ? [[x0, z0], [x0, z1]] : [[x1, z0], [x1, z1]]);
  // legs (posts every <= 4.5 m along the chosen edges) with X bracing between neighbours
  if (!o.solid) for (const s of (o.legs ?? 'nsew')) { const [a, b] = edge(s), L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 4.5)); const pts = []; for (let i = 0; i <= n; i++) { const t = i / n; pts.push([a[0] + (b[0] - a[0]) * t + (s === 'w' ? 0.12 : s === 'e' ? -0.12 : 0), a[1] + (b[1] - a[1]) * t + (s === 'n' ? 0.12 : s === 's' ? -0.12 : 0)]); }
    for (const q of pts) B.box({ p: [q[0], base, q[1]], s: [0.2, h - 0.14, 0.2], mat: frame, bevel: 0.01, col: 'metal', walk: false, cast: true });
    for (let i = 0; i < n; i++) { const p = pts[i], q = pts[i + 1]; B.beam([p[0], base + 0.3, p[1]], [q[0], y - 0.55, q[1]], 0.06, 0.06, { mat: frame, bevel: 0, cast: false }); B.beam([q[0], base + 0.3, q[1]], [p[0], y - 0.55, p[1]], 0.06, 0.06, { mat: frame, bevel: 0, cast: false }); } }
  // rails: posts + two rails, gaps where stairs arrive; an invisible collider follows each run
  for (const s of (o.rails ?? '')) { const [a, b] = edge(s), alongX = s === 'n' || s === 's'; const L = alongX ? b[0] - a[0] : b[1] - a[1], base0 = alongX ? a[0] : a[1], fix = alongX ? a[1] : a[0];
    const gaps = stairs.filter((t) => t.side === s).map((t) => [t.at - t.w / 2 - 0.05, t.at + t.w / 2 + 0.05]); let cur = 0; const segs = []; for (const [g0, g1] of gaps.sort((p, q) => p[0] - q[0])) { if (g0 - base0 - cur > 0.3) segs.push([base0 + cur, g0]); cur = g1 - base0; } if (L - cur > 0.3) segs.push([base0 + cur, base0 + L]);
    for (const [s0, s1] of segs) { const len = s1 - s0, m = (s0 + s1) / 2, P0 = alongX ? [s0, fix] : [fix, s0], P1 = alongX ? [s1, fix] : [fix, s1]; const n = Math.max(1, Math.round(len / 1.5));
      for (let i = 0; i <= n; i++) { const t = i / n; B.box({ p: [P0[0] + (P1[0] - P0[0]) * t, y, P0[1] + (P1[1] - P0[1]) * t], s: [0.05, 1.04, 0.05], mat: frame, bevel: 0, cast: false }); }
      for (const hh of [1.02, 0.52]) B.beam([P0[0], y + hh, P0[1]], [P1[0], y + hh, P1[1]], 0.045, 0.045, { mat: frame, bevel: 0, cast: false });
      B.colliders.addBox({ x: alongX ? m : fix, y: y + 0.55, z: alongX ? fix : m, hx: alongX ? len / 2 : 0.05, hy: 0.55, hz: alongX ? 0.05 : len / 2, surface: 'metal', walk: false }); } }
  // stairs (0.18 m rise): step boxes + side handrails + invisible side walls so nobody steps off a flight that is metres above the floor
  for (const t of stairs) { const run = t.run || 0.27, w = t.w || 1.2, n = Math.max(2, Math.ceil(h / 0.18)), rise = h / n, L = n * run; const dir = { w: [1, 0], e: [-1, 0], n: [0, 1], s: [0, -1] }[t.side]; const yaw = { w: 0, e: P, n: -P / 2, s: P / 2 }[t.side];
    const top = t.side === 'w' ? [x0, t.at] : t.side === 'e' ? [x1, t.at] : t.side === 'n' ? [t.at, z0] : [t.at, z1]; const start = [top[0] - dir[0] * L, top[1] - dir[1] * L];
    B.stairs({ p: [start[0], base, start[1]], n, rise, run, w, yaw, mat: o.stairMat || mat, col: o.stairSurface || 'metal' });
    const lat = [-dir[1], dir[0]]; if (h > 1.4) for (const sd of [-1, 1]) { const bx = start[0] + lat[0] * sd * (w / 2 + 0.04), bz = start[1] + lat[1] * sd * (w / 2 + 0.04); B.beam([bx + dir[0] * run * 0.5, base + 0.95, bz + dir[1] * run * 0.5], [bx + dir[0] * (L - run * 0.5), y + 0.95, bz + dir[1] * (L - run * 0.5)], 0.045, 0.045, { mat: frame, bevel: 0, cast: false });
      for (const f of [0.02, 0.5, 0.98]) B.box({ p: [bx + dir[0] * L * f, base + (y - base) * f, bz + dir[1] * L * f], s: [0.05, 0.95, 0.05], mat: frame, bevel: 0, cast: false });
      B.colliders.addBox({ x: (start[0] + top[0]) / 2 + lat[0] * sd * (w / 2 + 0.08), y: (base + y + 1.0) / 2, z: (start[1] + top[1]) / 2 + lat[1] * sd * (w / 2 + 0.08), hx: Math.abs(dir[0]) * L / 2 + Math.abs(lat[0]) * 0.04, hy: (y + 1.0 - base) / 2, hz: Math.abs(dir[1]) * L / 2 + Math.abs(lat[1]) * 0.04, surface: 'metal', walk: false }); } }
  for (const [lx, ly, lz, lo] of (o.lamps || [])) { B.cyl({ p: [lx, ly - 0.05, lz], r: [0.2, 0.06], h: 0.2, seg: 8, mat: frame, cast: false }); K.lamp([lx, ly - 0.15, lz], lo || { color: 0xffb060, cd: 20, dist: 14, size: 0.45, refl: 2.6 }); }
}
