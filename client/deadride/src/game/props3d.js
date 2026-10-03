// Gameplay props: perk machines, mystery box, wall-buy chalk plates, power-ups. Models are built in code with baked PBR materials + canvas art.
import * as THREE from 'three';
import { std, glowMaterial } from '../core/mats.js';
import { boxRaw, rawToGeometry } from '../core/build.js';
import { canvasTexture } from '../core/canvas2d.js';
import { makeBeam, HaloBatch } from '../core/glow.js';
import { rand, clamp, lerp, TAU, easeOutBack } from '../core/util.js';

const chamfer = (w, h, d, b = 0.012) => rawToGeometry(boxRaw(w, h, d, b));

// ------------------------------------------------------------------ PERK MACHINES
export const PERKS = {
  juggernog: { name: 'Juggernog', price: 2500, desc: 'Take more damage', color: 0xb31b1b, trim: 0xe8d9b0, glow: 0xff3a2a, bottle: 0xc02020, jingle: 'perk.juggernog', hp: true },
  speedcola: { name: 'Speed Cola', price: 3000, desc: 'Reload faster', color: 0x1f8a3a, trim: 0xe8f0d0, glow: 0x52ff7a, bottle: 0x3acc55, jingle: 'perk.speedcola' },
  doubletap: { name: 'Double Tap Root Beer', price: 2000, desc: 'Faster, harder shots', color: 0xc78a10, trim: 0x2a1c08, glow: 0xffc247, bottle: 0x8a4a12, jingle: 'perk.doubletap' },
  quickrevive: { name: 'Quick Revive', price: 1500, desc: 'Self revive once', color: 0x2a78c8, trim: 0xe8f4ff, glow: 0x6cc4ff, bottle: 0x4aa8e8, jingle: 'perk.quickrevive' },
  staminup: { name: "Stamin-Up", price: 2000, desc: 'Run faster', color: 0xd8b020, trim: 0x33220a, glow: 0xffe14a, bottle: 0xe0a020, jingle: 'perk.staminup' },
};
function perkLogo(kind, def) {
  const W = 1024, H = 320; const hex = (c) => '#' + c.toString(16).padStart(6, '0');
  return canvasTexture(W, H, (g) => {
    g.fillStyle = hex(def.color); g.fillRect(0, 0, W, H);
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.35)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.strokeStyle = hex(def.trim); g.lineWidth = 10; g.strokeRect(14, 14, W - 28, H - 28); g.lineWidth = 3; g.strokeRect(30, 30, W - 60, H - 60);
    // icon on the left
    g.save(); g.translate(150, H / 2); g.fillStyle = hex(def.trim); g.strokeStyle = hex(def.trim); g.lineWidth = 8; g.lineJoin = 'round';
    if (kind === 'juggernog') { g.beginPath(); g.moveTo(-70, 60); g.lineTo(-70, -10); g.quadraticCurveTo(-70, -80, 0, -84); g.quadraticCurveTo(70, -80, 70, -10); g.lineTo(70, 60); g.lineTo(30, 60); g.lineTo(30, 10); g.lineTo(-30, 10); g.lineTo(-30, 60); g.closePath(); g.fill(); g.fillStyle = hex(def.color); g.fillRect(-40, -30, 80, 16); g.fillRect(-6, -60, 12, 60); }
    else if (kind === 'speedcola') { g.beginPath(); g.moveTo(10, -90); g.lineTo(-50, 8); g.lineTo(-6, 8); g.lineTo(-24, 90); g.lineTo(52, -16); g.lineTo(6, -16); g.lineTo(38, -90); g.closePath(); g.fill(); }
    else if (kind === 'doubletap') { for (const x of [-34, 34]) { g.beginPath(); g.moveTo(x - 20, 70); g.lineTo(x - 20, -30); g.quadraticCurveTo(x, -90, x + 20, -30); g.lineTo(x + 20, 70); g.closePath(); g.fill(); g.fillStyle = hex(def.color); g.fillRect(x - 20, -6, 40, 10); g.fillStyle = hex(def.trim); } }
    else if (kind === 'quickrevive') { g.fillRect(-18, -78, 36, 156); g.fillRect(-78, -18, 156, 36); g.strokeRect(-90, -90, 180, 180); }
    else { g.beginPath(); g.arc(0, -66, 22, 0, TAU); g.fill(); g.lineWidth = 16; g.beginPath(); g.moveTo(0, -40); g.lineTo(-10, 20); g.lineTo(-52, 70); g.moveTo(-10, 20); g.lineTo(46, 40); g.lineTo(60, -10); g.moveTo(0, -30); g.lineTo(-44, -14); g.stroke(); }
    g.restore();
    g.fillStyle = hex(def.trim); g.textAlign = 'center'; g.textBaseline = 'middle'; const label = def.name.toUpperCase(); let fs = 118; g.font = `900 ${fs}px Impact, "Arial Black", sans-serif`; while (g.measureText(label).width > 640 && fs > 40) { fs -= 4; g.font = `900 ${fs}px Impact, "Arial Black", sans-serif`; }
    g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 10; g.fillText(label, 640, H / 2 + 6);
    g.shadowBlur = 0; g.font = '700 30px "Courier New", monospace'; g.fillText('ICE COLD • EST. 1956', 640, H - 46);
  });
}
export class PerkMachine {
  constructor(scene, gfx, kind, synth) {
    const def = this.def = PERKS[kind]; this.kind = kind; this.group = new THREE.Group(); this.group.name = 'perk:' + kind; this.on = true; this.flick = rand() * 10; this.gfx = gfx;
    const hex = (c) => '#' + c.toString(16).padStart(6, '0');
    // weathered painted sheet metal in the perk's colour (GPU-baked PBR), chrome, dark rubber/steel
    const paint = synth.material({ pattern: 'plates', size: 512, tile: 1.2, colors: [def.color, def.color, 0x0a0908], params: { cols: 1, rows: 3, seam: 0.004, rivets: 6, brushed: 0.15, panelVar: 0.15 }, bump: 1.5, metal: 0.35, rough: [0.32, 0.6], layers: { grime: 0.45, scratch: 0.55, edge: 0.45, streak: 0.4, rust: 0.12 }, rustColor: 0x4a2a16, seed: kind.length });
    const chrome = std({ color: 0xd6dadd, roughness: 0.14, metalness: 1, key: 'chrome' }); const dark = std({ color: 0x151210, roughness: 0.55, metalness: 0.4, key: 'perkDark' }); const rubber = std({ color: 0x0c0c0c, roughness: 0.9, key: 'perkRubber' });
    const add = (m, x, y, z) => { m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; this.group.add(m); return m; };
    add(new THREE.Mesh(chamfer(1.34, 0.14, 0.94, 0.02), dark), 0, 0.07, 0);
    add(new THREE.Mesh(chamfer(1.2, 1.62, 0.82, 0.03), paint), 0, 0.14 + 0.81, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.66, 10), chrome); add(post, sx * 0.61, 0.97, sz * 0.42); }
    // side stripes + louvres
    for (const sx of [-1, 1]) { for (let i = 0; i < 9; i++) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.035, 0.34), dark); add(l, sx * 0.605, 0.62 + i * 0.075, -0.1); } const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.008, 1.2, 0.06), std({ color: 0x000000, emissive: def.glow, emissiveIntensity: 2.2, key: 'stripeG' + kind })); add(stripe, sx * 0.607, 1.0, 0.28); }
    // header: sign box with rounded canopy cap
    add(new THREE.Mesh(chamfer(1.3, 0.5, 0.9, 0.035), paint), 0, 2.05, 0);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 1.3, 24, 1, false, 0, Math.PI), paint); cap.rotation.z = Math.PI / 2; cap.scale.set(0.42, 1, 1.1); add(cap, 0, 2.3, 0);
    const logoTex = perkLogo(kind, def); this.logoMat = std({ map: logoTex, emissiveMap: logoTex, emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 0.5, key: 'logo' + kind });
    add(new THREE.Mesh(new THREE.PlaneGeometry(1.16, 0.36), this.logoMat), 0, 2.05, 0.452);
    for (const [w, h, x, y] of [[1.24, 0.03, 0, 2.245], [1.24, 0.03, 0, 1.855], [0.03, 0.42, -0.605, 2.05], [0.03, 0.42, 0.605, 2.05]]) add(new THREE.Mesh(chamfer(w, h, 0.03, 0.006), chrome), x, y, 0.456);
    // bulb ring around the sign (chase animation)
    const bulbGeo = new THREE.SphereGeometry(0.018, 8, 6); const bulbs = new THREE.InstancedMesh(bulbGeo, std({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 3.4, key: 'bulb' }), 40); this.bulbs = bulbs; const col = new THREE.Color(); this.bulbN = 40; let bi = 0; const m4 = new THREE.Matrix4();
    for (let i = 0; i < 12; i++) { m4.makeTranslation(-0.58 + i * 0.105, 2.29 - 0.0, 0.46); bulbs.setMatrixAt(bi++, m4); m4.makeTranslation(-0.58 + i * 0.105, 1.81, 0.46); bulbs.setMatrixAt(bi++, m4); }
    for (let i = 0; i < 8; i++) { m4.makeTranslation(-0.6, 1.86 + i * 0.058, 0.46); bulbs.setMatrixAt(bi++, m4); m4.makeTranslation(0.6, 1.86 + i * 0.058, 0.46); bulbs.setMatrixAt(bi++, m4); }
    bulbs.count = bi; this.bulbN = bi; this.bulbCol = new THREE.Color(def.glow); for (let i = 0; i < bi; i++) bulbs.setColorAt(i, this.bulbCol); this.group.add(bulbs);
    // glass door + bottles
    add(new THREE.Mesh(chamfer(0.98, 1.24, 0.05, 0.012), chrome), 0, 1.28, 0.405);
    add(new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.12), std({ color: 0x0a0d10, roughness: 0.4, key: 'winBack' })), 0, 1.28, 0.3);
    const glowMat = std({ color: 0x000000, emissive: def.glow, emissiveIntensity: 2.3, key: 'perkGlow' + kind }); this.glowMat = glowMat;
    const bottleGeo = new THREE.LatheGeometry([[0.0, 0], [0.034, 0], [0.036, 0.02], [0.036, 0.1], [0.026, 0.135], [0.014, 0.17], [0.014, 0.2], [0.0, 0.2]].map(([r, y]) => new THREE.Vector2(r, y)), 12);
    const bottleMat = std({ color: def.bottle, roughness: 0.12, metalness: 0.0, transparent: true, opacity: 0.9, emissive: def.glow, emissiveIntensity: 0.55, key: 'bottle' + kind });
    const bottles = new THREE.InstancedMesh(bottleGeo, bottleMat, 30); bi = 0; for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) { m4.makeTranslation(-0.35 + c * 0.14, 0.78 + r * 0.215, 0.33); bottles.setMatrixAt(bi++, m4); } this.group.add(bottles);
    for (let r = 0; r < 5; r++) add(new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.014, 0.16), chrome), 0, 0.775 + r * 0.215, 0.35), add(new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.01, 0.02), glowMat), 0, 0.77 + r * 0.215 + 0.2, 0.41);
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 1.14), std({ color: 0x8fb4c8, roughness: 0.03, metalness: 0.0, transparent: true, opacity: 0.1, key: 'winGlass2' })); add(gl, 0, 1.28, 0.436);
    // coin panel + buttons + tray + flap
    add(new THREE.Mesh(chamfer(0.2, 0.34, 0.04, 0.008), chrome), 0.44, 0.7, 0.42); add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.014, 0.02), dark), 0.44, 0.78, 0.445); for (let i = 0; i < 3; i++) add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 10), std({ color: 0x000000, emissive: def.glow, emissiveIntensity: 2, key: 'btn' + kind })), 0.44, 0.66 - i * 0.05, 0.445).rotation.x = Math.PI / 2;
    add(new THREE.Mesh(chamfer(0.5, 0.24, 0.06, 0.01), dark), -0.1, 0.44, 0.42); const flap = new THREE.Mesh(chamfer(0.44, 0.18, 0.012, 0.004), rubber); add(flap, -0.1, 0.44, 0.452);
    // steam / cold mist at the base handled in update; lights
    this.halos = new HaloBatch(6); this.halos.add([0, 2.05, 0.7], def.glow, 0.85, 0.9, 0); this.halos.add([0, 0.9, 0.65], def.glow, 0.7, 0.5, 0); this.group.add(this.halos.mesh);
    this.src = gfx.addLight({ kind: 'point', pos: new THREE.Vector3(), color: def.glow, intensity: 8, distance: 8, decay: 2, flicker: 0.1, priority: 1.5, enabled: false });
    this.bottle = new THREE.Mesh(bottleGeo, bottleMat); this.bottle.visible = false; this.bottle.scale.setScalar(1.25); this.group.add(this.bottle); this.dispT = -1; this.chase = 0; this.colTmp = new THREE.Color(); this.colOff = new THREE.Color(def.glow).multiplyScalar(0.12);
    scene.add(this.group);
  }
  place(pos, yaw) { this.group.position.set(pos[0], pos[1], pos[2]); this.group.rotation.y = yaw; this.group.updateMatrixWorld(true); const w = new THREE.Vector3(0, 1.3, 1.3).applyMatrix4(this.group.matrixWorld); this.src.pos.copy(w); this.worldPos = new THREE.Vector3(pos[0], pos[1] + 1, pos[2]); return this; }
  setVisible(v) { this.group.visible = v; this.src.enabled = v && this.on; }
  dispense() { this.dispT = 0; this.bottle.visible = true; }
  update(dt, t) {
    if (!this.group.visible) return; const fl = 0.86 + 0.14 * Math.sin(t * 9 + this.flick) * Math.sin(t * 3.7 + this.flick); const flick = Math.sin(t * 41 + this.flick) > 0.985 ? 0.35 : 1;
    this.logoMat.emissiveIntensity = 1.2 * fl * flick; this.glowMat.emissiveIntensity = 2.3 * fl * flick; this.src.on = fl * flick;
    this.chase += dt * 14; const n = this.bulbN; for (let i = 0; i < n; i++) { const on = ((i - Math.floor(this.chase)) % 4 + 4) % 4 < 2; this.bulbs.setColorAt(i, on ? this.bulbCol : this.colOff); } this.bulbs.instanceColor.needsUpdate = true;
    if (this.dispT >= 0) { this.dispT += dt; const k = this.dispT / 1.4; this.bottle.position.set(-0.1, 0.36 + 0.02 * clamp(k * 2, 0, 1), 0.44 + 0.34 * clamp(k * 2 - 0.3, 0, 1)); this.bottle.rotation.x = -k * 0.5; if (k >= 1) { this.dispT = -1; this.bottle.visible = false; } }
  }
}

// ------------------------------------------------------------------ MYSTERY BOX
export class MysteryBox {
  constructor(scene, gfx, synth, weaponsApi) {
    this.gfx = gfx; this.api = weaponsApi; this.group = new THREE.Group(); this.group.name = 'mysteryBox';
    const wood = synth.material({ pattern: 'planks', size: 512, tile: 1.2, colors: [0x5e3c20, 0x2c190c, 0x0a0603], params: { rows: 5, gap: 0.006, grain: 8, knots: 0.5, cols: 1, weather: 0.5, nails: 1 }, bump: 5, rough: [0.55, 0.88], layers: { grime: 0.5, edge: 0.3 } });
    const iron = synth.material({ pattern: 'plates', size: 256, tile: 1, colors: [0x2b2a2a, 0x222222, 0x0a0a0a], params: { cols: 1, rows: 1, seam: 0.0, rivets: 0, brushed: 0.6 }, bump: 1, metal: 1, rough: [0.35, 0.65], layers: { rust: 0.28, scratch: 0.5, edge: 0.4 } });
    const glowTex = canvasTexture(256, 256, (g) => { g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256); g.strokeStyle = '#3fb0ff'; g.lineWidth = 8; g.shadowColor = '#3fb0ff'; g.shadowBlur = 26; g.strokeRect(24, 24, 208, 208); g.fillStyle = '#9fe8ff'; g.font = '900 190px Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', 128, 138); });
    const glowMat = std({ map: glowTex, emissiveMap: glowTex, emissive: 0xffffff, emissiveIntensity: 2.6, color: 0x000000, roughness: 1, key: 'boxQ' }); this.glowMat = glowMat;
    const W = 1.25, H = 0.6, D = 0.64, bodyH = H * 0.7;
    const base = new THREE.Mesh(chamfer(W, bodyH, D, 0.025), wood); base.position.y = bodyH / 2 + 0.02; base.castShadow = base.receiveShadow = true; this.group.add(base);
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.12, D - 0.12), std({ color: 0x000000, emissive: 0x7fe0ff, emissiveIntensity: 0, key: 'boxInner' })); inner.rotation.x = -Math.PI / 2; inner.position.y = bodyH + 0.021; this.group.add(inner); this.inner = inner;
    // hinged curved lid: half cylinder (arch up) whose local origin sits on the back edge
    this.lid = new THREE.Group(); this.lid.position.set(0, bodyH + 0.02, -D / 2); this.group.add(this.lid);
    const lg = new THREE.CylinderGeometry(D / 2, D / 2, W, 28, 1, false, 0, Math.PI); lg.rotateZ(Math.PI / 2); lg.scale(1, 0.62, 1); lg.translate(0, 0, D / 2);
    const lidBody = new THREE.Mesh(lg, wood); lidBody.castShadow = true; this.lid.add(lidBody);
    for (const x of [-W * 0.34, 0, W * 0.34]) { const band = new THREE.Mesh(new THREE.TorusGeometry(D / 2, 0.02, 6, 24, Math.PI), iron); band.rotation.y = Math.PI / 2; band.scale.set(1, 0.62, 1); band.position.set(x, 0, D / 2); this.lid.add(band); const bb = new THREE.Mesh(chamfer(0.06, bodyH + 0.01, D + 0.035, 0.008), iron); bb.position.set(x, bodyH / 2 + 0.02, 0); this.group.add(bb); }
    const lock = new THREE.Mesh(chamfer(0.16, 0.18, 0.05, 0.012), iron); lock.position.set(0, bodyH - 0.02, D / 2 + 0.035); this.group.add(lock);
    for (const s of [-1, 1]) for (const zz of [-1, 1]) { const corner = new THREE.Mesh(chamfer(0.09, 0.11, 0.09, 0.012), iron); corner.position.set(s * (W / 2 - 0.02), 0.07, zz * (D / 2 - 0.02)); this.group.add(corner); const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8), iron); hinge.rotation.z = Math.PI / 2; hinge.position.set(s * W * 0.34, bodyH + 0.03, -D / 2 - 0.01); }
    for (const [x, z, ry] of [[0, D / 2 + 0.008, 0], [0, -D / 2 - 0.008, Math.PI], [W / 2 + 0.008, 0, Math.PI / 2], [-W / 2 - 0.008, 0, -Math.PI / 2]]) { const q = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), glowMat); q.position.set(x, bodyH * 0.5 + 0.02, z); q.rotation.y = ry; this.group.add(q); }
    this.beam = makeBeam({ length: 5, r0: 0.3, r1: 0.7, color: 0x9fe4ff, intensity: 0.22, dust: 0.5 }); this.beam.rotation.x = -Math.PI / 2; this.beam.position.set(0, bodyH + 0.03, 0); this.beam.visible = false; this.group.add(this.beam);
    this.display = new THREE.Group(); this.display.position.set(0, 1.25, 0); this.group.add(this.display); this.models = {};
    this.src = gfx.addLight({ kind: 'point', pos: new THREE.Vector3(), color: 0x9fe4ff, intensity: 0, distance: 10, decay: 2, priority: 2, enabled: false });
    this.state = 'closed'; this.t = 0; this.lidK = 0; this.choice = null; this.cycleT = 0; this.pool = []; this.teddy = this._buildTeddy(); this.teddy.visible = false; this.display.add(this.teddy); this.cur = null;
    scene.add(this.group);
  }
  _buildTeddy() { const g = new THREE.Group(); const fur = std({ color: 0x7a4a24, roughness: 1, key: 'teddy' }); const mk = (r, x, y, z, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), fur); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; g.add(m); return m; }; mk(0.13, 0, -0.06, 0); mk(0.1, 0, 0.11, 0); mk(0.035, -0.07, 0.19, 0); mk(0.035, 0.07, 0.19, 0); mk(0.05, 0, 0.09, 0.08, 1, 0.7, 0.8); mk(0.045, -0.13, -0.02, 0.02, 1, 1.4, 1); mk(0.045, 0.13, -0.02, 0.02, 1, 1.4, 1); mk(0.05, -0.07, -0.19, 0.03, 1, 1.4, 1); mk(0.05, 0.07, -0.19, 0.03, 1, 1.4, 1); const eye = std({ color: 0x050505, roughness: 0.2, key: 'teddyEye' }); for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), eye); e.position.set(s * 0.035, 0.13, 0.085); g.add(e); } g.scale.setScalar(1.1); return g; }
  place(pos, yaw) { this.group.position.set(pos[0], pos[1], pos[2]); this.group.rotation.y = yaw; this.group.updateMatrixWorld(true); this.worldPos = new THREE.Vector3(pos[0], pos[1] + 0.4, pos[2]); this.src.pos.set(pos[0], pos[1] + 1.4, pos[2]); return this; }
  setVisible(v) { this.group.visible = v; this.src.enabled = v && this.state !== 'closed'; }
  /** weaponIds: cycling pool; result: final weapon id or 'teddy'. */
  open(weaponIds, result) {
    this.state = 'opening'; this.t = 0; this.pool = weaponIds; this.result = result; this.cycleT = 0; this.cycleI = 0; this.beam.visible = true; this.src.enabled = true; this.cycleInterval = 0.09;
  }
  _show(id) { if (this.cur) this.cur.visible = false; if (id === 'teddy') { this.teddy.visible = true; this.cur = this.teddy; return; } this.teddy.visible = false; let m = this.models[id]; if (!m) { m = this.api?.buildWorldModel?.(id) || new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.08), std({ color: 0x888888 })); m.scale.multiplyScalar(1.0); this.display.add(m); this.models[id] = m; } m.visible = true; this.cur = m; }
  take() { const r = this.result; this.close(); return r; }
  close() { this.state = 'closing'; this.t = 0; }
  update(dt, t) {
    if (!this.group.visible) return;
    const st = this.state;
    if (st === 'opening') { this.t += dt; this.lidK = Math.min(1, this.t / 0.5); if (this.t > 0.35) { this.cycleT += dt; if (this.cycleT >= this.cycleInterval) { this.cycleT = 0; this.cycleI = (this.cycleI + 1) % this.pool.length; this._show(this.pool[this.cycleI]); this.cycleInterval = 0.09 + Math.max(0, this.t - 3.2) * 0.2; } } if (this.t > 5.3) { this.state = 'ready'; this.t = 0; this._show(this.result); this.onReady?.(this.result); } }
    else if (st === 'ready') { this.t += dt; if (this.t > 12) { this.onTimeout?.(); this.close(); } }
    else if (st === 'closing') { this.t += dt; this.lidK = Math.max(0, 1 - this.t / 0.6); if (this.cur) this.cur.visible = false; this.beam.visible = false; if (this.t > 0.6) { this.state = 'closed'; this.src.enabled = false; this.src.intensity = 0; } }
    else if (st === 'leaving') { this.t += dt; this.group.position.y += dt * (this.t * 3); this.src.intensity = 30; if (this.t > 2.2) { this.state = 'gone'; this.group.visible = false; this.onGone?.(); } }
    this.lid.rotation.x = -this.lidK * 1.9; this.inner.material.emissiveIntensity = this.lidK * 4;
    if (this.cur && (st === 'opening' || st === 'ready')) { this.display.position.y = 1.15 + 0.25 * clamp(this.t * 2 + (st === 'ready' ? 5 : 0), 0, 1) + 0.03 * Math.sin(t * 2.2); this.cur.rotation.y = t * 1.6; }
    this.glowMat.emissiveIntensity = 2.4 * (0.8 + 0.2 * Math.sin(t * 5));
    if (st !== 'closed' && st !== 'gone') this.src.intensity = (this.lidK * 12 + (st === 'leaving' ? 20 : 0)) * (0.85 + 0.15 * Math.sin(t * 13));
  }
  vanish() { this.state = 'leaving'; this.t = 0; this._show('teddy'); this.beam.visible = true; }
}

// ------------------------------------------------------------------ WALL BUY (chalk outline plate)
export class WallBuy {
  constructor(scene, gfx, def, weaponsApi, gunInfo) {
    this.def = def; this.gun = def.gun; this.info = gunInfo; this.group = new THREE.Group(); this.group.name = 'wallbuy:' + def.gun;
    const price = gunInfo?.wallPrice ?? 500; this.price = price;
    const W = 1.5, H = 0.62; const tex = canvasTexture(768, 320, (g, w, h) => {
      g.fillStyle = '#17130f'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${40 + rand() * 40},${34 + rand() * 30},${26 + rand() * 20},${rand() * 0.25})`; g.fillRect(rand() * w, rand() * h, rand() * 60 + 4, rand() * 3 + 1); }
      const oc = weaponsApi?.getOutline?.(def.gun, 640); if (oc) { g.globalAlpha = 0.92; g.drawImage(oc, (w - oc.width) / 2, 12, oc.width, oc.height * Math.min(1, 200 / oc.height)); g.globalAlpha = 1; }
      else { g.strokeStyle = 'rgba(240,240,235,0.9)'; g.lineWidth = 5; g.strokeRect(120, 50, 520, 90); }
      g.fillStyle = 'rgba(235,235,225,0.92)'; g.textAlign = 'center'; g.font = '700 46px "Courier New", monospace'; g.fillText(String(gunInfo?.name || def.gun).toUpperCase(), w / 2, h - 62); g.font = '700 34px "Courier New", monospace'; g.fillText('$ ' + price, w / 2, h - 18);
    });
    this.mat = std({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.0, roughness: 0.9, key: 'wb' + def.gun });
    const plate = new THREE.Mesh(chamfer(W, H, 0.05, 0.008), std({ color: 0x2a2620, roughness: 0.8, key: 'wbFrame' })); this.group.add(plate);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.06, H - 0.06), this.mat); face.position.z = 0.026; this.group.add(face);
    this.group.position.set(...def.pos); this.group.rotation.y = def.yaw || 0; this.worldPos = new THREE.Vector3(...def.pos); scene.add(this.group); this.near = 0;
  }
  setNear(k) { this.mat.emissiveIntensity = k * 0.5; }
  setVisible(v) { this.group.visible = v; }
}

// ------------------------------------------------------------------ POWER-UPS
export const POWERUPS = {
  maxammo: { name: 'MAX AMMO', color: 0x66d0ff, icon: 'A' }, instakill: { name: 'INSTA-KILL', color: 0xff3020, icon: '☠' }, doublepoints: { name: 'DOUBLE POINTS', color: 0xffd23a, icon: '2X' }, nuke: { name: 'KABOOM!', color: 0xffa030, icon: '✹' },
};
export class PowerUp {
  constructor(scene, gfx, kind, pos) {
    const def = this.def = POWERUPS[kind]; this.kind = kind; this.life = 30; this.group = new THREE.Group(); this.group.position.set(pos.x, pos.y + 0.9, pos.z); this.baseY = pos.y + 0.9;
    const tex = canvasTexture(256, 256, (g) => { const c = '#' + def.color.toString(16).padStart(6, '0'); const gr = g.createRadialGradient(128, 128, 20, 128, 128, 126); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.45, c); gr.addColorStop(1, 'rgba(0,0,0,0.9)'); g.fillStyle = gr; g.beginPath(); g.arc(128, 128, 124, 0, TAU); g.fill(); g.fillStyle = '#101010'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 120px Impact, "Arial Black", sans-serif'; g.fillText(def.icon, 128, 136); });
    this.mat = std({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 2.2, roughness: 0.3, metalness: 0.1, key: 'pu' + kind });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 16), this.mat); this.group.add(orb); this.orb = orb;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.015, 8, 40), std({ color: 0x000000, emissive: def.color, emissiveIntensity: 4, key: 'puRing' + kind })); ring.rotation.x = Math.PI / 2.4; this.group.add(ring); this.ring = ring;
    this.halo = new HaloBatch(2); this.halo.add([0, 0, 0], def.color, 0.9, 1.1, 0); this.group.add(this.halo.mesh);
    this.src = gfx.addLight({ kind: 'point', pos: new THREE.Vector3().copy(this.group.position), color: def.color, intensity: 10, distance: 8, decay: 2, priority: 2 });
    this.scene = scene; this.gfx = gfx; scene.add(this.group); this.dead = false; this.t = 0; this.pos = this.group.position;
  }
  update(dt, t) { this.t += dt; this.life -= dt; this.orb.rotation.y += dt * 2; this.ring.rotation.z += dt * 1.6; this.group.position.y = this.baseY + Math.sin(this.t * 2.4) * 0.09; this.src.pos.copy(this.group.position); const blink = this.life < 6 ? (Math.sin(this.t * 14) > 0 ? 1 : 0.15) : 1; this.mat.emissiveIntensity = 2.2 * blink; this.src.on = blink; this.group.visible = blink > 0.5 || this.life >= 6 || Math.sin(this.t * 14) > 0; if (this.life <= 0) this.remove(); }
  remove() { this.dead = true; this.scene.remove(this.group); this.gfx.removeLight(this.src); }
}
