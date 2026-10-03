// WEAPONS registry: real-world reference specs (RUBRIC.md §1) + BO2-style gameplay values + feel parameters.
// rpm = cyclic (auto) or cap (semi / pump); triggerRate = max semi-auto trigger presses per second (human + mechanism).
// Recoil momentum p = m_bullet*v + m_powder*v_gas (N*s); free recoil velocity = p / mass drives the view-model spring.
// camKick [pitch, yawJitter, roll] are velocity impulses (rad/s) into the player's view spring (k 180, c 20 => peak ~0.034*v);
// climb [pitch, yawDrift] is the persistent aim change per shot (rad) — what the player must pull down against.
export const WEAPONS = {
  m1911: {
    id: 'm1911', name: 'M1911', class: 'pistol', wallPrice: 0, ammoPrice: 250, box: false,
    mag: 7, chamber: 1, reserve: 80, rpm: 400, mode: 'semi', triggerRate: 6.5,
    damage: 28, headshotMul: 2.5, range: 80, falloff: [12, 45, 0.55], pellets: 1, spread: { hip: 0.024, ads: 0.0035, move: 0.018, air: 0.05 }, penetration: 0,
    reloadTime: 1.6, reloadEmpty: 1.85, drawTime: 0.42, firstDraw: 0.7, holsterTime: 0.28, adsTime: 0.16, sprintOut: 0.14,
    caliber: '.45 ACP', cal: 1.0, velocity: 253, mass: 1.1, lengthM: 0.216, barrelM: 0.127, momentum: 4.2,
    tracer: { color: [1.0, 0.7, 0.36], speed: 253, len: 2.2, width: 0.009, a: 0.55 },
    recoil: { camKick: [0.85, 0.16, 0.35], climb: [0.0045, 0.0012], vmBack: 1.25, vmPitch: 9.5, vmRoll: 3.0, vmSide: 1.2, k: 520, c: 26, recover: 9 },
    casing: '45acp', ejectDir: [0.55, 0.85, 0.12], ejectSpeed: [2.6, 3.6],
    flash: { style: 'pistol', size: 0.7, len: 0.9, light: 140, color: 0xffb060 },
    zoom: 1.12, vmFov: 54, adsVmFov: 48, sound: 'm1911',
  },
  mp5: {
    id: 'mp5', name: 'MP5', class: 'smg', wallPrice: 1000, ammoPrice: 500, box: true,
    mag: 30, chamber: 1, reserve: 120, rpm: 800, mode: 'auto',
    damage: 25, headshotMul: 2.0, range: 60, falloff: [10, 32, 0.6], pellets: 1, spread: { hip: 0.036, ads: 0.004, move: 0.02, air: 0.06, bloom: 0.0012, bloomMax: 0.018 }, penetration: 0,
    reloadTime: 2.3, reloadEmpty: 2.6, drawTime: 0.5, firstDraw: 1.0, holsterTime: 0.3, adsTime: 0.2, sprintOut: 0.18,
    caliber: '9x19mm', cal: 0.8, velocity: 400, mass: 2.54, lengthM: 0.66, barrelM: 0.225, momentum: 3.6,
    tracer: { color: [1.0, 0.74, 0.4], speed: 400, len: 3.4, width: 0.009, a: 0.6 },
    recoil: { camKick: [0.26, 0.08, 0.12], climb: [0.0021, 0.0009], vmBack: 0.38, vmPitch: 0.9, vmRoll: 1.2, vmSide: 0.5, k: 640, c: 40, recover: 11 },
    casing: '9mm', ejectDir: [0.85, 0.35, -0.25], ejectSpeed: [4.5, 6.0],
    flash: { style: 'smg', size: 0.55, len: 0.8, light: 110, color: 0xffb468 },
    zoom: 1.25, vmFov: 52, adsVmFov: 44, sound: 'mp5',
  },
  olympia: {
    id: 'olympia', name: 'Olympia', class: 'shotgun', wallPrice: 500, ammoPrice: 250, box: true,
    mag: 2, chamber: 0, reserve: 38, rpm: 480, mode: 'semi', triggerRate: 5,
    damage: 90, headshotMul: 1.5, range: 30, falloff: [5, 22, 0.15], pellets: 9, spread: { hip: 0.075, ads: 0.058, move: 0.01, air: 0.02 }, penetration: 0,
    reloadTime: 2.1, reloadEmpty: 2.8, drawTime: 0.55, firstDraw: 0.9, holsterTime: 0.32, adsTime: 0.24, sprintOut: 0.2,
    caliber: '12 gauge 00 buck', cal: 1.6, velocity: 400, mass: 3.1, lengthM: 0.94, barrelM: 0.508, momentum: 15,
    tracer: { color: [1.0, 0.72, 0.4], speed: 400, len: 2.6, width: 0.006, a: 0.4 },
    recoil: { camKick: [2.3, 0.3, 0.7], climb: [0.012, 0.002], vmBack: 1.9, vmPitch: 5.5, vmRoll: 5, vmSide: 2, k: 230, c: 21, recover: 5 },
    casing: '12ga', ejectDir: [0.2, 0.9, 0.6], ejectSpeed: [1.8, 2.6],
    flash: { style: 'shotgun', size: 1.2, len: 1.6, light: 320, color: 0xffa050 },
    zoom: 1.1, vmFov: 54, adsVmFov: 42, sound: 'olympia',
  },
  m14: {
    id: 'm14', name: 'M14', class: 'rifle', wallPrice: 500, ammoPrice: 250, box: true,
    mag: 20, chamber: 1, reserve: 100, rpm: 750, mode: 'semi', triggerRate: 7,
    damage: 65, headshotMul: 2.6, range: 250, falloff: [40, 140, 0.7], pellets: 1, spread: { hip: 0.03, ads: 0.0015, move: 0.02, air: 0.06 }, penetration: 1,
    reloadTime: 2.6, reloadEmpty: 3.0, drawTime: 0.6, firstDraw: 1.1, holsterTime: 0.35, adsTime: 0.28, sprintOut: 0.24,
    caliber: '7.62x51mm NATO', cal: 1.2, velocity: 850, mass: 4.5, lengthM: 1.12, barrelM: 0.559, momentum: 12,
    tracer: { color: [1.0, 0.64, 0.3], speed: 850, len: 12, width: 0.012, a: 0.75 },
    recoil: { camKick: [1.7, 0.2, 0.3], climb: [0.0105, 0.0022], vmBack: 1.05, vmPitch: 2.8, vmRoll: 1.1, vmSide: 0.9, k: 260, c: 24, recover: 6 }, // heavy: slower spring, the view takes most of it
    casing: '762', ejectDir: [0.75, 0.55, -0.45], ejectSpeed: [4.0, 5.5],
    flash: { style: 'rifle', size: 0.95, len: 1.3, light: 220, color: 0xffa858 },
    zoom: 1.35, vmFov: 50, adsVmFov: 40, sound: 'm14',
  },
  ak74u: {
    id: 'ak74u', name: 'AK-74u', class: 'smg', wallPrice: 1200, ammoPrice: 600, box: true,
    mag: 30, chamber: 1, reserve: 150, rpm: 700, mode: 'auto',
    damage: 34, headshotMul: 2.0, range: 90, falloff: [15, 45, 0.6], pellets: 1, spread: { hip: 0.04, ads: 0.0045, move: 0.022, air: 0.06, bloom: 0.0016, bloomMax: 0.024 }, penetration: 0,
    reloadTime: 2.4, reloadEmpty: 2.75, drawTime: 0.5, firstDraw: 1.05, holsterTime: 0.3, adsTime: 0.22, sprintOut: 0.18,
    caliber: '5.45x39mm', cal: 0.9, velocity: 735, mass: 2.7, lengthM: 0.735, barrelM: 0.206, momentum: 4.2,
    tracer: { color: [1.0, 0.66, 0.32], speed: 735, len: 10, width: 0.01, a: 0.65 },
    recoil: { camKick: [0.4, 0.17, 0.16], climb: [0.0033, 0.0022], vmBack: 0.5, vmPitch: 1.3, vmRoll: 1.8, vmSide: 0.9, k: 560, c: 36, recover: 9 },
    casing: '545', ejectDir: [0.95, 0.3, 0.05], ejectSpeed: [4.0, 5.5],
    flash: { style: 'booster', size: 0.9, len: 1.1, light: 200, color: 0xffa04a },
    zoom: 1.25, vmFov: 52, adsVmFov: 44, sound: 'ak74u',
  },
  remington870: {
    id: 'remington870', name: 'Remington 870', class: 'shotgun', wallPrice: 1500, ammoPrice: 750, box: true,
    mag: 6, chamber: 1, reserve: 42, rpm: 75, mode: 'pump', triggerRate: 3,
    damage: 90, headshotMul: 1.5, range: 32, falloff: [6, 24, 0.15], pellets: 9, spread: { hip: 0.07, ads: 0.055, move: 0.01, air: 0.02 }, penetration: 0,
    reloadTime: 0.45, reloadStart: 0.38, reloadEnd: 0.4, drawTime: 0.55, firstDraw: 1.0, holsterTime: 0.32, adsTime: 0.24, sprintOut: 0.2, pumpTime: 0.52,
    caliber: '12 gauge 00 buck', cal: 1.6, velocity: 400, mass: 3.3, lengthM: 1.01, barrelM: 0.457, momentum: 15,
    tracer: { color: [1.0, 0.72, 0.4], speed: 400, len: 2.6, width: 0.006, a: 0.4 },
    recoil: { camKick: [2.1, 0.28, 0.6], climb: [0.011, 0.002], vmBack: 1.7, vmPitch: 5, vmRoll: 4, vmSide: 1.8, k: 240, c: 21, recover: 5 },
    casing: '12ga', ejectDir: [0.95, 0.45, 0.1], ejectSpeed: [2.2, 3.0],
    flash: { style: 'shotgun', size: 1.15, len: 1.5, light: 300, color: 0xffa050 },
    zoom: 1.12, vmFov: 54, adsVmFov: 42, sound: 'remington870',
  },
  raygun: {
    id: 'raygun', name: 'Ray Gun', class: 'wonder', wallPrice: 0, ammoPrice: 0, box: true,
    mag: 20, chamber: 0, reserve: 160, rpm: 190, mode: 'semi', triggerRate: 3.2,
    damage: 200, headshotMul: 1.0, range: 120, falloff: null, pellets: 1, spread: { hip: 0.012, ads: 0.003, move: 0.01, air: 0.02 }, penetration: 0,
    explosive: { radius: 2.6, damage: 300 }, reloadTime: 2.0, reloadEmpty: 2.0, drawTime: 0.5, firstDraw: 1.0, holsterTime: 0.3, adsTime: 0.18, sprintOut: 0.16,
    caliber: 'plasma bolt', cal: 1.0, velocity: 220, mass: 1.4, lengthM: 0.29, barrelM: 0.12, momentum: 3.0,
    tracer: { color: [0.35, 1.0, 0.45], speed: 220, len: 1.4, width: 0.06, a: 1.6 },
    recoil: { camKick: [0.6, 0.12, 0.25], climb: [0.003, 0.0008], vmBack: 1.0, vmPitch: 6, vmRoll: 2, vmSide: 0.8, k: 420, c: 24, recover: 8 },
    casing: null, flash: { style: 'ray', size: 0.9, len: 1.0, light: 120, color: 0x60ff70 },
    zoom: 1.1, vmFov: 54, adsVmFov: 48, sound: 'raygun',
  },
};
export const WEAPON_IDS = Object.keys(WEAPONS);
export const GRENADE = { max: 4, fuse: 3.2, radius: 5.2, damage: 320, throwSpeed: 15.5, mass: 0.4 };
export const KNIFE = { range: 1.9, damage: 150, time: 0.58, hitT: 0.19 };
