// ZombieManager — see docs/API.md §6 and src/game/zombies/README.md.
// One pooled SkinnedMesh per zombie (shared variant geometry with 3 LODs as index ranges, per-zombie material clone), our own
// FK/IK writes world-space bone matrices, procedural locomotion with planted feet (anim.js), flow-field AI (ai.js),
// hit capsules per bone, part multipliers, limb health + dismemberment (crawlers), persistent wound decals in the shader,
// Verlet ragdolls with the bullet/blast impulse at the hit point, gibs, spawn animations (walk / barricade / ladder / rise),
// map signature effects (signature.js) and audio hooks. Nothing allocates per frame in the hot loop.
import * as THREE from 'three';
import { Pose, BI, NB, RIG, HIT_BONES, HEAD_CENTER } from './rig.js';
import { REG, CAP_MASK, BONE_REGION } from './mesh.js';
import { Animator } from './anim.js';
import { ZombieAI } from './ai.js';
import { Ragdoll, PI_ as PI } from './ragdoll.js';
import { ZombieBody, DRAW } from './skin.js';
import { setZombieShaderDefines, packZ } from './shading.js';
import { REGISTRY, registerVariants as regV, resolveVariant, getVariantAssets } from './factory.js';
import { RiseScript, BarricadeScript, LadderScript } from './spawnanim.js';
import { Signature } from './signature.js';
import { makeRng, clamp, lerp, rand } from '../../core/util.js';

export { registerVariants, REGISTRY } from './factory.js';
const V3 = THREE.Vector3;
const MAX_ALIVE = 24, POOL = 34;
const _v = new V3(), _v2 = new V3(), _v3 = new V3(), _m4 = new THREE.Matrix4(), _g = { y: 0, surface: 'concrete', col: null }, _tgt = { x: 0, y: 0, z: 0, eyeY: 1.6 }, _cam = new V3(), _frus = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere();
const PART_MUL = { head: 2.0, neck: 1.5, torso: 1.0, arm: 0.8, leg: 0.8 };
// "cause of death" wound spots (rest space, on the skin; garments within ~3 cm pick the wound up too)
const WOUND_SPOTS = { neck: [0.058, 1.53, 0.0], shoulder: [0.15, 1.44, -0.05], forearm: [0.47, 1.07, -0.1], chest: [0.07, 1.27, -0.125], belly: [0.05, 1.05, -0.115],
  thigh: [0.12, 0.7, -0.09], calf: [0.1, 0.33, -0.07], back: [0.08, 1.25, 0.12], scalp: [0.03, 1.77, -0.03], cheek: [0.05, 1.575, -0.07] };
const WOUND_TYPE = { gash: 0, bullet: 0, open: 1, ribs: 1, bite: 2, bandage: 3 };
const LIMBS = ['armL', 'armR', 'legL', 'legR'];
const LIMB_OF_BONE = new Array(NB).fill(null); for (let i = 0; i < NB; i++) LIMB_OF_BONE[i] = RIG.bones[i].limb === 'head' ? 'head' : RIG.bones[i].limb;
const PART_OF_BONE = RIG.bones.map((b) => b.name === 'neck' ? 'neck' : (b.part || 'torso'));
// hit shapes: bone → [radius, useSphere]
const HIT_R = new Float32Array(NB); for (const i of HIT_BONES) HIT_R[i] = RIG.bones[i].r;
HIT_R[BI.head] = 0.105; HIT_R[BI.pelvis] = 0.14; HIT_R[BI.chest] = 0.15; HIT_R[BI.neck] = 0.055;

class Zombie {
  constructor(slot, mgr) {
    this.slot = slot; this.m = mgr; this.body = new ZombieBody(); this.pose = new Pose(); this.anim = new Animator(this.pose, makeRng(slot * 97 + 1)); this.ai = new ZombieAI(); this.rag = new Ragdoll();
    this.anim.lost = null; this.pos = this.anim.pos; this.lost = { armL: 0, armR: 0, legL: 0, legR: 0, head: 0 }; this.limbHp = { armL: 1, armR: 1, legL: 1, legR: 1 };
    this.inUse = false; this.state = 'free'; this.dead = false; this.def = null; this.id = ''; this.hp = 150; this.maxHp = 150; this.speed = 1; this.speedClass = 'walk'; this.crawler = false; this.crawlSpeed = 0.5;
    this.woundI = 0; this.voiceT = 0; this.stepT = 0; this.distCam = 99; this.deadT = 0; this.script = null; this.wetT = 0; this.lastHitT = 0; this.painT = 0; this.gib = null; this.sig = null; this.spawnDef = null; this.kind = 'walk';
    this.hideMask = CAP_MASK; this.skyVisT = 0; this.groundY = 0;
  }
  get position() { return this.pos; }
  get alive() { return !this.dead && this.inUse; }
}

export class ZombieManager {
  constructor({ gfx, world, fx, audio, pool = POOL, silent = false }) {
    this.gfx = gfx; this.world = world; this.fx = fx; this.audio = audio; this.silent = silent; // (silent: no voices or zombie foley - net/teammates.js)
    this.group = new THREE.Group(); this.group.name = 'zombies'; gfx.scene.add(this.group); gfx.vmSkip?.add(this.group);
    this.pool = []; for (let i = 0; i < pool; i++) { const z = new Zombie(i, this); this.pool.push(z); this.group.add(z.body.mesh); z.anim.onStep = (f, a) => this._onStep(z, f, a); }
    this.alive = []; this.bodies = []; // alive: living zombies (API); bodies: every in-use body (alive + corpses)
    this.round = 1; this.navT = 0; this.time = 0; this.mapId = null; this.sig = new Signature(this, pool); this.windVec = new V3(); this.voiceSets = new Map(); this.voicesPlaying = 0; this._voiceEnd = [];
    this._stepNames = new Map(); this.onKill = null; this.onHit = null; this.onAttackPlayer = null; this.onSpawn = null; this.onSpawnRise = null; this.onBoardTorn = null;
    this.stats = { updateMs: 0, updateMsAvg: 0, visible: 0, budgetLeft: 0, draw: { tris: 0, calls: 0, sunTris: 0, sunCalls: 0, spotTris: 0, spotCalls: 0, total: 0, totalCalls: 0 } }; this.player = null; this.reach = 1.25;
    this.lodDist = [6, 12]; this.maxLod0 = 3; this.farShaderDist = 6; /* beyond this distance (m) the cheaper 'far' fragment shader is used even on LOD1 geometry: a close swarm of 24 with the full shader costs 5–7 ms GPU at 1080p */ this.animLodDist = 14; this.triBudget = 1100000; this._order = new Array(POOL).fill(null); this._orderN = 0; // LOD distances (m) + triangle budget for all zombie draws per frame (main + all shadow passes)
    this.hitOut = { zombie: null, part: 'torso', t: 0, point: new V3(), normal: new V3(), bone: '', limb: null, surface: 'flesh' };
    this._dmgInfo = { killed: false, headshot: false, dismembered: false, part: 'torso', limb: null };
  }
  get count() { return this.alive.length; }
  registerVariants(mapId, defs, opts) { return regV(mapId, defs, opts); }
  /** global zombie shader switches (quality / GPU ablation tests), e.g. {ZABL_NOISE:''} — recompiles once */
  setShaderDefines(defs) { setZombieShaderDefines(defs); }
  /** cap the lights evaluated per zombie pixel (only correct when gfx orders its light pool by importance): {point: 2, spot: 1} */
  setMaxLights(o = null) { const d = {}; if (o && o.point !== undefined) d.ZABL_PL = String(o.point | 0); if (o && o.spot !== undefined) d.ZABL_SL = String(o.spot | 0); setZombieShaderDefines(d); }
  /** build all geometry of a map's variants now (avoid hitches) and warm the shaders */
  async prepare(mapId) {
    this.mapId = mapId; const ids = REGISTRY.maps.get(mapId) || []; for (const id of ids) { getVariantAssets(REGISTRY.variants.get(id)); await new Promise((r) => setTimeout(r, 0)); }
    // build every variant's voice banks now (worker-synthesised) so the first spawn of a variant never stalls
    const a = this.audio; if (a && a.zombieVoice) for (const id of ids) { const d = REGISTRY.variants.get(id); if (d && !this.voiceSets.has(id)) { let set = null; try { set = a.zombieVoice(d.voice); } catch (e) { set = null; } this.voiceSets.set(id, set); await new Promise((r) => setTimeout(r, 0)); } }
    this.warm(); return ids;
  }
  /** compile the zombie programs (main + shadow depth) once */
  warm() {
    const z = this.pool[0]; const def = REGISTRY.variants.values().next().value; if (!def) return;
    const a = getVariantAssets(def); z.body.setGeometry(a.geos[0]); z.pose.reset(); z.pose.rootPos.set(0, -500, 0); z.pose.fk(); z.body.writePose(z.pose); z.body.mesh.visible = true;
    try { this.gfx.renderer.compile(this.gfx.scene, this.gfx.camera); z.body.mesh.material = z.body.matFar; this.gfx.renderer.compile(this.gfx.scene, this.gfx.camera); z.body.mesh.material = z.body.material; } catch (e) { /* ignore */ }
    // the shadow-depth program is only built by the first shadow pass that contains a zombie (a 170–330 ms hitch mid-wave): run one full frame now with the warm zombie visible
    try { const g = this.gfx, c = g.camera.position; z.pose.rootPos.set(c.x, c.y - 1.7, c.z); z.pose.fk(); z.body.writePose(z.pose); g.sun.shadow.needsUpdate = true; for (const l of g.pool.spots) if (l.castShadow) l.shadow.needsUpdate = true; g.render(0.016, 0.0); z.pose.rootPos.set(0, -500, 0); z.pose.fk(); z.body.writePose(z.pose); } catch (e) { /* ignore */ }
    z.body.mesh.visible = false;
  }
  /** BO2 scaling: 150 hp round 1, +100/round to round 9, then ×1.1 per round; speed mix rises with the round */
  setRound(r) { this.round = r; }
  roundHealth(r = this.round) { if (r < 10) return 150 + 100 * (r - 1); let h = 950; for (let i = 10; i <= r; i++) h = Math.round(h * 1.1); return h; }
  speedMix(r = this.round) {
    const T = [[1, 0, 0], [0.85, 0.15, 0], [0.6, 0.4, 0], [0.4, 0.55, 0.05], [0.25, 0.6, 0.15], [0.15, 0.6, 0.25], [0.1, 0.5, 0.4], [0.05, 0.45, 0.5], [0.02, 0.4, 0.58], [0, 0.35, 0.65]];
    return r <= 10 ? T[r - 1] : r < 15 ? [0, 0.3, 0.7] : [0, 0.2, 0.8];
  }
  pickClass(def, r = this.round) { const mix = this.speedMix(r), w = def.speedClasses || {}; const a = mix[0] * (w.walk ?? 1), b = mix[1] * (w.run ?? 1), c = mix[2] * (w.sprint ?? 1); const s = a + b + c || 1; const x = rand() * s; return x < a ? 'walk' : x < a + b ? 'run' : 'sprint'; }

  // ---------------------------------------------------------------- spawn
  /**
   * spawn(variantId, worldPos, yaw, {hp, speed, speedClass, kind:'walk'|'barricade'|'ladder'|'rise', spawnDef, barricade, look})
   */
  spawn(variantId, pos, yaw = 0, o = {}) {
    if (this.alive.length >= MAX_ALIVE && !o.force) return null;
    const def = resolveVariant(variantId, this.mapId); if (!def) return null;
    // (co-op: o.seed makes the same zombie - look, gait, wounds - in every browser; net/coop.js)
    const seed = o.seed ?? ((rand() * 1e9) | 0); const S = makeRng(seed);
    let z = this.pool.find((p) => !p.inUse); if (!z) { z = this._oldestCorpse(); if (!z) return null; this._release(z); }
    const assets = getVariantAssets(def); const look = o.look !== undefined ? Math.min(o.look | 0, assets.geos.length - 1) : (S() * assets.geos.length) | 0; const geo = assets.geos[look];
    z.inUse = true; z.skinDirty = true; z.acc = 0; z.dead = false; z.def = def; z.id = def.id; z.variant = def.id; z.geo = geo; z.state = 'alive'; z.deadT = 0; z.crawler = false; z.gib = null; z.script = null; z.wetT = def.wet ? 999 : 0;
    z.kind = o.kind || 'walk'; z.spawnDef = o.spawnDef || null; z.barricade = o.barricade || o.spawnDef?.barricade || null;
    z.speedClass = o.speedClass || this.pickClass(def); const sc = z.speedClass;
    z.speed = o.speed ?? ({ walk: 0.9 + S() * 0.5, run: 2.4 + S() * 1.1, sprint: 4.5 + S() * 1.5 }[sc]); z.seed = seed; z.look = look; z.netId = 0; z.net = null;
    z.maxHp = z.hp = Math.round((o.hp ?? this.roundHealth()) * (def.hp ?? 1));
    for (const l of LIMBS) { z.lost[l] = 0; z.limbHp[l] = 1; } z.lost.head = 0; z.hideMask = CAP_MASK; z.woundI = 0;
    z.hatOff = o.hatOff ?? !!(def.gearDrop?.hat && S() < def.gearDrop.hat); if (z.hatOff) z.hideMask |= 1 << REG.hat; else if (geo.info?.hasHat) z.hideMask |= 1 << REG.hair; // hair shell only when the hat is off
    // body proportions
    const R = makeRng((S() * 1e9) | 0); const pick = (v, d) => (Array.isArray(v) ? lerp(v[0], v[1], R()) : v ?? d); const H = lerp(def.height[0], def.height[1], R()); const scale = H / 1.75;
    const len = z._len || (z._len = new Float32Array(NB)), gir = z._gir || (z._gir = new Float32Array(NB)); len.fill(1); gir.fill(1);
    const gBody = def.body?.girthRange ? lerp(def.body.girthRange[0], def.body.girthRange[1], R()) : 0.94 + R() * 0.14;
    for (let i = 0; i < NB; i++) { const n = RIG.bones[i].name; if (/^(pelvis|spine|chest|thigh|calf|upperarm|forearm|neck)/.test(n)) gir[i] = gBody; }
    const legL = 0.97 + R() * 0.06; len[BI['thigh.L']] = len[BI['thigh.R']] = len[BI['calf.L']] = len[BI['calf.R']] = legL;
    gir[BI.head] = len[BI.head] = 1 / Math.sqrt(scale) * (0.98 + R() * 0.04);
    z.pose.setProportions(scale, len, gir);
    // body + material uniforms
    const b = z.body; b.setGeometry(geo); b.mesh.visible = true; b.lod = 0;
    const u = b.u; u.uHide.value = z.hideMask; u.uSeed.value = R() * 10;
    const tint = def.skin?.tint || [1, 1, 1]; const tv = def.skin?.variation ?? 0.12; u.uSkinTint.value.set(tint[0] * (1 + (R() - 0.5) * tv), tint[1] * (1 + (R() - 0.5) * tv), tint[2] * (1 + (R() - 0.5) * tv));
    // layers: variant defaults, then per-spawn overrides (o.layers) and multipliers (o.layersMul) — e.g. {layers:{wet:0.4, dust:0.3}}
    const L = { ...(def.layers || {}), ...(o.layers || {}) }, M = o.layersMul || {}; const lv = (k, d) => (L[k] ?? d) * (M[k] ?? 1);
    u.uLayers.value.set(lv('wet', 0), lv('frost', 0), lv('dust', 0), lv('blood', 0.3 + R() * 0.5)); u.uLayers2.value.set(lv('burn', 0), lv('crystal', 0), 0, 0);
    const ey = def.eyes || {}; const ec = new THREE.Color(ey.color ?? 0xffa040); u.uGlow.value.set(ec.r, ec.g, ec.b, ey.glow ?? 0);
    const em = new THREE.Color(def.emissiveColor ?? 0xffe0b0); u.uEmis.value.set(em.r, em.g, em.b, 1);
    const hr = def.hair || {}; const hc = new THREE.Color(hr.color ?? 0x1a1512); u.uHair.value.set(hc.r, hc.g, hc.b, hr.amount ?? 0.8); u.uHair2.value.set(hr.hairline ?? 0.3, hr.beard ?? 0.5, hr.brows ?? 1, hr.bald ?? (R() < 0.25 ? 1 : 0));
    u.uStyle.value.set(ey.cataract ?? 0.7, def.body?.gaunt ?? 0.4, 0, 0); for (const w of u.uWounds.value) w.set(0, 0, 0, 0);
    const fc = def.facial || {}; const chance = (v, d) => R() < (v ?? d);
    u.uFace.value.set(chance(fc.moustache, 0.3) ? 0.8 + R() * 0.2 : 0, chance(fc.sideburns, 0.25) ? 1 : 0, pick(fc.age, 0.2 + R() * 0.7), chance(fc.cheekWound, 0.12) ? (R() < 0.5 ? -1 : 1) : 0);
    z.eyeGlow = ey.glow ?? 0; z.eyeGlowDark = ey.darkGlow ?? 3.0;
    // story wounds (variantDef.wounds: [{type:'bite'|'gash'|'open'|'bandage', at:'neck'|… or p:[x,y,z], r, chance, side}]) + random extras
    let wi = 0; const addW = (type, spot, r, side) => { if (wi >= 5) return; const p0 = Array.isArray(spot) ? spot : WOUND_SPOTS[spot] || WOUND_SPOTS.chest; const sx = side ?? (R() < 0.5 ? -1 : 1); u.uWounds.value[wi++].set(p0[0] * (Array.isArray(spot) ? 1 : sx), p0[1], p0[2], (WOUND_TYPE[type] ?? 0) + Math.min(0.95, r)); };
    for (const w of def.wounds || []) if (R() < (w.chance ?? 0.85)) addW(w.type, w.p || w.at, w.r ?? 0.05, w.side);
    const nx = def.extraWounds ?? (R() < 0.6 ? 1 : 0) + (R() < 0.3 ? 1 : 0); const keys = Object.keys(WOUND_SPOTS);
    for (let k = 0; k < nx; k++) { const t = R(); addW(t < 0.45 ? 'bite' : t < 0.8 ? 'gash' : 'open', keys[(R() * keys.length) | 0], t < 0.45 ? 0.04 : t < 0.8 ? 0.03 + R() * 0.02 : 0.05); }
    z.woundBase = wi;
    // animator
    const A = z.anim; A.scripted = null; A.mode = 'loco'; A.lost = z.lost; A.reset(pos, yaw, scale); A.speedClass = sc; A.handPlant = null; A.measure = false; A.attack = null;
    const id = def.idiosyncrasy || {};
    const walker = sc === 'walk';
    A.setStyle({ limp: R() < (id.limpChance ?? (walker ? 0.45 : 0.2)) ? pick(id.limp, 0.45 + R() * 0.45) : 0, limpSide: R() < 0.5 ? -1 : 1, drag: R() < (id.dragChance ?? (walker ? 0.3 : 0.08)) ? (R() < 0.5 ? 0 : 1) : -1,
      hunch: pick(id.hunch, (walker ? 0.15 : 0.05) + R() * 0.35), tilt: (R() - 0.5) * pick(id.tilt, 0.7), lean: (R() - 0.5) * 0.3, armHang: R() < (id.armHangChance ?? 0.25) ? (R() < 0.5 ? 0 : 1) : -1,
      cadenceMul: 0.9 + R() * 0.2, widthMul: 0.9 + R() * 0.4, sway: 0.9 + R() * 0.8, clearBoost: 0,
      kypho: pick(id.kypho, R() < 0.35 ? 0.3 + R() * 0.7 : R() * 0.2), headFwd: pick(id.headFwd, R() < 0.4 ? 0.3 + R() * 0.6 : 0), shDrop: R() < 0.3 ? (R() < 0.5 ? -1 : 1) * (0.4 + R() * 0.6) : 0, kneeSplay: R() < 0.3 ? R() * 0.8 : 0, toeOut: (R() - 0.35) * 0.35, loll: walker ? 0.4 + R() * 0.6 : 0.15, twitch: R() < (id.twitchChance ?? 0.35) ? 0.5 + R() * 0.5 : 0 });
    const reach = def.arms?.reach ?? (sc === 'walk' ? 0.55 : 0.2); A.arm.L.mode = R() < reach ? 'reach' : 'swing'; A.arm.R.mode = R() < reach ? 'reach' : 'swing'; if (sc === 'sprint' && R() < 0.6) { A.arm.L.mode = A.arm.R.mode = 'swing'; }
    if (geo.info?.tools?.length) A.arm.R.mode = 'swing';
    A.jawOpen = pick(def.jawOpen, 0.1 + R() * 0.2); // slack jaw: teeth read at 3-5 m
    z.ai.reset(R()); z.voiceT = 1 + R() * 5; z.painT = 0; z.stepT = 0;
    // spawn animation
    if (z.kind === 'rise') { z.state = 'spawning'; z.script = new RiseScript(z, this); this.onSpawnRise?.(z); }
    else if (z.kind === 'barricade') { z.state = 'spawning'; z.script = new BarricadeScript(z, this, z.spawnDef, z.barricade); }
    else if (z.kind === 'ladder' && z.spawnDef) { z.state = 'spawning'; z.script = new LadderScript(z, this, z.spawnDef); }
    this.sig.attach(z);
    this.alive.push(z); if (!this.bodies.includes(z)) this.bodies.push(z);
    this.onSpawn?.(z); this.onNetSpawn?.(z, o);
    if (z.kind === 'walk') this.voice(z, 'spawn', 0.5);
    return z;
  }
  /** co-op client: steer a zombie to the host's latest position for it (extrapolated a little), facing where the host says */
  _puppet(z, dt) {
    const n = z.net, A = z.anim; if (!n) { A.want.vx = A.want.vz = 0; return; }
    const age = Math.min(0.35, (performance.now() - n.t) / 1000); const tx = n.x + n.vx * age, tz = n.z + n.vz * age;
    const ex = tx - A.pos.x, ez = tz - A.pos.z; const e = Math.hypot(ex, ez);
    if (e > 4) { A.pos.x = tx; A.pos.z = tz; A.pos.y = n.y; A.want.vx = n.vx; A.want.vz = n.vz; } // (too far behind: catch up at once)
    else { A.want.vx = n.vx + ex * 2.5; A.want.vz = n.vz + ez * 2.5; }
    A.want.faceYaw = n.yaw; A.want.hasLook = true; A.want.look.set(A.pos.x - Math.sin(n.yaw) * 4, A.pos.y + 1.45, A.pos.z - Math.cos(n.yaw) * 4);
  }
  _oldestCorpse() { let best = null; for (const z of this.bodies) if (z.dead && (!best || z.deadT > best.deadT)) best = z; return best; }
  _release(z) {
    z.inUse = false; z.state = 'free'; z.body.mesh.visible = false; this.sig.detach(z); z.script = null;
    const i = this.bodies.indexOf(z); if (i >= 0) this.bodies.splice(i, 1); const j = this.alive.indexOf(z); if (j >= 0) this.alive.splice(j, 1);
  }
  clear() { for (const z of this.bodies.slice()) this._release(z); this.alive.length = 0; }
  killAll(info = { nuke: true }) { for (const z of this.alive.slice()) this._kill(z, { ...info, killed: true }, null, null, 0); }

  // ---------------------------------------------------------------- update
  update(dt, time, player) {
    const t0 = performance.now(); this.time = time; this.player = player; dt = Math.min(dt, 0.05); this._frame = (this._frame || 0) + 1;
    { const D = this.stats.draw; D.tris = Math.round(DRAW.tris); D.calls = DRAW.calls; D.sunTris = Math.round(DRAW.sunTris); D.sunCalls = DRAW.sunCalls; D.spotTris = Math.round(DRAW.spotTris); D.spotCalls = DRAW.spotCalls; D.total = D.tris + D.sunTris + D.spotTris; D.totalCalls = D.calls + D.sunCalls + D.spotCalls;
      DRAW.tris = DRAW.calls = DRAW.sunTris = DRAW.sunCalls = DRAW.spotTris = DRAW.spotCalls = 0; } // previous frame's zombie draws
    const PR = this.profile ? (this._prof ||= { ai: 0, loco: 0, dead: 0, skin: 0, sig: 0, misc: 0, n: 0 }) : null; let tp = t0; const mark = (k) => { if (!PR) return; const n = performance.now(); PR[k] += n - tp; tp = n; };
    const w = this.world; const cam = this.gfx.camera; _cam.copy(cam.position);
    this.windVec.copy(this.gfx.atmo?.wind || this.windVec);
    { const at = this.gfx.atmo; const amb = at ? Math.min(1.5, (at.sun?.intensity || 0) / 3.5 + (at.env?.intensity || 0) * 0.9) : 0.3; this.darkness = clamp(1.1 - amb * 1.1, 0, 1); }
    // nav field from the player every 0.3 s
    const T = this.targets; const multi = !!(T && T.length && !this.puppet);
    this.navT -= dt; if (this.navT <= 0 && player && !this.puppet) { this.navT = 0.3; if (multi) w.navTargets(T); else w.navTarget(player.pos.x, player.pos.z); }
    if (player) { _tgt.x = player.pos.x; _tgt.y = player.pos.y; _tgt.z = player.pos.z; _tgt.eyeY = player.eyeH ?? 1.6; _tgt.pid = 0; }
    // frustum for LOD / cull bookkeeping
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _frus.setFromProjectionMatrix(_pm);
    let vis = 0;
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const z = this.bodies[i]; if (!z.inUse) continue;
      z.distCam = Math.hypot(z.pos.x - _cam.x, z.pos.y - _cam.y, z.pos.z - _cam.z);
      if (z.dead) { mark('misc'); this._updateDead(z, dt); mark('dead'); continue; }
      const A = z.anim;
      if (z.script) {
        const r = z.script.update(dt);
        if (r === true) { z.script = null; z.state = 'alive'; }
        else if (r === 'loco') { this._locomote(z, dt, w); }
        else { A.update(dt, w, time); z.pos.y = A.pos.y; }
      } else if (this.puppet) {
        // co-op client: the host's zombie, walked toward where the host says it is (gait and feet stay local)
        this._puppet(z, dt); if (A.attack) A.tickAttack(dt); z.acc = 0; this._locomote(z, dt, w); z.skinDirty = true;
      } else if (player) {
        let tg = _tgt; if (multi) { z._tgtT = (z._tgtT || 0) - dt; if (z._tgtT <= 0 || !z._tgtRef || !T.includes(z._tgtRef)) { z._tgtT = 0.4; let bd = 1e9; for (const t of T) { const d = (t.x - z.pos.x) ** 2 + (t.z - z.pos.z) ** 2; if (d < bd) { bd = d; z._tgtRef = t; } } } tg = z._tgtRef || _tgt; } else z._tgtRef = null;
        mark('misc'); const atk = z.ai.update(z, dt, tg, this.alive, w, this.reach * z.pose.scale * (z.crawler ? 0.9 : 1)); A.lunge = z.ai.los ? clamp((3.2 - z.ai.distToTarget) / 2.2, 0, 1) : 0;
        if (atk) this._startAttack(z);
        if (A.attack && A.tickAttack(dt)) this._attackHit(z); mark('ai');
        // animation LOD: walking zombies beyond 14 m (or off-screen beyond 6 m) that are not attacking animate at half rate, alternating by slot
        // (walkers only: half-rate steps for runners / sprinters would let planted feet slip ~1 cm)
        z.acc = (z.acc || 0) + dt; const far = (z.distCam > this.animLodDist || (z.inView === false && z.distCam > 6)) && !A.attack && z.speed < 1.6 && !z.crawler;
        if (!far || ((this._frame + z.slot) & 1) === 0) { this._locomote(z, z.acc, w); z.acc = 0; z.skinDirty = true; }
        mark('loco');
      } else { this._locomote(z, dt, w); z.skinDirty = true; }
      // voice
      z.voiceT -= dt; if (z.voiceT <= 0) { z.voiceT = (z.speedClass === 'sprint' ? 1.6 : 3) + rand() * 5; this.voice(z, z.speedClass === 'sprint' && rand() < 0.5 ? 'sprint' : 'idle'); }
      if (A.voiceJaw > 0) A.voiceJaw = Math.max(0, A.voiceJaw - dt * 0.35);
      if (z.wetT > 0 && !z.def.wet) z.wetT -= dt;
      // sky visibility (IBL masking) — occasional upward probes
      z.skyVisT -= dt; if (z.skyVisT <= 0) { z.skyVisT = 1.4 + rand() * 0.8; if (z.distCam < 45) z.body.u.uSkyVis.value = this._skyVis(z); }
    }
    mark('misc');
    // LOD under a triangle budget: bodies sorted by camera distance (allocation-free insertion sort); everyone starts at LOD2,
    // then the nearest visible ones are upgraded to the LOD their distance asks for while the budget (incl. shadow passes) allows
    const ord = this._order; let nOrd = 0; // fixed-size array + count (no per-frame allocation)
    for (const z of this.bodies) { if (!z.inUse) continue; _sph.center.set(z.pose.rootPos.x, z.pose.rootPos.y + 0.9, z.pose.rootPos.z); _sph.radius = 1.6; z.inView = _frus.intersectsSphere(_sph); let i = nOrd++; while (i > 0 && ord[i - 1].distCam > z.distCam) { ord[i] = ord[i - 1]; i--; } ord[i] = z; }
    this._orderN = nOrd;
    // cost of a body = main-view LOD (if in view) + sun-shadow LOD (LOD1 for LOD0 bodies, else LOD2); spot/point shadow passes are
    // always LOD2 and taken from last frame's measured total. Three passes: (1) LOD1 for everything within 8 m, (2) LOD0 for the
    // ≤ maxLod0 nearest within lodDist[0], (3) LOD1 for the rest within lodDist[1] — so a blocky LOD2 never shows up close to the camera.
    let budget = this.triBudget - this.stats.draw.spotTris;
    for (let k = 0; k < nOrd; k++) { const z = ord[k], T = z.geo.tris; budget -= (z.inView ? T[2] : 0) + T[2]; z.body.lod = 2; }
    for (let pass = 0; pass < 3; pass++) {
      let n0 = 0;
      for (let k = 0; k < nOrd; k++) { const z = ord[k];
        if (!z.inView) continue; const T = z.geo.tris, b = z.body;
        if (pass === 0 && z.distCam < 8 && b.lod === 2 && T[1] - T[2] <= budget) { budget -= T[1] - T[2]; b.lod = 1; }
        else if (pass === 1 && z.distCam < this.lodDist[0] && n0 < this.maxLod0) { const extra = b.lod === 1 ? T[0] - T[2] : T[0] + T[1] - 2 * T[2]; if (extra <= budget) { budget -= extra; b.lod = 0; n0++; } }
        else if (pass === 2 && z.distCam < this.lodDist[1] && b.lod === 2 && T[1] - T[2] <= budget) { budget -= T[1] - T[2]; b.lod = 1; }
      }
    }
    // front-to-back: per-zombie materials defeat three's depth sort (it sorts by material id first), so renderOrder carries the
    // camera distance rank → nearer zombies fill the depth buffer first and hidden zombie pixels are rejected by early-Z
    for (let k = 0; k < nOrd; k++) { const z = ord[k], b = z.body; b.mesh.renderOrder = this.noOrder ? 0 : -64 + k; // before the world (renderOrder 0): world pixels behind zombies are rejected too b.shadowLod = b.lod === 0 ? 1 : 2; b.mesh.material = (b.lod === 2 || z.distCam > this.farShaderDist) ? b.matFar : b.material;
      const u = b.u; u.uStyle.value.w = this.darkness; u.uGlow.value.w = (z.eyeGlow || 0) + (z.eyeGlowDark ?? 1.6) * this.darkness * this.darkness; packZ(u); }
    this.stats.budgetLeft = budget;
    // culling stats, skin upload
    for (const z of this.bodies) {
      if (!z.inUse) continue; const b = z.body; const inView = z.inView; if (inView) vis++;
      z.anim.detail = b.lod === 0;
      // skip skinning uploads for bodies that are culled and too far to throw a visible shadow, or that did not animate this frame
      const needSkin = (inView || z.distCam < 10) && (z.skinDirty !== false || z.dead || z.script);
      if (needSkin) { if (z.dead && z.rag) b.writePoseAt(z.pose, z.pose.rootPos); else b.writePose(z.pose); z.skinDirty = false; }
      else if (!inView) b.mesh.position.copy(z.pose.rootPos);
      if (z.gib) z.gib.body.writePoseAt(z.gib.pose, z.gib.pose.rootPos);
    }
    mark('skin'); this.sig.update(dt, time, this.bodies, _cam, w); mark('sig');
    this._updateGibs(dt); if (PR) PR.n++;
    this.stats.visible = vis; const ms = performance.now() - t0; this.stats.updateMs = ms; this.stats.updateMsAvg = this.stats.updateMsAvg * 0.95 + ms * 0.05;
  }
  /** collision-aware root motion + ground following, then the animator */
  _locomote(z, dt, w) {
    const A = z.anim;
    // predict next root position, push it out of solids, remove the velocity component into walls
    // (net/teammates.js: a teammate already collided on their own machine - their height comes from there too - and while riding
    // a moving vehicle the world's ground under them means nothing: feet stand at the body's height)
    if (z.free) { A.pos.y += ((z.net?.y ?? A.pos.y) - A.pos.y) * Math.min(1, dt * 14); if (z.flat) w = null; }
    else {
    const nx = A.pos.x + A.vel.x * dt, nz = A.pos.z + A.vel.z * dt; _v.set(nx, A.pos.y, nz);
    const r = 0.28 * z.pose.scale;
    if (w.push(_v, r, A.pos.y, 1.7 * z.pose.scale)) { const px = _v.x - nx, pz = _v.z - nz; const pl = Math.hypot(px, pz); if (pl > 1e-5) { const nxn = px / pl, nzn = pz / pl; const vn = A.vel.x * nxn + A.vel.z * nzn; if (vn < 0) { A.vel.x -= vn * nxn; A.vel.z -= vn * nzn; } A.pos.x += px; A.pos.z += pz; } }
    const g = w.groundAt(A.pos.x, A.pos.z, A.pos.y + 0.45, _g, 0.45); const gy = g.y; z.surface = g.surface;
    A.pos.y = Math.abs(gy - A.pos.y) > 0.6 ? gy : A.pos.y + (gy - A.pos.y) * Math.min(1, dt * 14);
    }
    const PR = this._prof; let t1 = PR ? performance.now() : 0;
    // fast movers are sub-stepped when the frame is long (> 24 ms): stance lift-off timing stays exact, so planted feet never
    // stretch out of reach (without this a sprinter at 25 fps slips 1-4 cm)
    const sp = Math.hypot(A.vel.x, A.vel.z); const n = dt > 0.024 && sp > 1.8 ? Math.min(3, Math.ceil(dt / 0.018)) : 1;
    for (let i = 0; i < n; i++) A.update(dt / n, w, this.time);
    if (PR) { PR.animOnly = (PR.animOnly || 0) + performance.now() - t1; }
  }
  _startAttack(z) {
    const A = z.anim; const rr = rand(); let type = rr < 0.35 ? 0 : rr < 0.7 ? 1 : 3; const tools = z.geo.info?.tools; if (tools && tools.length && !z.lost.armR) type = 2; // 0 claw, 1 swipe, 3 grab + bite
    if (z.lost.armL && z.lost.armR) type = -1; if (type === 1 && z.lost.armR) A.startAttack(1, 'L', 0.95); else if (type === 1 && z.lost.armL) A.startAttack(1, 'R', 0.95); else if (type >= 0) A.startAttack(type, rand() < 0.5 ? 'L' : 'R', type === 2 ? 1.25 : type === 0 ? 1.05 : type === 3 ? 1.15 : 0.95);
    else A.startAttack(0, 'R', 0.9);
    this.voice(z, 'attack'); this.onNetAttack?.(z);
  }
  _attackHit(z) {
    if (this.puppet) return; const tr = z._tgtRef; const p = tr && tr.pid ? { pos: tr } : this.player; if (!p) return; const d = Math.hypot(p.pos.x - z.pos.x, p.pos.z - z.pos.z);
    if (d < this.reach * z.pose.scale + 0.35 && Math.abs(p.pos.y - z.pos.y) < 1.2) { const dmg = 45 + ((rand() * 6) | 0); if (tr && tr.pid) this.onAttackTarget?.(z, tr, dmg); else this.onAttackPlayer?.(z, dmg); this.audio?.play?.('zombie.hit', { pos: z.pos, vol: 0.9 }); }
    else this.audio?.play?.('zombie.swing', { pos: z.pos, vol: 0.5 });
  }

  // ---------------------------------------------------------------- hits
  /** closest zombie hit along a ray: out = {zombie, part, t, point, normal, bone, limb, surface} */
  raycast(ox, oy, oz, dx, dy, dz, maxT, out = this.hitOut) {
    let best = maxT, hz = null, hb = -1; const o = _v3.set(ox, oy, oz);
    for (const z of this.bodies) {
      if (!z.inUse || (z.dead && z.deadT > 6)) continue; const P = z.pose.P; const s = z.pose.scale;
      // broad phase: sphere around the chest
      const c = P[BI.spine2]; const lx = ox - c.x, ly = oy - c.y, lz = oz - c.z; const bb = lx * dx + ly * dy + lz * dz; const cc = lx * lx + ly * ly + lz * lz - (1.3 * s) ** 2; if (bb > 0 && cc > 0) continue; if (bb * bb - cc < 0) continue;
      for (const i of HIT_BONES) {
        const reg = RIG_REGION[i]; if ((z.hideMask >> reg) & 1) continue;
        let r = HIT_R[i] * s * z.pose.girth[i]; if (i === BI.head && z.def.hitHeadR) r = z.def.hitHeadR * s;
        let t;
        if (i === BI.head) { z.pose.pointOn(BI.head, HEAD_CENTER.x, HEAD_CENTER.y + (z.def.hitHeadDY || 0), HEAD_CENTER.z, _v); t = raySphere(ox, oy, oz, dx, dy, dz, _v.x, _v.y, _v.z, r); }
        else { z.pose.tail(i, _v2); t = rayCapsule(ox, oy, oz, dx, dy, dz, P[i], _v2, r); }
        if (t > 0 && t < best) { best = t; hz = z; hb = i; }
      }
    }
    if (!hz) return false;
    if (!out.point) out.point = new V3(); if (!out.normal) out.normal = new V3(); // (callers may pass a plain object once)
    hz._hb = hb; hz._hT = this.time;
    out.zombie = hz; out.t = best; out.point.set(ox + dx * best, oy + dy * best, oz + dz * best); const bone = RIG.bones[hb]; out.bone = bone.name; out.limb = LIMB_OF_BONE[hb];
    out.part = PART_OF_BONE[hb] === 'neck' ? 'head' : PART_OF_BONE[hb]; out._bi = hb; out.neck = hb === BI.neck;
    // normal from the capsule axis
    if (hb === BI.head) { hz.pose.pointOn(BI.head, HEAD_CENTER.x, HEAD_CENTER.y, HEAD_CENTER.z, _v); out.normal.subVectors(out.point, _v).normalize(); }
    else { const a = hz.pose.P[hb]; hz.pose.tail(hb, _v2); _v.subVectors(_v2, a); const L2 = _v.lengthSq() || 1; const k = clamp(_v3.subVectors(out.point, a).dot(_v) / L2, 0, 1); _v2.copy(a).addScaledVector(_v, k); out.normal.subVectors(out.point, _v2).normalize(); }
    out.surface = 'flesh';
    if (hb === BI.head && hz.def.helmetY) { this._toRest(hz, hb, out.point, _v); if (_v.y > hz.def.helmetY) out.surface = hz.def.helmetSurface || 'metal'; }
    return true;
  }
  _toRest(z, bi, wp, out) { z.pose.skinMatrix(bi, _m4); _m4.invert(); return out.copy(wp).applyMatrix4(_m4); }
  /** damage(zombie, {amount, part, dir, point, normal, impulse, weapon, explosion, headshotMul, melee}) → {killed, headshot, dismembered} */
  damage(z, o) {
    const info = this._dmgInfo; info.killed = false; info.headshot = false; info.dismembered = false; info.part = o.part || 'torso'; info.limb = null;
    if (!z || !z.inUse || z.dead) { if (z && z.dead && z.rag && o.point) { z.rag.impulse(o.point, _v.copy(o.dir || _v.set(0, 0, 0)).multiplyScalar((o.impulse ?? 3) * 6), 0.4); z.rag.asleep = false; this.fx.blood(o.point, o.normal || _v2.set(0, 1, 0), o.dir || _v2, 0.6); } return info; }
    this._inDamage = true; try { return this._damage(z, o, info); } finally { this._inDamage = false; }
  }
  _damage(z, o, info) {
    const part = o.part || 'torso'; const bi = o._bi ?? (z._hb >= 0 && this.time - z._hT < 0.25 ? z._hb : (part === 'head' ? BI.head : part === 'leg' ? BI['thigh.L'] : part === 'arm' ? BI['upperarm.R'] : BI.chest)); const limb = LIMB_OF_BONE[bi];
    const neck = bi === BI.neck; z._hb = -1; info.limb = limb;
    const mul = part === 'head' ? (neck ? PART_MUL.neck : (o.headshotMul ?? PART_MUL.head)) : (PART_MUL[part] ?? 1);
    const amt = (o.amount ?? 50) * mul; z.hp -= amt; z.lastHitT = this.time;
    const headshot = part === 'head' && !neck; info.headshot = headshot;
    const dir = o.dir || _v2.set(0, 0, 1); const point = o.point || z.pose.P[BI.chest]; const normal = o.normal || _v3.copy(dir).negate();
    // wound (rest space, persistent)
    this._addWound(z, bi, point, o.explosion ? 0.06 : o.melee ? 0.03 : 0.018 + Math.min(0.025, amt * 0.00015));
    this.fx.blood(point, normal, dir, headshot ? 1.3 : 0.7 + Math.min(0.8, amt / 200));
    // limb health + dismemberment
    let dis = false;
    if (limb && limb !== 'head' && !z.lost[limb]) {
      z.limbHp[limb] -= amt / (z.maxHp * (limb.startsWith('leg') ? 0.55 : 0.4) + 40);
      if (z.limbHp[limb] <= 0 && (z.hp > 0 || rand() < 0.5)) { this._dismember(z, limb, bi, dir, o.explosion ? 2 : (RIG.bones[bi].name.startsWith('upper') || RIG.bones[bi].name.startsWith('thigh') ? 2 : 1)); dis = true; }
    }
    info.dismembered = dis;
    const J = (o.impulse ?? 3) * (o.explosion ? 3 : 1);
    if (z.hp <= 0) {
      // head pops on big head hits
      if (headshot && (amt > z.maxHp * 0.6 || rand() < 0.35)) { this._headPop(z, point, dir); info.dismembered = true; }
      this._kill(z, { killed: true, headshot, part, weapon: o.weapon, explosion: !!o.explosion }, point, dir, J);
      info.killed = true;
    } else {
      this._toRest(z, bi, point, _v); z.anim.applyHit(bi, point, dir, J, _v); this.sig.jostle(z);
      if (this.time - z.painT > 0.35) { z.painT = this.time; this.voice(z, 'pain'); }
      if (!z.crawler && (z.lost.legL || z.lost.legR)) this._toCrawler(z);
      this.onHit?.(z, { ...info, amount: amt });
    }
    this.onNetDamage?.(z, o, info);
    return info;
  }
  _addWound(z, bi, wp, r) {
    this._toRest(z, bi, wp, _v); const nb = z.woundBase || 0; const w = z.body.u.uWounds.value[nb + (z.woundI % (8 - nb))]; w.set(_v.x, _v.y, _v.z, Math.min(0.95, r / Math.max(0.5, z.pose.scale))); z.woundI++;
  }
  _dismember(z, limb, bi, dir, level) {
    const side = limb.endsWith('L') ? 'L' : 'R'; const isArm = limb.startsWith('arm');
    const lvl = level >= 2 ? 2 : 1; z.lost[limb] = lvl;
    let mask = z.hideMask;
    if (isArm) { mask |= 1 << REG['larm' + side]; if (lvl === 2) mask |= 1 << REG['uarm' + side]; mask &= ~(1 << (lvl === 2 ? REG['capShoulder' + side] : REG['capElbow' + side])); }
    else { mask |= 1 << REG['lleg' + side]; if (lvl === 2) mask |= 1 << REG['thigh' + side]; mask &= ~(1 << (lvl === 2 ? REG['capHip' + side] : REG['capKnee' + side])); }
    z.hideMask = mask; z.body.u.uHide.value = mask;
    const jb = isArm ? (lvl === 2 ? BI['upperarm.' + side] : BI['forearm.' + side]) : (lvl === 2 ? BI['thigh.' + side] : BI['calf.' + side]);
    const jp = z.pose.P[jb]; this.fx.gore(jp, dir, 0.8); this.audio?.play?.('flesh.gib', { pos: jp, vol: 1 });
    this._spawnGib(z, limb, lvl, dir);
    if (!isArm && !z.dead) this._toCrawler(z);
  }
  _headPop(z, point, dir) {
    if (z.lost.head) return; z.lost.head = 1; z.hideMask = (z.hideMask | (1 << REG.head) | (1 << REG.hat)) & ~(1 << REG.capNeck); z.body.u.uHide.value = z.hideMask;
    const hp = z.pose.P[BI.head]; this.fx.gore(hp, dir, 1.4); this.fx.blood(hp, _v.set(0, 1, 0), dir, 2.2);
    for (let i = 0; i < 3; i++) this.fx.schedule(0.12 + i * 0.18, () => { if (z.inUse && z.dead) { const p = z.pose.P[BI.neck]; this.fx.blood(p, _v.set(0, 1, 0), _v2.set((rand() - 0.5) * 0.6, 1, (rand() - 0.5) * 0.6).normalize(), 0.9); } });
    this.audio?.play?.('flesh.head', { pos: hp, vol: 1 });
  }
  _toCrawler(z) {
    if (z.crawler) return; z.crawler = true; z.crawlSpeed = 0.35 + rand() * 0.35; const A = z.anim; A.mode = 'crawl'; A.attack = null; A.phase = 0; A.handPlant = null; A._hs = null;
    this.voice(z, 'pain');
  }
  _kill(z, info, point, dir, J) {
    if (z.dead) return; z.dead = true; z.state = 'dead'; z.deadT = 0; z.hp = 0;
    const j = this.alive.indexOf(z); if (j >= 0) this.alive.splice(j, 1);
    // ragdoll from the current pose, carrying the body's velocity + the hit impulse at the hit point
    const A = z.anim; _v.set(A.vel.x, 0, A.vel.z); z.rag.fromPose(z.pose, _v);
    if (z.lost.head) { z.rag.active[3] = 0; z.rag.refreshMask(); }
    for (const l of LIMBS) if (z.lost[l]) this._ragDropLimb(z, l);
    if (point && dir) { _v2.copy(dir).multiplyScalar(J * 5.5); _v2.y += J * 0.3; z.rag.impulse(point, _v2, 0.45); z.rag.collapse = 0.35; } // shot deaths: moderate shove + knee collapse
    if (info.explosion && info.blastCentre) z.rag.blast(info.blastCentre, info.blastV || 8, info.blastR || 5);
    this.voice(z, 'death');
    if (!this._inDamage) this.onNetKill?.(z);
    this.onKill?.(z, info);
  }
  _ragDropLimb(z, limb) { const side = limb.endsWith('L') ? 'L' : 'R'; const lvl = z.lost[limb]; const names = limb.startsWith('arm') ? (lvl === 2 ? ['el', 'wr', 'hd'] : ['wr', 'hd']) : (lvl === 2 ? ['kn', 'an', 'to'] : ['an', 'to']); for (const n of names) z.rag.active[PI[n + side]] = 0; z.rag.refreshMask(); }
  _updateDead(z, dt) {
    z.deadT += dt; z.rag.step(dt, this.world); z.rag.toPose(z.pose);
    if (z.gibOf) z.rag.firstActive(z.pose.rootPos);
    if (z.deadT > 8) { z.rag.sink += dt * 0.12; z.rag.asleep = false; }
    if (z.deadT > 11) this._release(z);
  }
  // ---------------------------------------------------------------- gibs (severed limbs as small ragdolls)
  _spawnGib(z, limb, lvl, dir) {
    const g = this.pool.find((p) => !p.inUse); if (!g) return; // no free body: skip the gib
    g.inUse = true; g.state = 'gib'; g.dead = true; g.lost.head = 0; g.crawler = false; g.script = null; g.deadT = 0; g.def = z.def; g.geo = z.geo; g.body.setGeometry(z.geo); g.body.mesh.visible = true; g.body.u.uSeed.value = z.body.u.uSeed.value;
    g.body.u.uSkinTint.value.copy(z.body.u.uSkinTint.value); g.body.u.uLayers.value.copy(z.body.u.uLayers.value); g.body.u.uLayers2.value.copy(z.body.u.uLayers2.value); for (let i = 0; i < 8; i++) g.body.u.uWounds.value[i].copy(z.body.u.uWounds.value[i]);
    const side = limb.endsWith('L') ? 'L' : 'R'; const isArm = limb.startsWith('arm');
    let show = 0; if (isArm) { show |= 1 << REG['larm' + side]; if (lvl === 2) show |= 1 << REG['uarm' + side]; show |= 1 << (lvl === 2 ? REG['gibUarm' + side] : REG['gibLarm' + side]); } else { show |= 1 << REG['lleg' + side]; if (lvl === 2) show |= 1 << REG['thigh' + side]; show |= 1 << (lvl === 2 ? REG['gibThigh' + side] : REG['gibLleg' + side]); }
    g.hideMask = ~show; g.body.u.uHide.value = ~show;
    g.pose.setProportions(z.pose.scale, z.pose.lenScale, z.pose.girth); g.pose.copyFrom(z.pose);
    const keep = new Set(isArm ? (lvl === 2 ? ['sh', 'el', 'wr', 'hd'] : ['el', 'wr', 'hd']).map((n) => n + side) : (lvl === 2 ? ['hip', 'kn', 'an', 'to'] : ['kn', 'an', 'to']).map((n) => n + side));
    _v.set(z.anim.vel.x, 0, z.anim.vel.z); g.rag.fromPose(z.pose, _v, 1 / 60, keep); _v2.copy(dir).multiplyScalar(6); _v2.y += 3; g.rag.impulse(z.pose.P[isArm ? BI['forearm.' + side] : BI['calf.' + side]], _v2, 2); g.rag.jitter(1.2); g.gibOf = limb;
    g.gibOf = limb; this.bodies.push(g); if (!this._gibs) this._gibs = []; this._gibs.push(g); g.sig = null;
  }
  _updateGibs(dt) { if (!this._gibs) return; for (let i = this._gibs.length - 1; i >= 0; i--) { const g = this._gibs[i]; if (!g.inUse) { this._gibs.splice(i, 1); continue; } } }

  // ---------------------------------------------------------------- explosions
  explode(pos, radius = 5, damage = 200, o = {}) {
    for (const z of this.alive.slice()) {
      const c = z.pose.P[BI.spine2]; const d = c.distanceTo(pos); if (d > radius) continue;
      const k = 1 - d / radius; const dmg = damage * (0.35 + 0.65 * k);
      _v.subVectors(c, pos); _v.y = Math.max(_v.y, 0.3); _v.normalize();
      // close blasts rip limbs off
      if (k > 0.45) for (const l of LIMBS) if (!z.lost[l] && rand() < k * 0.5) this._dismember(z, l, BI[l.startsWith('arm') ? 'forearm.' + l[3] : 'calf.' + l[3]], _v, rand() < k ? 2 : 1);
      z.hp -= dmg; this._addWound(z, BI.chest, _v2.copy(c).addScaledVector(_v, -0.12), 0.07);
      if (z.hp <= 0) { z._blastT = this.time; this._kill(z, { killed: true, explosion: true, blastCentre: pos, blastV: 3 + 5 * k, blastR: radius * 1.2 }, c, _v, 3 * k); }
      else { z.anim.applyHit(BI.chest, c, _v, 8 * k); if ((z.lost.legL || z.lost.legR) && !z.crawler) this._toCrawler(z); this.voice(z, 'pain'); this.onHit?.(z, { explosion: true, amount: dmg }); }
    }
    // corpses fly too
    for (const z of this.bodies) if (z.dead && z.rag && z.deadT < 10 && z._blastT !== this.time) { const d = z.rag.centre(_v).distanceTo(pos); if (d < radius * 1.2) z.rag.blast(pos, 5, radius * 1.2); }
  }

  // ---------------------------------------------------------------- helpers used by scripts / signature
  surfaceAt(p) { const g = this.world.groundAt(p.x, p.z, p.y + 0.5, _g, 0.5); return g.surface; }
  stopOrigin() { return this.world.active ? this.world.active.origin : _v.set(0, 0, 0); }
  /** adaptive quality (perf.js ladder): 0 full · 1 medium · 2 low · 3 minimal — trades the number of full-detail bodies, the near-shader distance, LOD ranges and the triangle budget for GPU time */
  setQualityRung(l = 0) {
    const b = this._q0 || (this._q0 = { maxLod0: this.maxLod0, farShaderDist: this.farShaderDist, lodDist: this.lodDist.slice(), triBudget: this.triBudget });
    const T = [[1, 1, 1, 1], [0.67, 0.75, 0.8, 0.75], [0.34, 0.5, 0.6, 0.5], [0.34, 0.33, 0.45, 0.35]][Math.max(0, Math.min(3, l | 0))]; // [maxLod0, farShaderDist, lodDist, triBudget] multipliers
    this.maxLod0 = Math.max(1, Math.round(b.maxLod0 * T[0])); this.farShaderDist = b.farShaderDist * T[1]; this.lodDist = [b.lodDist[0] * T[2], b.lodDist[1] * T[2]]; this.triBudget = b.triBudget * T[3]; this.qualityRung = l | 0;
  }
  waterY(p) { if (this.waterOverride) return this.waterOverride(p); const st = this.world.active; const wh = st?.data?.waterHeight; if (wh && p) { const y = wh(p.x - st.origin.x, p.z - st.origin.z); if (y !== undefined && y !== null && isFinite(y)) return y + st.origin.y; } const c = st?.B?.colliders; if (c && c.waterY !== null && c.waterY !== undefined) return c.waterY + st.origin.y; const d = st?.data?.waterY; return d !== undefined ? d + (st.origin?.y || 0) : null; }
  groundBurst(p, surface, k = 1) {
    const col = surface === 'snow' ? [0.9, 0.93, 0.97, 0.6] : surface === 'water' ? [0.8, 0.88, 0.95, 0.5] : surface === 'gravel' || surface === 'rock' || surface === 'concrete' ? [0.4, 0.38, 0.35, 0.55] : [0.28, 0.22, 0.16, 0.6];
    if (surface === 'water') { this.fx.splash(p, _v.set(0, 1, 0), k); return; }
    this.fx.puff(p, _v.set(0, 1, 0), (4 * k) | 0 || 1, { speed: 1.2 * k, size: [0.08, 0.5 * k + 0.2], life: 1.2, color: col, cell: 9, rise: 0.4, drag: 2.2 });
    this.fx.chunks(p, _v.set(0, 1, 0), (6 * k) | 0 || 1, { speed: 2.5 * k, size: 0.025, color: [col[0] * 0.7, col[1] * 0.7, col[2] * 0.7, 1], life: 0.8 });
  }
  waterSplash(p, k = 1) { this.fx.splash(p, _v.set(0, 1, 0), k); this.audio?.play?.('water.splash', { pos: p, vol: 0.4 * k }); }
  _skyVis(z) { const w = this.world; const p = z.pose.P[BI.head]; let open = 0; const dirs = SKY_DIRS; const o = this._rayOut || (this._rayOut = {}); for (const d of dirs) if (!w.raycast(p.x, p.y + 0.2, p.z, d[0], d[1], d[2], 40, o)) open++; return 0.15 + 0.85 * open / dirs.length; }
  _onStep(z, f, a) {
    if (z.distCam > 18 || !this.audio?.play) return; z.stepT = this.time;
    const surf = z.surface || 'concrete'; const heavy = z.speedClass === 'sprint' ? 0.5 : z.speedClass === 'run' ? 0.38 : 0.26;
    // audio engine names: step.<surface>.<walk|sprint>.<L|R> (cached per surface — no string building per step) + zombie foley layers
    let N = this._stepNames.get(surf); if (!N) { N = {}; for (const m of ['walk', 'sprint']) for (const s of ['L', 'R']) N[m + s] = `step.${surf}.${m}.${s}`; this._stepNames.set(surf, N); }
    const pos = f.heel || z.pos; this.audio.play(N[(z.speedClass === 'walk' ? 'walk' : 'sprint') + (f.s || 'L')], { pos, vol: heavy * (f.hand ? 0.6 : 1), pitch: 0.85 + rand() * 0.2 });
    if (this.silent) return;
    if (z.speedClass === 'walk' && !f.hand && rand() < 0.5) this.audio.play(z.anim.idio.drag >= 0 && rand() < 0.6 ? 'zombie.drag' : 'zombie.step', { pos, vol: 0.5 });
    if (rand() < 0.12) this.audio.play('zombie.cloth', { pos: z.pos, vol: 0.4 });
    if ((z.def.wet || z.wetT > 0) && !f.hand && rand() < 0.5 && z.distCam < 12) this.fx.decals.add(_v.copy(f.heel).setY(f.heel.y + 0.004), _v2.set(0, 1, 0), 12, 0.22 + rand() * 0.1, 0.05, null, 1);
  }
  /** voice hooks: audio.zombieVoice(profile) → {idle, attack, pain, death, spawn, sprint} (arrays of AudioBuffers) */
  voice(z, kind, vol = 1) {
    const a = this.audio; if (!a || !a.ready || !a.play || this.silent) return;
    let set = this.voiceSets.get(z.def.id);
    if (set === undefined) { set = null; try { set = a.zombieVoice ? a.zombieVoice(z.def.voice) : null; } catch (e) { set = null; } this.voiceSets.set(z.def.id, set); }
    // budget: at most 5 concurrent voices, nearest first (rough)
    const now = this.time; this._voiceEnd = this._voiceEnd.filter((t) => t > now); if (this._voiceEnd.length >= 5 && kind === 'idle') return;
    if (z.distCam > 40 && kind === 'idle') return;
    let buf = null; const arr = set && set[kind]; if (arr && arr.length) buf = arr[(rand() * arr.length) | 0];
    const h = a.play(buf || ('zombie.' + kind), { pos: z.pose.P[BI.head], bus: 'voice', vol: vol * (kind === 'death' ? 1 : 0.8), pitch: 0.92 + rand() * 0.16 });
    const dur = buf && buf.duration ? buf.duration : 1.2; this._voiceEnd.push(now + dur);
    z.anim.voiceJaw = kind === 'attack' || kind === 'sprint' ? 0.38 : kind === 'death' ? 0.45 : 0.22; void h;
  }
}
const SKY_DIRS = [[0, 1, 0], [0.5, 0.85, 0], [-0.5, 0.85, 0], [0, 0.85, 0.5], [0, 0.85, -0.5]];
const RIG_REGION = BONE_REGION; // bone → dismemberment region (for hit filtering)
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) { const lx = ox - cx, ly = oy - cy, lz = oz - cz; const b = lx * dx + ly * dy + lz * dz, c = lx * lx + ly * ly + lz * lz - r * r; const d = b * b - c; if (d < 0) return -1; const t = -b - Math.sqrt(d); return t > 0 ? t : -1; }
function rayCapsule(ox, oy, oz, dx, dy, dz, A, B, r) {
  const bax = B.x - A.x, bay = B.y - A.y, baz = B.z - A.z, oax = ox - A.x, oay = oy - A.y, oaz = oz - A.z;
  const baba = bax * bax + bay * bay + baz * baz, bard = bax * dx + bay * dy + baz * dz, baoa = bax * oax + bay * oay + baz * oaz, rdoa = dx * oax + dy * oay + dz * oaz, oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard; let b = baba * rdoa - baoa * bard; let c = baba * oaoa - baoa * baoa - r * r * baba; let h = b * b - a * c;
  if (h >= 0 && a > 1e-9) { const t = (-b - Math.sqrt(h)) / a; const y = baoa + t * bard; if (y > 0 && y < baba) return t > 0 ? t : -1; const ocx = y <= 0 ? oax : ox - B.x, ocy = y <= 0 ? oay : oy - B.y, ocz = y <= 0 ? oaz : oz - B.z; b = dx * ocx + dy * ocy + dz * ocz; c = ocx * ocx + ocy * ocy + ocz * ocz - r * r; h = b * b - c; if (h > 0) { const t2 = -b - Math.sqrt(h); return t2 > 0 ? t2 : -1; } }
  return -1;
}
