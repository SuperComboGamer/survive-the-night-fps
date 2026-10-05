// What the performance pass added that could break without anyone seeing it (docs/performance.md), checked in node
// with no browser:
//   - the multi-draw mesh (render/multimesh.js): the runs it picks for a frustum are exactly the ones a mesh each
//     would have drawn - nothing in sight is culled, nothing out of sight or out of range is drawn - on the real
//     static world of an island and of a mainland, from many eyes;
//   - the static world's buffers: every vertex of every material is in exactly one run, the shadow casters cover the
//     runs that cast and no others, and the vertex data is not kept after it is on the card;
//   - the terrain: every cell of the heightfield is in exactly one piece of the one index buffer;
//   - the view the vegetation is culled to (render/foliage.js ViewCull): while it holds, nothing the camera can see
//     is outside it, whichever way the camera has turned or moved since;
//   - the crowd (render/crowd.js): a row of bones per zombie, no two sharing one; who is drawn is who is in the view,
//     who casts is who is in the shadows' range; a zombie that leaves gives its row back and is drawn by its own mesh;
//   - the level of detail of the dead: the far copy past 15 m, the near one again inside 12 m, and the same picture
//     of where the head is either way;
//   - how often a zombie is posed, and how often the shadow maps are drawn: every frame at ordinary frame rates.
// usage: node scripts/test-perf.js [seed]
import './clip/dom-stub.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const THREE = await import('three');
const { worldFor } = await import('../shared/worlds.js');
const { WORLD } = await import('../shared/acts.js');
const { ZTYPE, ZANIM } = await import('../shared/defs.js');
const { MultiMesh, ALWAYS, isShadowFrustum } = await import('../client/render/multimesh.js');
const { StaticWorld } = await import('../client/render/staticworld.js');
const { buildTerrain } = await import('../client/render/terrain.js');
const { ViewCull, VIEW_PAD, VIEW_TURN, VIEW_MOVE } = await import('../client/render/foliage.js');
const { Crowd, MAX_BONES } = await import('../client/render/crowd.js');
const { createZombie, setZombieViewer } = await import('../client/render/models/characters.js');
const { getCrowdMaterial, crowdBones } = await import('../client/render/models/skinning.js');
const { POSE_NEAR, POSE_HZ, SHADOW_HZ, ShadowRate } = await import('../client/render/rates.js');

const seed = +(process.argv[2] || 1337);
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
};
let rs = seed >>> 0 || 1;
const rnd = () => {
  rs = (rs + 0x6d2b79f5) | 0;
  let t = Math.imul(rs ^ (rs >>> 15), 1 | rs);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const cameraAt = (x, y, z, yaw, pitch, fov = 75, aspect = 16 / 9, far = 520) => {
  const c = new THREE.PerspectiveCamera(fov, aspect, 0.05, far);
  c.rotation.order = 'YXZ';
  c.position.set(x, y, z);
  c.rotation.set(pitch, yaw, 0);
  c.updateMatrixWorld();
  return c;
};
const frustumOf = (c) => new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse));
const sphere = new THREE.Sphere();

// ---------------------------------------------------------------- the static world, on both maps
for (const [name, act, eyes] of [['island', WORLD.ISLAND, 60], ['mainland', WORLD.MAINLAND, 40]]) {
  const world = worldFor(seed, act);
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  scene.add(sun);
  const sw = new StaticWorld(scene, world);
  const multi = sw.multi.filter((m) => !m.shadowOnly);
  const casters = sw.multi.filter((m) => m.shadowOnly);
  // every vertex in exactly one run
  let whole = true, verts = 0;
  for (const m of sw.multi) {
    const runs = m.runs.slice().sort((a, b) => a.first - b.first);
    let at = runs.length ? runs[0].first : 0;
    for (const r of runs) {
      if (m.shadowOnly ? r.first < at : r.first !== at) whole = false;
      at = r.first + r.count;
      if (r.count % 3) whole = false;
    }
    if (!m.shadowOnly) {
      verts += at;
      if (at !== m.geometry.attributes.normal.count) whole = false;
    }
  }
  check(`${name}: every vertex of every material is in exactly one run of its mesh (${multi.length} materials, ${(verts / 3e6).toFixed(2)} M triangles, ${sw.single.length} see-through pieces on their own)`, whole && multi.length > 20);
  // the casters stand in for exactly the runs that cast without a texture of their own
  const castVerts = casters.reduce((a, c) => a + c.runs.reduce((b, r) => b + r.count, 0), 0);
  const wantCast = multi.reduce((a, m) => a + m.runs.filter((r) => r.side < 3).reduce((b, r) => b + r.count, 0), 0);
  const ownCast = multi.every((m) => m.castRuns.every((r) => r.side === 3) && m.castShadow === m.castRuns.length > 0);
  check(`${name}: the shadow casters hold every run that casts and nothing else, and a mesh casts for itself only what its texture cuts holes in`, castVerts === wantCast && ownCast && casters.every((c) => c.castShadow), `${castVerts} vs ${wantCast}`);
  check(`${name}: a caster is in no view, and in every shadow map's`, casters.every((c) => c.intersectsFrustum(frustumOf(cameraAt(0, 50, 0, 0, -0.5))) === false));
  // from many eyes: what is picked is what a mesh a run would have drawn
  let missed = 0, extra = 0, drawn = 0, wantN = 0;
  const C = world.city;
  for (let k = 0; k < eyes; k++) {
    const x = C && k % 2 ? C.x + (rnd() - 0.5) * 330 : (rnd() - 0.5) * world.size * 0.9;
    const z = C && k % 2 ? C.z + (rnd() - 0.5) * 330 : (rnd() - 0.5) * world.size * 0.9;
    const cam = cameraAt(x, world.heightAt(x, z) + 1.62 + (k % 5 === 0 ? 30 : 0), z, rnd() * 6.28, (rnd() - 0.5) * 0.9, 60 + rnd() * 40);
    const maxDist = 120 + rnd() * 260;
    sw.update(cam.position, maxDist);
    const fr = frustumOf(cam);
    const lim = (maxDist + sw.chunkSize * 0.75) ** 2;
    for (const m of multi) {
      const seen = m.intersectsFrustum(fr);
      // the rule each run's own mesh was drawn by: its chunk within the drawing distance, the chunk's nearest
      // point nearer than the run's own distance, its bounding sphere in the frustum
      let want = 0;
      for (const r of m.runs) {
        const c = r.chunk;
        const dx = c.cx - cam.position.x, dz = c.cz - cam.position.z;
        const near = Math.hypot(Math.max(0, Math.abs(dx) - sw.chunkSize / 2), Math.max(0, Math.abs(dz) - sw.chunkSize / 2));
        sphere.center.set(r.x, r.y, r.z);
        sphere.radius = r.r;
        if (dx * dx + dz * dz < lim && near < r.maxDist && fr.intersectsSphere(sphere)) want += r.count;
      }
      let got = 0;
      for (let i = 0; i < m.view.n; i++) got += m.view.count[i];
      if (got < want) missed += want - got;
      if (got > want) extra += got - want;
      if (seen !== want > 0) missed++;
      drawn += got;
      wantN += want;
      // the ranges are apart and in the buffer
      for (let i = 1; i < m.view.n; i++) if (m.view.first[i] < m.view.first[i - 1] + m.view.count[i - 1]) extra++;
    }
  }
  check(`${name}: from ${eyes} eyes, nothing in sight is left out and nothing out of sight is drawn (${(drawn / 3e6 / eyes).toFixed(2)} M triangles a view on average)`, missed === 0 && extra === 0 && drawn === wantN && drawn > 0, `${missed} vertices missing, ${extra} too many`);
  // the terrain
  if (act === WORLD.ISLAND || process.argv.includes('--all')) {
    const terrain = buildTerrain(world);
    const tm = terrain.children[0];
    const idx = tm.geometry.index.count;
    const sum = tm.runs.reduce((a, r) => a + r.count, 0);
    const n = Math.round(Math.sqrt(tm.geometry.attributes.position.count));
    let apart = true;
    const runs = tm.runs.slice().sort((a, b) => a.first - b.first);
    for (let i = 1; i < runs.length; i++) apart &&= runs[i].first === runs[i - 1].first + runs[i - 1].count;
    check(`${name}: the terrain is one mesh, every cell of the heightfield in exactly one of its ${tm.runs.length} pieces`, terrain.children.length === 1 && tm instanceof MultiMesh && sum === idx && apart && idx === (n - 1) * (n - 1) * 6 && tm.indexBytes === 4, `${sum} of ${idx} indices, grid ${n}`);
    const cam = cameraAt(world.start.x, world.heightAt(world.start.x, world.start.z) + 1.62, world.start.z, 1, 0);
    const fr = frustumOf(cam);
    tm.intersectsFrustum(fr);
    let want = 0;
    for (const r of tm.runs) {
      sphere.center.set(r.x, r.y, r.z);
      sphere.radius = r.r;
      if (fr.intersectsSphere(sphere)) want += r.count;
    }
    check(`${name}: ...and the pieces drawn are the ones in the frustum`, tm.view.total === want && want > 0 && want < idx, `${tm.view.total} vs ${want}`);
  }
  sw.dispose();
}

// ---------------------------------------------------------------- a MultiMesh on its own
{
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(90), 3));
  const chunkA = { on: true, near: 10 }, chunkB = { on: false, near: 0 };
  const run = (first, x, chunk, maxDist = 100) => ({ first, count: 6, x, y: 0, z: -20, r: 1, chunk, maxDist });
  const m = new MultiMesh(g, new THREE.MeshBasicMaterial(), [run(0, 0, chunkA), run(6, 1, chunkA), run(12, 2, chunkB), run(18, 3, chunkA, 5), run(24, 4, ALWAYS)]);
  const fr = frustumOf(cameraAt(0, 0, 0, 0, 0));
  m.intersectsFrustum(fr);
  check('a MultiMesh: runs side by side in the buffer are one range; a chunk that is off, or nearer than a run is drawn from, leaves its run out', m.view.n === 2 && m.view.first[0] === 0 && m.view.count[0] === 12 && m.view.first[1] === 24 && m.view.count[1] === 6 && m.view.total === 18, JSON.stringify([...m.view.first.slice(0, m.view.n), ...m.view.count.slice(0, m.view.n)]));
  m.onBeforeRender();
  check('...three is handed the first range to draw itself', g.drawRange.start === 0 && g.drawRange.count === 12);
  check('...and a mesh with nothing in sight is not drawn', m.intersectsFrustum(frustumOf(cameraAt(0, 0, 0, Math.PI, 0))) === false && m.view.n === 0);
  check('the vertex data of the static world is let go of once it is uploaded', /onUpload\(dropArray\)/.test(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../client/render/staticworld.js'), 'utf8')));
}

// ---------------------------------------------------------------- the view the vegetation is culled to
{
  const view = new ViewCull();
  let out = 0, n = 0, kept = 0, rebuilt = 0;
  for (let k = 0; k < 300; k++) {
    const fov = 55 + rnd() * 45, aspect = [16 / 9, 4 / 3, 21 / 9][k % 3];
    const base = cameraAt(rnd() * 100, 2 + rnd() * 3, rnd() * 100, rnd() * 6.28, (rnd() - 0.5) * 1.2, fov, aspect);
    view.update(base);
    const stamp = view.stamp;
    // the camera turns and moves by less than the view allows for, and may narrow (aiming)
    const turned = base.clone();
    turned.rotation.order = 'YXZ';
    const a = VIEW_TURN * 0.98 * rnd(), dir = rnd() * 6.28;
    turned.rotation.set(base.rotation.x + Math.sin(dir) * a * 0.7, base.rotation.y + Math.cos(dir) * a * 0.7, (rnd() - 0.5) * 0.2 * a);
    const mv = VIEW_MOVE * 0.98 * rnd(), md = rnd() * 6.28;
    turned.position.set(base.position.x + Math.cos(md) * mv, base.position.y, base.position.z + Math.sin(md) * mv);
    if (k % 4 === 0) turned.fov = fov * 0.5;
    turned.updateProjectionMatrix();
    turned.updateMatrixWorld();
    if (base.quaternion.angleTo(turned.quaternion) >= VIEW_TURN) continue;
    view.update(turned);
    if (view.stamp !== stamp) rebuilt++;
    else kept++;
    const fr = frustumOf(turned);
    for (let i = 0; i < 60; i++) {
      // a sphere somewhere the turned camera can see
      const d = 1 + rnd() * 250;
      const p = new THREE.Vector3((rnd() - 0.5) * 2.4, (rnd() - 0.5) * 2.4, -1).normalize().multiplyScalar(d).applyMatrix4(turned.matrixWorld);
      const r = 0.3 + rnd() * 6;
      sphere.center.copy(p);
      sphere.radius = r;
      if (!fr.intersectsSphere(sphere)) continue;
      n++;
      if (!view.sees(p.x, p.y, p.z, r)) out++;
    }
  }
  check(`the vegetation's view: of ${n} things a camera could see after turning under ${((VIEW_TURN * 180) / Math.PI).toFixed(1)} degrees and moving under ${VIEW_MOVE} m, none is outside it (kept ${kept} times, made anew ${rebuilt})`, out === 0 && n > 3000 && kept > 150, `${out} outside`);
  const cam = cameraAt(0, 2, 0, 0, 0);
  view.update(cam);
  const s0 = view.stamp;
  cam.rotation.y += VIEW_TURN * 1.05;
  cam.updateMatrixWorld();
  view.update(cam);
  const s1 = view.stamp;
  cam.position.x += VIEW_MOVE * 1.05;
  cam.updateMatrixWorld();
  view.update(cam);
  const s2 = view.stamp;
  cam.fov += 6;
  cam.updateProjectionMatrix();
  view.update(cam);
  check('...it is made anew when the camera has turned or moved that far, or widened', s1 === s0 + 1 && s2 === s1 + 1 && view.stamp === s2 + 1 && VIEW_TURN < VIEW_PAD);
  check('...behind the camera is outside it', view.sees(0, 2, 60, 2) === false && view.sees(cam.position.x, 2, -60, 2) === true);
  view.update(null);
  check('...and with no camera (a sandbox page) nothing is culled', view.sees(0, 2, 60, 2) === true);
}

// ---------------------------------------------------------------- the crowd
{
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  scene.add(sun);
  const crowd = new Crowd(scene, getCrowdMaterial(), crowdBones, () => 100);
  const cam = cameraAt(0, 1.6, 0, 0, 0);
  const views = [];
  const types = [ZTYPE.WALKER, ZTYPE.RUNNER, ZTYPE.BOSS_HIVEQUEEN, ZTYPE.BAT, ZTYPE.TANK];
  for (let i = 0; i < 120; i++) {
    const v = createZombie(types[i % types.length], i);
    // a ring round the eye: a quarter of them ahead of it
    const a = (i / 120) * Math.PI * 2, d = 6 + (i % 7) * 12;
    v.object.position.set(-Math.sin(a) * d, 0, -Math.cos(a) * d);
    v.object.rotation.y = a;
    v.object.traverse((o) => o.isMesh && (o.castShadow = i % 2 === 0));
    scene.add(v.object);
    crowd.add(v.member);
    views.push(v);
  }
  const rows = new Set(views.map((v) => v.member.row));
  check('the crowd: a row of the bone texture for each zombie, no two sharing one', rows.size === views.length && crowd.texture.image.width === MAX_BONES * 4 && crowd.texture.image.height >= views.length);
  check('...its own mesh is not drawn, and it is out of the scene the renderer walks', views.every((v) => v.member.mesh.visible === false && v.object.parent === crowd.holder));
  check('...no rig has more bones than a row holds', views.every((v) => v._inst.nb <= MAX_BONES));
  scene.updateMatrixWorld();
  scene.onBeforeRender(null, scene, cam, null);
  const fr = frustumOf(cam);
  let wantView = 0, wantCast = 0;
  for (const v of views) {
    const mesh = v.member.mesh;
    mesh.updateWorldMatrix(true, false);
    sphere.copy(mesh.boundingSphere).applyMatrix4(mesh.matrixWorld);
    if (fr.intersectsSphere(sphere)) wantView++;
    if (mesh.castShadow && sphere.center.distanceTo(cam.position) < 100 + sphere.radius) wantCast++;
  }
  const count = (k) => [...crowd.batches.values()].reduce((a, b) => a + b[k].count, 0);
  check(`...who is drawn is who is in the view (${wantView} of ${views.length}), who is in the shadow maps is who casts within their range (${wantCast})`, count('view') === wantView && count('cast') === wantCast && wantView > 10 && wantView < 80 && wantCast > 10, `${count('view')} / ${wantView}, ${count('cast')} / ${wantCast}`);
  check('...a batch for each body in sight, its caster only in a shadow map', crowd.batches.size >= 5 && [...crowd.batches.values()].every((b) => b.cast.intersectsFrustum(fr) === false && b.view.frustumCulled === false));
  // the bones in the texture are the skeleton's own
  const v0 = views.find((v) => v.member.geometry === v._inst.rig.geometry && crowd.batches.get(v.member.geometry).view.count > 0);
  const bm = v0._inst.skeleton.boneMatrices;
  let same = true;
  for (let i = 0; i < bm.length; i++) same &&= crowd.data[v0.member.row * MAX_BONES * 16 + i] === bm[i];
  check("...a zombie's row is its skeleton's matrices", same && bm.length <= MAX_BONES * 16);
  // one leaves: its row is free, its mesh draws it again
  const gone = views[5];
  const row = gone.member.row;
  crowd.remove(gone.member);
  const again = createZombie(ZTYPE.WALKER, 999);
  scene.add(again.object);
  crowd.add(again.member);
  check('...one that leaves is drawn by its own mesh again, and its row goes to the next', gone.member.mesh.visible === true && gone.object.parent === scene && again.member.row === row);
  gone.dispose();
  again.dispose();
  check('...and one that is disposed of is out of the crowd', !crowd.members.has(again.member) && !crowd.members.has(gone.member));
  // hidden: not drawn
  for (const v of views) v.object.visible = false;
  scene.onBeforeRender(null, scene, cam, null);
  check('...a hidden zombie is not drawn', count('view') === 0 && count('cast') === 0);

  // ---- the level of detail of the dead
  const z = createZombie(ZTYPE.WALKER, 7);
  const inst = z._inst;
  const at = (d) => {
    z.object.position.set(0, 0, -d);
    setZombieViewer(0, 1.6, 0);
    z.update(1 / 60, ZANIM.WALK, 1.5, 10 + d, true);
    return inst.mesh.geometry === inst.rigFar.geometry;
  };
  const steps = [5, 11.9, 14.9, 15.1, 30, 15.1, 12.5, 11.9, 5].map(at);
  check('the dead: the far copy past 15 m, the near one again inside 12 m (nothing switches between the two)', steps.join() === [false, false, false, true, true, true, true, false, false].join() && inst.rigFar.tris < inst.rig.tris * 0.6 && inst.rigFar.tris > 1500, `${steps.join()} ${inst.rig.tris} / ${inst.rigFar.tris}`);
  check('...and in a crowd it is drawn with the copy it is at', (at(30), inst.member.geometry === inst.rigFar.geometry) && (at(3), inst.member.geometry === inst.rig.geometry));
  const head = new THREE.Vector3(), head2 = new THREE.Vector3();
  at(14.9);
  z.anchorWorld(z.object.userData.head, head);
  at(15.1);
  z.anchorWorld(z.object.userData.head, head2);
  check('...the head is where it was across the switch (the two copies are one skeleton)', Math.abs(head.y - head2.y) < 0.03 && Math.abs(head.x - head2.x) < 0.03, `${head.y} ${head2.y}`);
  crowd.dispose();
}

// ---------------------------------------------------------------- how often things are done
{
  check('a zombie nearer than its far copy is posed every frame, one further off at least 80 times a second', POSE_NEAR === 15 && POSE_HZ >= 80);
  check('the shadow maps are drawn every frame at 160 frames a second or fewer', SHADOW_HZ >= 160);
  const cam = cameraAt(0, 2, 0, 0, 0);
  const rate = new ShadowRate();
  const run = (dt, n) => {
    let k = 0;
    for (let i = 0; i < n; i++) if (rate.due(dt, cam)) k++;
    return k;
  };
  const at60 = run(1 / 60, 60), at144 = run(1 / 144, 144), at480 = run(1 / 480, 480);
  check('...at 60 and at 144 frames a second that is every frame; at 480 it is every third', at60 === 60 && at144 === 144 && Math.abs(at480 - 160) <= 2, `${at60} ${at144} ${at480}`);
  run(1 / 1000, 1);
  cam.position.x += 5;
  const jump = rate.due(1 / 1000, cam);
  cam.rotation.y += 0.5;
  cam.updateMatrixWorld();
  const swing = rate.due(1 / 1000, cam);
  check('...a frame the camera has jumped or swung round in always draws them', jump && swing && rate.due(1 / 1000, cam) === false);
  const light = { castShadow: true, shadow: { map: null } };
  check('...and so does one in which a light that casts has no map yet', rate.due(1 / 1000, cam, [light]) === true && rate.due(1 / 1000, cam, [{ castShadow: true, shadow: { map: {} } }]) === false);
}

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
