// A collision box of a prop written by its faces, as it is read off the model: B(x0, x1, y0, y1, z0, z1) ->
// [cx, cy, cz, sx, sy, sz] (shared/props.js `boxes`). x across (the left side is -x), y up from the ground, z along
// (the nose is -z). W(half, y0, y1, z0, z1): one as wide to the left as to the right.
const r = (v) => Math.round(v * 1000) / 1000;
export const B = (x0, x1, y0, y1, z0, z1) => [r((x0 + x1) / 2), r((y0 + y1) / 2), r((z0 + z1) / 2), r(x1 - x0), r(y1 - y0), r(z1 - z0)];
export const W = (half, y0, y1, z0, z1) => B(-half, half, y0, y1, z0, z1);
