// Permanent loadout item foundation:
// - owned copies are individual instances, grants are idempotent by ledger id
// - equipped slots persist and guests merge into accounts
// - in-run loadout copies cannot be dropped/salvaged/traded and do not drop on death
import { createHash, randomUUID } from 'node:crypto';
import { LoadoutService, MemoryLoadoutStore } from '../server/userloadout.js';
import { Loadouts, LocalLoadouts, clearLoadoutRun, loadoutCombatEffect } from '../server/loadouts.js';
import { Game } from '../server/game.js';
import { AMMO, ITEM, ZTYPE } from '../shared/defs.js';
import { ACT, C2S, PROTOCOL_VERSION, SALVAGE_FROM, WORN, WORN_DO, Writer } from '../shared/protocol.js';
import { LOADOUT_CATALOG, LOADOUT_RARITY, LOADOUT_SLOTS, loadoutDef, loadoutEffects, loadoutMods } from '../shared/loadout.js';

const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : info}`);
  if (!ok) fails.push(name);
};
const guest = () => `g:${createHash('sha256').update(randomUUID()).digest('hex')}`;
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};

function room(code = 'R') {
  const r = { code, closed: false, got: [] };
  r.worker = { postMessage: (m) => r.got.push(m) };
  r.colls = (owner) => r.got.filter((m) => m.op === 'coll' && m.owner === owner);
  return r;
}

async function persistence() {
  console.log('\n-- loadout persistence');
  const store = new MemoryLoadoutStore();
  const svc = new LoadoutService({ store });
  const r = room();
  const a = guest();
  svc.fromRoom(r, { t: 'loadout', op: 'enter', owner: a });
  await settle();
  check('collection loads empty for a new owner', r.colls(a).at(-1)?.ok === true && r.colls(a).at(-1).items.length === 0);
  await svc.grant(a, 1, { kind: 'test' }, 'grant:one');
  await svc.grant(a, 1, { kind: 'test' }, 'grant:one');
  const c1 = await svc.collection(a);
  check('grant id is applied once, owned copy has its own id', c1.items.length === 1 && /^[0-9a-f-]{36}$/.test(c1.items[0].id), JSON.stringify(c1));
  await svc.grant(a, 1, { kind: 'test' }, 'grant:two');
  const c2 = await svc.collection(a);
  check('duplicates are separate owned instances', c2.items.length === 2 && c2.items[0].id !== c2.items[1].id);
  const saved = await svc.equip(a, [c2.items[0].id, c2.items[1].id, c2.items[0].id]);
  check('equipped slots keep only owned unique instances', saved.slots[0] === c2.items[0].id && saved.slots[1] === c2.items[1].id && saved.slots[2] === null, JSON.stringify(saved.slots));
  const acct = `a:${randomUUID()}`;
  store.accounts = new Set([acct.slice(2)]);
  await svc.mergeGuest(acct.slice(2), randomUUID()); // wrong guest: no-op
  check('merge of an unrelated guest is a no-op', (await svc.collection(acct)).items.length === 0);
  const rawGuest = randomUUID();
  const gkey = `g:${createHash('sha256').update(rawGuest).digest('hex')}`;
  await svc.grant(gkey, 3, {}, 'guest:medal');
  const gcoll = await svc.collection(gkey);
  await svc.equip(gkey, [gcoll.items[0].id, null, null]);
  await svc.mergeGuest(acct.slice(2), rawGuest);
  check('guest items and slots move onto the account', (await svc.collection(gkey)).items.length === 0 && (await svc.collection(acct)).items.some((it) => it.catalog === 3) && (await svc.collection(acct)).slots.some(Boolean));
}

function catalogRules() {
  console.log('\n-- loadout catalog rules');
  const ids = new Set();
  const keys = new Set();
  for (const def of LOADOUT_CATALOG) {
    check(`catalog item ${def.id} has a stable unique id`, Number.isInteger(def.id) && !ids.has(def.id), def.key);
    check(`catalog item ${def.id} has a stable unique key`, typeof def.key === 'string' && !!def.key && !keys.has(def.key), def.name);
    ids.add(def.id);
    keys.add(def.key);
    check(`catalog item ${def.id} has display data`, !!def.name && !!def.flavor && !!def.type && !!def.rarity && !!def.source?.kind);
    check(`catalog item ${def.id} rarity is known`, !!LOADOUT_RARITY[Object.keys(LOADOUT_RARITY).find((k) => LOADOUT_RARITY[k] === def.rarity)]);
  }
  check('catalog has the requested large item range', LOADOUT_CATALOG.length >= 50 && LOADOUT_CATALOG.length <= 80, `${LOADOUT_CATALOG.length} items`);
  for (const z of [ZTYPE.BOSS_BRUTE, ZTYPE.BOSS_ALPHA, ZTYPE.BOSS_BLOATER, ZTYPE.BOSS_ABOMINATION, ZTYPE.BOSS_HIVEQUEEN]) {
    check(`boss ${z} has multiple signature items`, LOADOUT_CATALOG.filter((def) => def.source?.kind === 'boss' && def.source.boss === z).length >= 3);
  }
  const capped = loadoutMods([3, 67, 73].map(loadoutDef));
  check('stacked max health is capped below perk-tree power', capped.hp === 15, JSON.stringify(capped));
  const tanky = loadoutMods([8, 25, 71].map(loadoutDef));
  check('stacked damage reduction is capped', tanky.hurt >= 0.85, JSON.stringify(tanky));
  const ammo = loadoutEffects([46, 46, 46].map(loadoutDef)).ammo.find((e) => e.ammo === AMMO.P9);
  check('stacked special ammo damage is capped', ammo.damage <= 1.1 && ammo.headshot <= 1.08, JSON.stringify(ammo));
}

function fakeSession() {
  return { send() {}, cork(fn) { fn(); }, closed: false, slot: 0, user: null, ip: '127.0.0.1', congested: () => false };
}
function join(game, name, pid) {
  const session = game.onOpen(fakeSession());
  const w = new Writer(128);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  w.str(pid);
  game.onMessage(session, w.bytes());
  return [...game.players.values()].find((p) => p.name === name);
}
function action(game, p, kind, write = () => {}) {
  const w = new Writer(32);
  w.u8(C2S.ACTION);
  w.u8(kind);
  write(w);
  game.onMessage(p.session, w.bytes());
}

async function inRunRules() {
  console.log('\n-- in-run loadout rules');
  const service = new LoadoutService({ store: new MemoryLoadoutStore() });
  const link = new LocalLoadouts(service);
  const game = new Game({ seed: 7, cards: null, loadouts: link, dayLength: 999, nightLength: 999, godMode: true });
  game.code = 'LOAD';
  const pid = randomUUID();
  const owner = `g:${createHash('sha256').update(pid).digest('hex')}`;
  await service.grant(owner, 1, {}, 'carbine');
  const coll = await service.collection(owner);
  await service.equip(owner, [coll.items[0].id, null, null]);
  const p = join(game, 'Tester', pid);
  await settle();
  check('equipped loadout item spawns into the run with a marker', p.state.weapons[0] === ITEM.M4A1 && !!p.loadoutWeapons[0]);
  const carbineEffect = loadoutCombatEffect(p, ITEM.M4A1, AMMO.R556);
  check('signature weapon effect is active only for the marked equipped copy', carbineEffect.damage > 1 && loadoutCombatEffect(p, ITEM.PISTOL, AMMO.P9).damage === 1, JSON.stringify(carbineEffect));
  action(game, p, ACT.DROP_WEAPON, (w) => w.u8(0));
  check('loadout weapon cannot be dropped by action', p.state.weapons[0] === ITEM.M4A1 && game.items.every((it) => it.item !== ITEM.M4A1));
  action(game, p, ACT.SALVAGE, (w) => {
    w.u8(SALVAGE_FROM.WEAPON + 0);
    w.u16(1);
  });
  check('loadout weapon cannot be salvaged', p.state.weapons[0] === ITEM.M4A1);
  game.dropAll(p);
  check('loadout weapon does not drop on death/wipe inventory spill', game.items.every((it) => it.item !== ITEM.M4A1));

  clearLoadoutRun(p);
  const armorPid = randomUUID();
  const armorOwner = `g:${createHash('sha256').update(armorPid).digest('hex')}`;
  await service.grant(armorOwner, 2, {}, 'armor');
  const acoll = await service.collection(armorOwner);
  await service.equip(armorOwner, [acoll.items[0].id, null, null]);
  const q = join(game, 'Armor', armorPid);
  await settle();
  action(game, q, ACT.WORN, (w) => {
    w.u8(WORN.ARMOR);
    w.u8(WORN_DO.DROP);
  });
  check('loadout armor cannot be dropped while worn', q.armorItem !== 0 && game.items.every((it) => it.item !== q.armorItem));

  const ammoPid = randomUUID();
  const ammoOwner = `g:${createHash('sha256').update(ammoPid).digest('hex')}`;
  await service.grant(ammoOwner, 46, {}, 'ammo');
  const mcoll = await service.collection(ammoOwner);
  await service.equip(ammoOwner, [mcoll.items[0].id, null, null]);
  const m = join(game, 'Ammo', ammoPid);
  await settle();
  const ammoEffect = loadoutCombatEffect(m, ITEM.PISTOL, AMMO.P9);
  check('special ammo effect applies by caliber in-run', ammoEffect.damage > 1 && ammoEffect.headshot > 1, JSON.stringify(ammoEffect));

  const kitPid = randomUUID();
  const kitOwner = `g:${createHash('sha256').update(kitPid).digest('hex')}`;
  await service.grant(kitOwner, 58, {}, 'kit');
  const kcoll = await service.collection(kitOwner);
  await service.equip(kitOwner, [kcoll.items[0].id, null, null]);
  const k = join(game, 'Kit', kitPid);
  await settle();
  check('starter kit grants multiple run-start items', k.inv.some((it) => it?.item === ITEM.BANDAGE && it.count === 2) && k.inv.some((it) => it?.item === ITEM.MEDKIT));

  const killPid = randomUUID();
  const killOwner = `g:${createHash('sha256').update(killPid).digest('hex')}`;
  await service.grant(killOwner, 34, {}, 'kill');
  const ocoll = await service.collection(killOwner);
  await service.equip(killOwner, [ocoll.items[0].id, null, null]);
  const o = join(game, 'Trigger', killPid);
  await settle();
  o.state.stamina = 10;
  game.loadouts.onKill(o);
  const afterFirst = o.state.stamina;
  game.loadouts.onKill(o);
  check('once-per-night loadout trigger fires only once', afterFirst === 18 && o.state.stamina === afterFirst, `${afterFirst} -> ${o.state.stamina}`);
  game.loadouts.resetNight(o);
  game.loadouts.onKill(o);
  check('once-per-night trigger resets with the night', o.state.stamina === 26, `${o.state.stamina}`);
}

catalogRules();
await persistence();
await inRunRules();

if (fails.length) {
  console.error(`\n${fails.length} loadout test(s) failed: ${fails.join(', ')}`);
  process.exit(1);
}
console.log('\nloadout tests passed');

