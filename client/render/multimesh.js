// One mesh that draws many separate runs of one vertex (or index) buffer in a single draw call.
//
// three draws a mesh with one call, and culls it with one bounding sphere. The static world and the terrain are a
// great many pieces that share a material: drawn as a mesh each they are hundreds of draw calls a frame (and it is
// the issuing of draw calls, not the triangles, that a frame's time on the CPU goes on); drawn as one mesh they
// cannot be culled. A MultiMesh keeps both: its buffer holds a run for every piece, each with its own bounding
// sphere, and what is drawn is the runs that are in the frustum being drawn - picked when three asks the mesh
// whether it is in that frustum (the view's, or a shadow map's: each gets its own list, since the shadow maps are
// drawn between the view's culling and its drawing). three then draws the first run itself and the rest follow in
// one WEBGL_multi_draw call, with the program, the uniforms and the vertex arrays three has just set up.
//
// A run: { first, count (vertices, or indices of an indexed geometry), x, y, z, r (its bounding sphere),
// chunk: { on, near } and maxDist (it is drawn while chunk.on and chunk.near < maxDist: StaticWorld.update) }.
import * as THREE from 'three';

let multiDraw; // WEBGL_multi_draw, or null where the browser has not got it (undefined: not asked yet)

// Whether a frustum is a shadow map's (a light's of the scene the mesh is in) and not a view's. Each frustum is
// looked up among the lights once; the scene's lights are a fixed set (ARCHITECTURE.md).
const known = new WeakMap(); // scene -> Map(frustum -> boolean)
function isShadowFrustum(object, frustum) {
  let root = object;
  while (root.parent) root = root.parent;
  let map = known.get(root);
  if (!map) known.set(root, (map = new Map()));
  let yes = map.get(frustum);
  if (yes === undefined) {
    yes = false;
    root.traverse((o) => {
      const sh = o.isLight && o.shadow;
      for (let i = 0; sh && i < sh.getViewportCount(); i++) yes ||= sh.getFrustum(i) === frustum;
    });
    map.set(frustum, yes);
  }
  return yes;
}

/** A chunk for runs that are always drawn when in the frustum. */
export const ALWAYS = { on: true, near: 0 };

export class MultiMesh extends THREE.Mesh {
  // casts(run): whether that run goes into shadow maps from this mesh (while mesh.castShadow);
  // shadowOnly: a shadow caster (it is in no view)
  constructor(geometry, material, runs, { casts = () => true, shadowOnly = false } = {}) {
    super(geometry, material);
    this.matrixAutoUpdate = false;
    this.runs = runs;
    this.castRuns = runs.filter(casts);
    this.shadowOnly = shadowOnly;
    const n = runs.length;
    const list = () => ({ first: new Int32Array(n), count: new Int32Array(n), n: 0, total: 0 });
    this.view = list();
    this.shadow = list();
    // (an indexed geometry: the multi-draw wants byte offsets into the index buffer)
    this.indexBytes = geometry.index ? geometry.index.array.BYTES_PER_ELEMENT : 0;
    this.indexType = this.indexBytes === 4 ? 5125 : this.indexBytes === 2 ? 5123 : 5121; // UNSIGNED_INT / _SHORT / _BYTE
    if (this.indexBytes) this.offsets = new Int32Array(n);
    geometry.setDrawRange(0, 0);
    // never used to cull (intersectsFrustum is the mesh's own), and three must not make one from an array that
    // was let go of once it was on the card
    if (!geometry.boundingSphere) geometry.boundingSphere = new THREE.Sphere();
    this.frustumCulled = true; // (so that three asks)
  }

  pick(runs, frustum, out) {
    const planes = frustum.planes;
    let n = 0, total = 0, end = -1;
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      const c = run.chunk;
      if (!c.on || c.near >= run.maxDist) continue;
      let inside = true;
      for (let p = 0; p < 6; p++) {
        const pl = planes[p];
        if (pl.normal.x * run.x + pl.normal.y * run.y + pl.normal.z * run.z + pl.constant < -run.r) {
          inside = false;
          break;
        }
      }
      if (!inside) continue;
      // (a run that starts where the last one ended is the same stretch of the buffer)
      if (run.first === end) out.count[n - 1] += run.count;
      else {
        out.first[n] = run.first;
        out.count[n++] = run.count;
      }
      end = run.first + run.count;
      total += run.count;
    }
    out.n = n;
    out.total = total;
    return n > 0;
  }

  intersectsFrustum(frustum) {
    if (isShadowFrustum(this, frustum)) return this.pick(this.castRuns, frustum, this.shadow);
    return !this.shadowOnly && this.pick(this.runs, frustum, this.view);
  }

  begin(list) {
    const dr = this.geometry.drawRange;
    dr.start = list.n ? list.first[0] : 0;
    dr.count = list.n ? list.count[0] : 0;
  }

  // the runs after the first: one call for all of them
  rest(renderer, list) {
    const n = list.n - 1;
    if (n < 1) return;
    const gl = renderer.getContext();
    if (multiDraw === undefined) multiDraw = renderer.extensions.get('WEBGL_multi_draw') || null;
    if (this.indexBytes) {
      const off = this.offsets;
      for (let i = 1; i <= n; i++) off[i] = list.first[i] * this.indexBytes;
      if (multiDraw) multiDraw.multiDrawElementsWEBGL(gl.TRIANGLES, list.count, 1, this.indexType, off, 1, n);
      else for (let i = 1; i <= n; i++) gl.drawElements(gl.TRIANGLES, list.count[i], this.indexType, off[i]);
    } else if (multiDraw) multiDraw.multiDrawArraysWEBGL(gl.TRIANGLES, list.first, 1, list.count, 1, n);
    else for (let i = 1; i <= n; i++) gl.drawArrays(gl.TRIANGLES, list.first[i], list.count[i]);
    // (the renderer's own counters know of the first run only)
    renderer.info.render.triangles += (list.total - list.count[0]) / 3;
    if (!multiDraw) renderer.info.render.calls += n;
  }

  onBeforeRender() {
    this.begin(this.view);
  }

  onAfterRender(renderer) {
    this.rest(renderer, this.view);
  }

  onBeforeShadow() {
    this.begin(this.shadow);
  }

  onAfterShadow(renderer) {
    this.rest(renderer, this.shadow);
  }
}
