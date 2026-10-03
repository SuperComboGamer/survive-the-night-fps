// UI sandbox: drives the UI with fake data. ?screen=splash|hud|hud-night|hud-horde|hud-zombie|hud-downed|hud-dawn|
// hud-finale|hud-live|inventory|players|build|death|gameover|victory|pause|settings|chat|icons   &bg=night|day|fire
// &status=ok|full|offline   hud: &weapon=<item id>&mag=&reserve=&reload=&heals=&drinks=
import { UI } from '../ui/ui.js';
import { ITEM, ITEM_DEFS, STRUCT, STRUCT_ORDER, ZTYPE, ZOMBIE_DEFS } from '../../shared/defs.js';
import { PHASE, INVENTORY_MAX } from '../../shared/constants.js';
import { itemIcon, structIcon, glyph, GLYPH_NAMES } from '../ui/icons.js';

const q = new URLSearchParams(location.search);
const screen = q.get('screen') || 'hud';
const statusMode = q.get('status') || 'ok';

// ---------------------------------------------------------------- fake 3D scene background
function pines(seed, h, color, count) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let d = '';
  for (let i = 0; i < count; i++) {
    const x = (i / count) * 1000 + r() * 30;
    const th = h * (0.55 + r() * 0.45);
    const w = th * (0.18 + r() * 0.08);
    for (let t = 0; t < 4; t++) {
      const y = 400 - th * (t / 4.2);
      const ww = w * (1 - t * 0.2);
      d += `M${(x - ww).toFixed(1)} ${(y + 6).toFixed(1)}L${x.toFixed(1)} ${(y - th * 0.36).toFixed(1)}L${(x + ww).toFixed(1)} ${(y + 6).toFixed(1)}Z`;
    }
    d += `M${(x - 1.5).toFixed(1)} 400V${(400 - th * 0.2).toFixed(1)}h3V400Z`;
  }
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 400' preserveAspectRatio='none'><path fill='${color}' d='${d}M0 398H1000V400H0Z'/></svg>`)}")`;
}

function buildScene(kind) {
  const game = document.getElementById('game');
  const sc = document.createElement('div');
  sc.className = 'scene';
  const day = kind === 'day';
  const sky = document.createElement('div');
  sky.className = 'sky';
  sky.style.background = day
    ? 'linear-gradient(180deg,#9aa6a4 0%,#b9bfb6 45%,#c9c6b4 62%,#7d8472 100%)'
    : 'radial-gradient(circle at 72% 18%, rgba(210,220,235,.55) 0 1.2vmin, rgba(160,180,210,.18) 2vmin, transparent 18vmin), linear-gradient(180deg,#0b0f17 0%,#141b22 45%,#1b2224 62%,#07090a 100%)';
  sc.appendChild(sky);
  const layers = day
    ? [
        ['#6f786d', 330, 44, '62%'],
        ['#4d5649', 380, 34, '56%'],
        ['#2c3329', 400, 26, '50%'],
      ]
    : [
        ['#1a2124', 330, 44, '62%'],
        ['#101517', 380, 34, '56%'],
        ['#07090a', 400, 26, '50%'],
      ];
  layers.forEach(([c, h, n, height], i) => {
    const t = document.createElement('div');
    t.className = 'trees';
    t.style.height = height;
    t.style.bottom = 18 - i * 6 + '%';
    t.style.backgroundImage = pines(11 + i * 97, h, c, n);
    t.style.backgroundSize = '100% 100%';
    sc.appendChild(t);
  });
  const g = document.createElement('div');
  g.className = 'ground';
  g.style.background = day ? 'linear-gradient(180deg,#3a3f30,#23261d)' : 'linear-gradient(180deg,#0b0d0c,#030404)';
  sc.appendChild(g);
  if (kind === 'fire' || kind === 'night') {
    const f = document.createElement('div');
    f.className = 'sb-fire';
    sc.appendChild(f);
  }
  game.appendChild(sc);
}

// ---------------------------------------------------------------- mock /status
const realFetch = window.fetch.bind(window);
window.fetch = async (url, opts) => {
  if (String(url).endsWith('/status')) {
    await new Promise((r) => setTimeout(r, 120));
    if (statusMode === 'offline') throw new TypeError('Failed to fetch');
    const body = statusMode === 'full' ? { players: 8, max: 8, phase: PHASE.NIGHT, day: 4 } : { players: 3, max: 8, phase: PHASE.NIGHT, day: 2 };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(url, opts);
};

// ---------------------------------------------------------------- UI instance
const log = (...a) => console.log('[cb]', ...a);
const ui = new UI(document.getElementById('ui'), {
  onJoin: (n) => {
    log('join', n);
    if (q.get('joinfail')) setTimeout(() => ui.setJoinError('Connection failed. The server did not answer.'), 800);
  },
  onCraft: (id) => log('craft', id),
  onCraftRepeat: (id, n) => log('craft', id, 'and', n, 'more'),
  onUseItem: (i) => log('use', i),
  onDropItem: (i, c) => log('drop', i, c),
  onSplitItem: (i, c) => log('split', i, c),
  onDropAmmo: (cal, c) => log('dropAmmo', cal, c),
  onSalvage: (from, c) => log('salvage', from, c),
  onSwapItems: (a, b) => log('swap', a, b),
  onEquipArmor: (i) => log('armor', i),
  onDropWeapon: (s) => log('dropWeapon', s),
  onUnequip: (s, to) => log('unequip', s, to),
  onWorn: (which, what) => log('worn', which, what),
  onSortItems: () => log('sort'),
  onSelectStructure: (t) => log('struct', t),
  onSelectThrowable: (t) => log('throwable', t),
  onCloseInventory: () => {
    log('closeInventory');
    ui.setInventoryOpen(false);
  },
  onChatSend: (t) => {
    log('chat', t);
    ui.addChat('You', t, { color: '#e8a33d' });
  },
  onSettings: (s) => log('settings', JSON.stringify(s)),
  onResume: () => log('resume'),
  onLeave: () => log('leave'),
  onUiSound: () => {},
});
window.ui = ui;

// ---------------------------------------------------------------- fake data
const baseHud = {
  hp: 76,
  maxHp: 100,
  armor: 42,
  armorMax: 60,
  stamina: 64,
  exhausted: false,
  heals: +(q.get('heals') ?? 3),
  drinks: +(q.get('drinks') ?? 2),
  flashlight: 58,
  flashlightOn: false,
  zombie: false,
  slot: 0,
  weapons: [ITEM.AK47, ITEM.PISTOL, ITEM.MACHETE, ITEM.MOLOTOV, ITEM.HAMMER],
  throwItem: ITEM.MOLOTOV,
  throwCount: 2,
  mag: 24,
  reserve: 90,
  reloading: -1,
  phase: PHASE.DAY,
  day: 3,
  timeLeft: 134,
  night: 0.1,
  hordeLeft: -1,
  boss: null,
  prompt: '[E] Hold to search Locker',
  crosshair: { spread: 7, visible: true },
  useProgress: -1,
  useLabel: '',
  context: { type: 'structure', name: 'Door Boards', hp: 0.64 },
  ping: 42,
  fps: 118,
  players: { alive: 3, total: 4 },
  yaw: 0.6,
  compassMarks: [
    { kind: 'car', bearing: -0.3, icon: glyph('car'), label: '142m' },
    { kind: 'hint', bearing: 0.35, icon: itemIcon(ITEM.CAR_BATTERY), label: '88m' },
    { kind: 'mate', bearing: -0.9, icon: glyph('person'), label: 'Marlowe', hp: 0.45 },
    { kind: 'ping', bearing: -0.55, icon: glyph('ping'), label: '31m', cls: 'p1' },
    { kind: 'poi', bearing: 0.9, icon: glyph('flag'), label: '' },
  ],
  worldMarks: [
    { kind: 'mate', x: 420, y: 300, icon: '', name: 'Marlowe', sub: '38m', bar: 0.45, scale: 1 },
    { kind: 'mate', x: 900, y: 420, icon: glyph('downed'), name: 'Old Hank', sub: 'DOWN · hold [E] to revive', cls: 'downed', scale: 1 },
    { kind: 'ping', x: 700, y: 360, icon: glyph('ping'), name: 'Marlowe: Loot', sub: '22m', cls: 'p2', scale: 1 },
  ],
  objective: { supplies: [1, 0, 1, 0, 2], hints: [3, 1, 6, 4, 2, 9, 13], carried: { [ITEM.SPARE_TIRE]: 1 }, anyCarried: true, phase: PHASE.DAY, timeLeft: 134, finale: false, escapeT: 0, escapeReady: false, suppliesDone: false, wave: 0, waves: 3 },
};

// ?pack=1: wearing a backpack (the grid's last cells open, two of them used)
const inv = {
  slots: Array.from({ length: INVENTORY_MAX }, () => null),
  armor: { item: ITEM.JACKET, points: 42, max: 60 },
  backpack: q.get('pack') ? ITEM.BACKPACK : 0,
  ammo: [46, 12, 90, 0, 0, 7, 120],
  weapons: [ITEM.AK47, ITEM.PISTOL, ITEM.MACHETE, ITEM.MOLOTOV, ITEM.HAMMER],
  throwCounts: { [ITEM.MOLOTOV]: 2, [ITEM.PIPEBOMB]: 1 },
};
[
  [ITEM.WOOD, 14],
  [ITEM.NAILS, 32],
  [ITEM.CLOTH, 7],
  [ITEM.SCRAP, 5],
  [ITEM.BANDAGE, 3],
  [ITEM.MEDKIT, 1],
  [ITEM.HERB, 4],
  [ITEM.ALCOHOL, 2],
  [ITEM.STICK, 9],
  [ITEM.TAPE, 1],
  [ITEM.POWDER, 6],
  [ITEM.BATTERY, 2],
  [ITEM.SHOTGUN, 1],
  [ITEM.KEVLAR, 1],
  [ITEM.SPARK_PLUGS, 1],
  [ITEM.TORCH, 3],
  [ITEM.WIRE, 2],
  [ITEM.PAINKILLERS, 2],
  [ITEM.TUNA, 2],
  [ITEM.ENERGY_DRINK, 2],
].forEach(([item, count], i) => {
  inv.slots[i < 12 ? i : i + 1] = { item, count };
});
if (inv.backpack) {
  inv.slots[24] = { item: ITEM.LEATHER, count: 3 };
  inv.slots[25] = { item: ITEM.ROPE, count: 2 };
}

const players = [
  { id: 1, name: 'Survivor417', status: 'alive', hp: 1, kills: 23, ping: 42, talking: false, self: true },
  { id: 2, name: 'Marlowe', status: 'alive', hp: 0.45, kills: 31, ping: 67, talking: true, self: false },
  { id: 3, name: 'deadeye_kat', status: 'zombie', kills: 12, ping: 88, talking: false, self: false },
  { id: 4, name: 'Old Hank', status: 'downed', kills: 8, ping: 120, talking: false, self: false },
  { id: 5, name: 'Ruth', status: 'dead', kills: 3, ping: 55, talking: false, self: false },
];

function feedSome() {
  ui.killfeed({ killer: 'Marlowe', victim: 'Runner', weaponItem: ITEM.SHOTGUN, headshot: false, killerZombie: false, victimPlayer: false });
  ui.killfeed({ killer: 'Survivor417', victim: 'Walker', weaponItem: ITEM.AK47, headshot: true, killerZombie: false, victimPlayer: false });
  ui.killfeed({ killer: 'Tank', victim: 'Ruth', weaponItem: 0, headshot: false, killerZombie: true, victimPlayer: true });
  ui.killfeed({ killer: 'Old Hank', victim: 'Spitter', weaponItem: ITEM.HUNTING_RIFLE, headshot: true, killerZombie: false, victimPlayer: false });
  ui.addChat('', 'Ruth has joined the camp.', { system: true });
  ui.addChat('Marlowe', 'got the fan belt from the ranger tower, heading back', { color: '#7fc6e8' });
  ui.addChat('Old Hank', 'fire is getting low, bring planks <b>now</b>', { color: '#e8c07f' });
  ui.addChat('deadeye_kat', 'i can smell you all', { zombie: true, color: '#a3d64e' });
  ui.pickup(ITEM.CLOTH, 3);
  ui.pickup(ITEM.AMMO_762, 30);
  ui.pickup(ITEM.NAILS, 6);
  ui.pickup(ITEM.FAN_BELT, 1);
  ui.setVoiceState({ enabled: true, transmitting: false, speakers: ['Marlowe'] });
}

function loop(getHud) {
  let t0 = performance.now();
  const tick = (t) => {
    const h = getHud((t - t0) / 1000);
    ui.updateHud(h);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function perfCheck(h) {
  // updateHud with unchanged data must be very cheap
  const n = 20000;
  const s = performance.now();
  for (let i = 0; i < n; i++) ui.updateHud(h);
  const us = ((performance.now() - s) / n) * 1000;
  console.log(`[perf] updateHud unchanged: ${us.toFixed(2)} µs/call`);
}

ui.setInventory(inv);
ui.setPlayers(players);
ui.setCraftContext({ fire: true, bench: false, unlocked: 0b00101 });

// ?minimap=1: the minimap setting on, over a real valley (&seed=), you by the car (&yaw=, &spin=1 turns you),
// a teammate close by, a downed one, your waypoint and a supply drop out of range (on the rim)
if (q.get('minimap')) {
  const { createWorld } = await import('../../shared/world.js');
  const world = createWorld(+(q.get('seed') || 1337));
  ui.map.setWorld(world);
  ui._applySettings({ ...ui.getSettings(), minimap: true });
  const car = world.car;
  const far = world.zones.map((z) => ({ z, d: Math.hypot(z.x - car.x, z.z - car.z) })).sort((a, b) => a.d - b.d);
  const near = far[0].z; // the place nearest the car: you stand between them
  const self = { x: (car.x + near.x) / 2, z: (car.z + near.z) / 2 };
  const way = far[3].z;
  const t0 = performance.now();
  const upd = ui.updateHud.bind(ui);
  ui.updateHud = (h) => {
    if (!h || h.zombie) return upd(h);
    const yaw = +(q.get('yaw') ?? 0.6) + (q.get('spin') ? ((performance.now() - t0) / 1000) * 0.6 : 0);
    upd({
      ...h,
      yaw,
      minimap: ui.inventoryOpen
        ? null
        : {
            self: { ...self, yaw },
            mates: [
              { x: self.x + 18, z: self.z - 22, name: 'Marlowe', status: 'alive' },
              { x: self.x - 160, z: self.z + 90, name: 'Old Hank', status: 'downed' },
            ],
            car,
            pings: [{ x: self.x - 12, z: self.z - 30, kind: 2, name: 'Marlowe' }],
            crates: [{ x: self.x + 200, z: self.z + 40 }],
            benches: [],
            discovered: new Set(world.zones.map((z) => z.id)),
            hints: h.objective?.hints || [],
            found: 0,
            supplies: h.objective?.supplies || [0, 0, 0, 0, 0],
            carried: h.objective?.carried || {},
            waypoint: { x: way.x, z: way.z, zone: way.id },
            teamWays: [],
          },
    });
  };
}

// ---------------------------------------------------------------- screens
let bg = q.get('bg');
if (q.get('conn')) setTimeout(() => ui.setConnectionStatus('Reconnecting'), 300);
if (q.get('tx')) setTimeout(() => ui.setVoiceState({ enabled: true, transmitting: true, speakers: ['Marlowe', 'Old Hank'] }), 300);
if (q.get('fps')) ui._applySettings({ ...ui.getSettings(), showFps: true });
switch (screen) {
  case 'splash': {
    buildScene(bg || 'fire');
    ui.showSplash();
    if (q.get('settings')) setTimeout(() => ui.settingsPanel.show(), 50);
    break;
  }
  case 'hud': {
    buildScene(bg || 'day');
    const h = { ...baseHud };
    // &weapon=<item id>&mag=<n>&reserve=<n>&reload=<0..1>: try the ammo block with any primary
    if (q.get('weapon')) Object.assign(h, { weapons: [+q.get('weapon'), ...baseHud.weapons.slice(1)], mag: +q.get('mag') || 0, reserve: +(q.get('reserve') ?? 24), reloading: q.get('reload') == null ? -1 : +q.get('reload') });
    ui.hideSplash();
    ui.updateHud(h);
    perfCheck(h);
    feedSome();
    ui.notify('Not enough materials', 'warning', 30);
    ui.notify('Marlowe installed the Fan Belt', 'good', 30);
    loop((t) => ({ ...h, crosshair: { spread: 7 + Math.abs(Math.sin(t * 2)) * 4, visible: true }, timeLeft: Math.max(0, 134 - t) }));
    setTimeout(() => ui.hitmarker(true, true), 1600);
    break;
  }
  case 'hud-night': {
    buildScene(bg || 'night');
    const h = {
      ...baseHud,
      phase: PHASE.NIGHT,
      day: 3,
      timeLeft: 112,
      night: 1,
      hordeLeft: 37,
      slot: 1,
      mag: 3,
      reserve: 46,
      flashlightOn: true,
      flashlight: 12,
      boss: { name: ZOMBIE_DEFS[ZTYPE.BOSS_ABOMINATION].name, hp: 0.64 },
      prompt: '[E] Install Car Battery',
      context: { type: 'car', parts: 0b01011 },
    };
    ui.hideSplash();
    feedSome();
    loop((t) => ({ ...h, reloading: (t % 1.4) / 1.4, timeLeft: Math.max(0, 112 - t) }));
    setTimeout(() => ui.notify('The Abomination', 'big', 60), 100);
    setTimeout(() => ui.notify('It has come for the fire', 'sub', 60), 200);
    break;
  }
  case 'hud-horde': {
    buildScene(bg || 'day');
    const h = {
      ...baseHud,
      timeLeft: 23,
      hp: 22,
      armor: 0,
      armorMax: 0,
      stamina: 12,
      exhausted: true,
      slot: 2,
      mag: null,
      reserve: null,
      prompt: null,
      context: { type: 'structure', name: 'Wood Wall', hp: 0.28 },
      useProgress: 0.62,
      useLabel: 'Bandaging',
      crosshair: { spread: 5, visible: true },
      objective: { ...baseHud.objective, carried: {}, anyCarried: false, timeLeft: 23 },
    };
    ui.hideSplash();
    feedSome();
    ui.notify('The horde is coming', 'big', 60);
    ui.notify('Get back to the fire', 'sub', 60);
    ui.notify('THE HORDE IS COMING', 'danger', 60);
    loop((t) => ({ ...h, timeLeft: Math.max(0, 23 - t), objective: { ...h.objective, timeLeft: Math.ceil(Math.max(0, 23 - t)) } }));
    setTimeout(() => ui.damage(45), 300);
    setTimeout(() => ui.damage(30), 900);
    break;
  }
  case 'hud-zombie': {
    buildScene(bg || 'night');
    const h = { ...baseHud, zombie: true, hp: 212, maxHp: 260, armor: 0, armorMax: 0, phase: PHASE.NIGHT, timeLeft: 88, night: 1, hordeLeft: 21, ability: 0.55, prompt: null, context: null };
    ui.hideSplash();
    feedSome();
    ui.addChat('', 'You have risen. Hunt the survivors.', { system: true });
    loop((t) => ({ ...h, ability: Math.min(1, 0.55 + t * 0.12) }));
    break;
  }
  case 'hud-downed': {
    buildScene(bg || 'night');
    const reviving = !!q.get('revive');
    const h = { ...baseHud, hp: 30, phase: PHASE.NIGHT, timeLeft: 88, night: 1, hordeLeft: 21, prompt: null, context: null, crosshair: { spread: 7, visible: false } };
    ui.hideSplash();
    feedSome();
    loop((t) => ({ ...h, downed: { bleed: Math.max(0, 22 - t), reviving, medkit: !!q.get('medkit') } }));
    break;
  }
  case 'hud-dawn': {
    buildScene(bg || 'day');
    const h = { ...baseHud, day: 4, timeLeft: 296, prompt: null, context: null, objective: { ...baseHud.objective, carried: {}, anyCarried: false } };
    ui.hideSplash();
    ui.updateHud(h);
    ui.notify('Dawn', 'big', 60);
    ui.notify('You made it through the night', 'sub', 60);
    ui.showSummary({ night: 3, kills: 64, structLost: 5, downs: 2, revives: 1, deaths: 0 }, 'Horde 4: bigger and hungrier. Boomers join the horde: they burst against your walls. Shoot them far off.', null, { name: 'The Bloater', tip: ZOMBIE_DEFS[ZTYPE.BOSS_BLOATER].tip });
    break;
  }
  case 'hud-finale': {
    buildScene(bg || 'night');
    // &ready: the engine is warm (&leaving: somebody is getting in); &stalled: nobody at the car, the warm-up stands still
    const ready = !!q.get('ready');
    const stalled = !ready && !!q.get('stalled');
    const leaving = ready && !!q.get('leaving');
    const h = {
      ...baseHud,
      phase: PHASE.NIGHT,
      night: 1,
      hordeLeft: 58,
      finale: true,
      escapeReady: ready,
      escapeStalled: stalled,
      escapeLeaving: leaving,
      slot: 0,
      mag: 4,
      reserve: 0,
      prompt: ready ? '[E] Hold to get in and drive away' : null,
      context: null,
      compassMarks: [{ kind: 'car', bearing: -2.4, icon: glyph('car'), label: '63m', pinEdge: true, cls: 'urgent' }, ...baseHud.compassMarks.slice(1)],
      worldMarks: [{ kind: 'car', x: 1180, y: 430, icon: glyph('car'), name: ready ? 'GET IN' : stalled ? 'Engine stalled' : 'Defend the car', sub: '63m', cls: 'urgent', scale: 0.95 }],
    };
    ui.hideSplash();
    feedSome();
    loop((t) => {
      const escapeT = stalled ? 47 : Math.max(0, 47 - t);
      return { ...h, escapeT, objective: { ...baseHud.objective, supplies: [1, 1, 1, 1, 3], carried: {}, anyCarried: false, suppliesDone: true, phase: PHASE.NIGHT, finale: true, escapeT: Math.ceil(escapeT), escapeReady: ready, escapeStalled: stalled, escapeLeaving: leaving } };
    });
    break;
  }
  // everything moving at once: a firefight, to judge the HUD's motion
  case 'hud-live': {
    buildScene(bg || 'night');
    const h = { ...baseHud, phase: PHASE.NIGHT, night: 1, hordeLeft: 40, timeLeft: 150, prompt: null, context: null };
    ui.hideSplash();
    let mag = 30;
    let reserve = 90;
    let hp = 100;
    let shotT = 0;
    let reloadT = -1;
    let last = 0;
    loop((t) => {
      const dt = t - last;
      last = t;
      if (reloadT >= 0) {
        reloadT += dt / 2.3;
        if (reloadT >= 1) {
          const take = Math.min(30 - mag, reserve);
          mag += take;
          reserve -= take;
          reloadT = -1;
        }
      } else if ((shotT -= dt) <= 0) {
        if (mag > 0) {
          mag--;
          shotT = 0.1;
          if (Math.random() < 0.3) ui.hitmarker(Math.random() < 0.3, Math.random() < 0.25);
        } else if (reserve > 0) reloadT = 0;
        else reserve = 90;
      }
      if (Math.random() < 0.006) {
        const d = 6 + Math.random() * 22;
        hp = Math.max(8, hp - d);
        ui.damage(d, Math.random() * 6.28);
      } else if (Math.random() < 0.002) hp = Math.min(100, hp + 35);
      return { ...h, hp, mag, reserve, reloading: reloadT, stamina: 50 + Math.sin(t) * 50, exhausted: Math.sin(t) < -0.9, yaw: t * 0.4, hordeLeft: Math.max(0, 40 - Math.floor(t)), timeLeft: 150 - t };
    });
    break;
  }
  case 'players': {
    buildScene(bg || 'night');
    ui.hideSplash();
    ui.updateHud({ ...baseHud });
    ui.setRosterOpen(true);
    break;
  }
  case 'inventory': {
    buildScene(bg || 'fire');
    ui.hideSplash();
    ui.updateHud({ ...baseHud, crosshair: { spread: 7, visible: false } });
    ui.setCraftContext({ fire: q.get('station') !== '0', bench: q.get('station') !== '0', unlocked: 0b00011 });
    ui.setInventoryOpen(true);
    if (q.get('tip')) {
      // simulate hover over a slot to show the tooltip
      setTimeout(() => {
        const cell = document.querySelectorAll('.cell')[5];
        const r = cell.getBoundingClientRect();
        cell.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
      }, 200);
    }
    if (q.get('craft')) {
      setTimeout(() => {
        const rc = document.querySelectorAll('.rc')[2];
        const r = rc.getBoundingClientRect();
        rc.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
      }, 200);
    }
    break;
  }
  case 'build': {
    buildScene(bg || 'day');
    ui.hideSplash();
    const h = { ...baseHud, slot: 4, mag: null, reserve: null, prompt: '[E] Repair Wood Wall', context: { type: 'structure', name: 'Wood Wall', hp: 0.55 } };
    ui.updateHud(h);
    const counts = {};
    for (const s of inv.slots) if (s) counts[s.item] = (counts[s.item] || 0) + s.count;
    ui.setBuildMenu({ selected: STRUCT.WALL, rotate: 90, counts, valid: q.get('valid') !== '0' });
    ui.notify('Wood Wall built', 'toast', 60);
    break;
  }
  case 'death': {
    buildScene(bg || 'night');
    ui.hideSplash();
    ui.updateHud({ ...baseHud, hp: 0, phase: PHASE.NIGHT, timeLeft: 88, night: 1, hordeLeft: 21 });
    ui.showDeath({ killer: 'The Abomination', day: 3 });
    break;
  }
  case 'gameover':
  case 'victory': {
    buildScene(bg || 'night');
    ui.hideSplash();
    ui.updateHud(baseHud);
    const stats = {
      days: 6,
      kills: players.map((p) => ({ name: p.name, kills: p.kills })),
      restartIn: 12,
      reason: screen === 'gameover' ? 'The last survivor fell on night 6.' : '',
      // &record=1: the personal record panel too, as after a run that counted
      record: q.get('record')
        ? { run: { secs: 2710, nights: 5, kills: 31 }, news: [{ k: 'kills', label: 'New best', text: '31 kills', was: '24' }], record: { best: { secs: 0, nights: 5, kills: 31 }, total: { runs: 9, escapes: 0, streak: 0 } } }
        : undefined,
      // the difficulty poll, against made-up votes: &vote=1..5 casts one as the screen comes up
      vote: (rating) =>
        new Promise((done) => {
          const counts = [4, 11, 23, 17, 6];
          counts[rating - 1]++;
          setTimeout(() => done({ mine: rating, counts, total: counts.reduce((a, b) => a + b, 0) }), 300);
        }),
    };
    if (screen === 'gameover') ui.showGameOver(stats);
    else ui.showVictory(stats);
    if (+q.get('vote')) ui.end._vote(+q.get('vote'));
    break;
  }
  case 'pause':
  case 'settings': {
    buildScene(bg || 'night');
    ui.hideSplash();
    ui.updateHud({ ...baseHud, phase: PHASE.NIGHT, night: 1, hordeLeft: 30 });
    ui.showPause(true);
    if (screen === 'settings') ui.settingsPanel.show();
    break;
  }
  case 'chat': {
    buildScene(bg || 'night');
    ui.hideSplash();
    ui.updateHud({ ...baseHud, phase: PHASE.NIGHT, night: 1, hordeLeft: 30 });
    feedSome();
    for (let i = 0; i < 8; i++) ui.addChat(players[i % 4].name, ['anyone got nails?', 'on my way', 'TANK AT THE GATE', 'need a medkit', 'lol'][i % 5], { color: ['#e8a33d', '#7fc6e8', '#a3d64e', '#e8c07f'][i % 4] });
    ui.openChat();
    setTimeout(() => {
      const f = document.querySelector('.chat-field');
      f.value = 'hold the north wall, i have the shotgun';
    }, 50);
    break;
  }
  case 'icons': {
    const g = document.createElement('div');
    g.className = 'gallery';
    let html = '<h2>Items</h2>';
    for (const id of Object.keys(ITEM_DEFS)) html += `<div>${itemIcon(+id)}<span>${id} · ${ITEM_DEFS[id].name}</span></div>`;
    html += '<h2>Structures</h2>';
    for (const t of STRUCT_ORDER) html += `<div>${structIcon(t)}<span>${t}</span></div>`;
    html += '<h2>Glyphs</h2>';
    for (const n of GLYPH_NAMES) html += `<div>${glyph(n)}<span>${n}</span></div>`;
    g.innerHTML = html;
    if (q.get('big')) g.style.cssText = 'grid-template-columns:repeat(auto-fill,minmax(260px,1fr))', g.querySelectorAll('.ico').forEach((i) => (i.style.height = '100px', i.style.maxWidth = '240px'));
    document.body.appendChild(g);
    break;
  }
  default:
    buildScene('night');
    ui.showSplash();
}
