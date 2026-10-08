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
import { PHASE } from '../shared/constants.js';
import { LOADOUT_CATALOG, LOADOUT_RARITY, LOADOUT_SLOTS, loadoutDef, loadoutEffects, loadoutMods } from '../shared/loadout.js';
import { F, defaultDeck } from '../shared/cards.js';

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

  const tstore = new MemoryLoadoutStore();
  const ta = guest();
  const tb = guest();
  const first = await tstore.grant({ id: 'trade:grant', owner: ta, catalog: 1 });
  await tstore.saveSlots(ta, [first.granted.id, null, null]);
  const move = [[ta, tb, first.granted.id]];
  await tstore.transfer({ id: `${randomUUID()}:loadout_trade`, kind: 'trade', moves: move });
  const once = await tstore.load(tb);
  await tstore.transfer({ id: `${randomUUID()}:loadout_trade`, kind: 'trade', moves: [[tb, ta, first.granted.id]] });
  const back = await tstore.load(ta);
  const id = `${randomUUID()}:loadout_trade`;
  await tstore.transfer({ id, kind: 'trade', moves: [[ta, tb, first.granted.id]] });
  await tstore.transfer({ id, kind: 'trade', moves: [[ta, tb, first.granted.id]] });
  check('loadout transfer moves one instance and unequips it once', once.items.length === 1 && back.items.length === 1 && (await tstore.load(ta)).items.length === 0 && (await tstore.load(tb)).items.length === 1 && !(await tstore.load(ta)).slots.some(Boolean));

  const wstore = new MemoryLoadoutStore();
  const wa = guest();
  const wb = guest();
  const wi = (await wstore.grant({ id: 'wager:grant:a', owner: wa, catalog: 1 })).granted;
  const wj = (await wstore.grant({ id: 'wager:grant:b', owner: wb, catalog: 2 })).granted;
  await wstore.saveSlots(wa, [wi.id, null, null]);
  await wstore.lockWager({ id: `${randomUUID()}:loadout_wager_lock`, room: 'cards', match: 'match-a', stakes: [{ owner: wa, items: [wi.id] }] });
  check('wager lock hides an item from collection and slots', !(await wstore.load(wa)).items.some((it) => it.id === wi.id) && !(await wstore.load(wa)).slots.some(Boolean));
  let blocked = false;
  try {
    await wstore.transfer({ id: `${randomUUID()}:loadout_trade`, kind: 'trade', moves: [[wa, wb, wi.id]] });
  } catch {
    blocked = true;
  }
  check('wager lock blocks trading the same loadout item', blocked);
  blocked = false;
  try {
    await wstore.lockWager({ id: `${randomUUID()}:loadout_wager_lock`, room: 'cards', match: 'match-b', stakes: [{ owner: wa, items: [wi.id] }] });
  } catch {
    blocked = true;
  }
  check('wager lock blocks a second table using the same item', blocked);
  await wstore.settleWager({ id: `${randomUUID()}:loadout_wager_back`, kind: 'wager_back', match: 'match-a', moves: [[wa, wa, wi.id]] });
  check('wager refund returns the locked item to its owner and slot', (await wstore.load(wa)).items.some((it) => it.id === wi.id) && (await wstore.load(wa)).slots[0] === wi.id);
  await wstore.lockWager({ id: `${randomUUID()}:loadout_wager_lock`, room: 'gone-room', match: 'match-release', stakes: [{ owner: wa, items: [wi.id] }] });
  await wstore.releaseRoom('gone-room');
  check('room release refunds held wager locks', wstore.wagerLocks.size === 0 && (await wstore.load(wa)).items.some((it) => it.id === wi.id));
  await wstore.lockWager({ id: `${randomUUID()}:loadout_wager_lock`, room: 'orphan-room', match: 'match-orphan', stakes: [{ owner: wa, items: [wi.id] }] });
  wstore.wagerLocks.get(wi.id).at = Date.now() - 25 * 3600_000;
  await wstore.sweepWagers(24 * 3600);
  check('orphan sweep refunds old wager locks', wstore.wagerLocks.size === 0 && (await wstore.load(wa)).items.some((it) => it.id === wi.id));
  await wstore.lockTradeItems({ room: 'trade-room', trade: '1', owner: wa, items: [wi.id] });
  blocked = false;
  try {
    await wstore.lockWager({ id: `${randomUUID()}:loadout_wager_lock`, room: 'cards', match: 'match-trade-lock', stakes: [{ owner: wa, items: [wi.id] }] });
  } catch {
    blocked = true;
  }
  check('store blocks wagering an item in an active loadout trade', blocked);
  await wstore.releaseTrade({ room: 'trade-room', trade: '1' });
  await wstore.lockWager({ id: `${randomUUID()}:loadout_wager_lock`, room: 'cards', match: 'match-c', stakes: [{ owner: wa, items: [wi.id] }, { owner: wb, items: [wj.id] }] });
  const payId = `${randomUUID()}:loadout_wager_pay`;
  await wstore.settleWager({ id: payId, kind: 'wager_pay', match: 'match-c', moves: [[wa, wb, wi.id], [wb, wb, wj.id]] });
  await wstore.settleWager({ id: payId, kind: 'wager_pay', match: 'match-c', moves: [[wa, wb, wi.id], [wb, wb, wj.id]] });
  check('wager payout transfers once and unequips the loser', !(await wstore.load(wa)).items.length && (await wstore.load(wb)).items.some((it) => it.id === wi.id) && !(await wstore.load(wa)).slots.some(Boolean));
  const acctOwner = `a:${randomUUID()}`;
  wstore.accounts = new Set([acctOwner.slice(2)]);
  const listed = (await wstore.grant({ id: 'wager:listed', owner: acctOwner, catalog: 3 })).granted;
  await wstore.listItem(acctOwner, listed.id, 10);
  blocked = false;
  try {
    await wstore.lockWager({ id: `${randomUUID()}:loadout_wager_lock`, room: 'cards', match: 'match-listed', stakes: [{ owner: acctOwner, items: [listed.id] }] });
  } catch {
    blocked = true;
  }
  check('active auction listing cannot be wagered', blocked);
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

async function inRunTrade() {
  console.log('\n-- in-run loadout trading');
  const service = new LoadoutService({ store: new MemoryLoadoutStore() });
  const link = new LocalLoadouts(service);
  const game = new Game({ seed: 8, loadouts: link, dayLength: 999, nightLength: 999, godMode: true });
  game.code = 'TRAD';
  game.phase = PHASE.DAY;
  const aPid = randomUUID();
  const bPid = randomUUID();
  const aOwner = `g:${createHash('sha256').update(aPid).digest('hex')}`;
  const bOwner = `g:${createHash('sha256').update(bPid).digest('hex')}`;
  await service.grant(aOwner, 1, {}, 'trade:carbine');
  await service.grant(bOwner, 2, {}, 'trade:kevlar');
  const aItem = (await service.collection(aOwner)).items[0];
  const bItem = (await service.collection(bOwner)).items[0];
  await service.equip(aOwner, [aItem.id, null, null]);
  const a = join(game, 'Giver', aPid);
  const b = join(game, 'Friend', bPid);
  b.state.x = a.state.x;
  b.state.y = a.state.y;
  b.state.z = a.state.z;
  await settle();
  game.cards.openTrade(a, b);
  let t = game.cards.tradeOf(a.id);
  game.cards.offer(a, { loadouts: [aItem.id, aItem.id] });
  check('duplicate loadout instance cannot be offered twice', t.sides[0].offer.loadouts.length === 0);
  game.cards.offer(a, { loadouts: [aItem.id] });
  game.cards.offer(b, { loadouts: [bItem.id] });
  game.cards.ready(a, { on: true });
  game.cards.ready(b, { on: true });
  game.cards.confirm(a);
  game.cards.confirm(b);
  await settle();
  const ac = await service.collection(aOwner);
  const bc = await service.collection(bOwner);
  check('confirmed loadout trade swaps owned instances', ac.items.some((it) => it.id === bItem.id) && !ac.items.some((it) => it.id === aItem.id) && bc.items.some((it) => it.id === aItem.id));
  check('traded equipped loadout is removed from giver run without dropping', a.state.weapons[0] === 0 && !a.loadoutWeapons[0] && game.items.every((it) => it.item !== ITEM.M4A1));

  await service.grant(aOwner, 3, {}, 'trade:medal');
  await settle();
  const gift = (await service.collection(aOwner)).items.find((it) => it.catalog === 3);
  game.cards.openTrade(a, b);
  t = game.cards.tradeOf(a.id);
  game.cards.offer(a, { loadouts: [gift.id] });
  game.cards.ready(a, { on: true });
  game.cards.ready(b, { on: true });
  game.cards.confirm(a);
  game.cards.confirm(b);
  await settle();
  check('one-sided loadout gift is accepted by both-confirm trade', !(await service.collection(aOwner)).items.some((it) => it.id === gift.id) && (await service.collection(bOwner)).items.some((it) => it.id === gift.id));
}

async function handoffTradeReplay() {
  console.log('\n-- loadout trade handoff replay');
  const service = new LoadoutService({ store: new MemoryLoadoutStore() });
  const link1 = new LocalLoadouts(service);
  const game1 = new Game({ seed: 9, loadouts: link1, dayLength: 999, nightLength: 999, godMode: true });
  game1.code = 'HND1';
  game1.phase = PHASE.DAY;
  const aPid = randomUUID();
  const bPid = randomUUID();
  const aOwner = `g:${createHash('sha256').update(aPid).digest('hex')}`;
  const bOwner = `g:${createHash('sha256').update(bPid).digest('hex')}`;
  await service.grant(aOwner, 1, {}, 'handoff:item');
  const item = (await service.collection(aOwner)).items[0];
  const a1 = join(game1, 'A', aPid);
  const b1 = join(game1, 'B', bPid);
  Object.assign(b1.state, { x: a1.state.x, y: a1.state.y, z: a1.state.z });
  await settle();
  game1.cards.openTrade(a1, b1);
  game1.cards.offer(a1, { loadouts: [item.id] });
  game1.cards.ready(a1, { on: true });
  game1.cards.ready(b1, { on: true });
  game1.cards.confirm(a1);
  game1.cards.confirm(b1);
  const saved = game1.cards.save();
  check('pending loadout trade is saved for handoff', saved.pending.some((x) => x.kind === 'loadout_trade'));
  link1.gone(true);

  const link2 = new LocalLoadouts(service);
  const game2 = new Game({ seed: 9, loadouts: link2, dayLength: 999, nightLength: 999, godMode: true });
  game2.code = 'HND2';
  game2.phase = PHASE.DAY;
  const a2 = join(game2, 'A', aPid);
  const b2 = join(game2, 'B', bPid);
  Object.assign(b2.state, { x: a2.state.x, y: a2.state.y, z: a2.state.z });
  await settle();
  game2.cards.load(saved);
  await settle();
  check('replayed pending loadout trade applies exactly once', (await service.collection(aOwner)).items.length === 0 && (await service.collection(bOwner)).items.filter((it) => it.id === item.id).length === 1);
}

async function handoffWagerReplay() {
  console.log('\n-- loadout wager handoff replay');
  const service = new LoadoutService({ store: new MemoryLoadoutStore() });
  const link1 = new LocalLoadouts(service);
  const game1 = new Game({ seed: 10, loadouts: link1, dayLength: 999, nightLength: 999, godMode: true });
  game1.code = 'WGR1';
  game1.phase = PHASE.DAY;
  const aPid = randomUUID();
  const bPid = randomUUID();
  const aOwner = `g:${createHash('sha256').update(aPid).digest('hex')}`;
  const bOwner = `g:${createHash('sha256').update(bPid).digest('hex')}`;
  await service.grant(aOwner, 1, {}, 'wager:a');
  await service.grant(bOwner, 2, {}, 'wager:b');
  const aItem = (await service.collection(aOwner)).items[0];
  const bItem = (await service.collection(bOwner)).items[0];
  await service.equip(aOwner, [aItem.id, null, null]);
  const a1 = join(game1, 'A', aPid);
  const b1 = join(game1, 'B', bPid);
  await settle();
  game1.cards.startMatch([a1, b1], [defaultDeck(F.SURVIVORS), defaultDeck(F.DEAD)], [0, 0], [[aItem.id], [bItem.id]]);
  let m1 = game1.cards.matchOf(a1.id);
  game1.cards.stakeConfirm(a1, { on: true });
  game1.cards.stakeConfirm(b1, { on: true });
  const saved = game1.cards.save();
  check('pending loadout wager lock is saved for handoff', saved.pending.some((x) => x.kind === 'loadout_wager_lock') && m1.phase === 'locking');
  link1.gone(true);

  const link2 = new LocalLoadouts(service);
  const game2 = new Game({ seed: 10, loadouts: link2, dayLength: 999, nightLength: 999, godMode: true });
  game2.code = 'WGR2';
  game2.phase = PHASE.DAY;
  const a2 = join(game2, 'A', aPid);
  const b2 = join(game2, 'B', bPid);
  await settle();
  game2.cards.load(saved);
  await settle();
  const m2 = game2.cards.matchOf(a2.id);
  check('replayed wager lock deals the match once after handoff', m2?.phase === 'live' && !(await service.collection(aOwner)).items.some((it) => it.id === aItem.id));
  game2.cards.forfeit(a2);
  await settle();
  check('forfeit pays wagered loadout items to the opponent', !(await service.collection(aOwner)).items.some((it) => it.id === aItem.id) && (await service.collection(bOwner)).items.some((it) => it.id === aItem.id) && a2.state.weapons[0] === 0);

  await service.grant(aOwner, 3, {}, 'wager:refund');
  const refund = (await service.collection(aOwner)).items[0];
  game2.cards.startMatch([a2, b2], [defaultDeck(F.SURVIVORS), defaultDeck(F.DEAD)], [0, 0], [[refund.id], []]);
  game2.cards.stakeConfirm(a2, { on: true });
  game2.cards.stakeConfirm(b2, { on: true });
  await settle();
  const rm = game2.cards.matchOf(a2.id);
  game2.cards.void(rm, 'run_over');
  await settle();
  check('server-side abort refunds wagered loadout items', (await service.collection(aOwner)).items.some((it) => it.id === refund.id));
}

async function leaveDuringWagerLock() {
  console.log('\n-- loadout wager leave during lock');
  class SlowLockStore extends MemoryLoadoutStore {
    async lockWager(args) {
      await new Promise((resolve) => (this.releaseLock = resolve));
      return super.lockWager(args);
    }
  }
  const store = new SlowLockStore();
  const service = new LoadoutService({ store });
  const link = new LocalLoadouts(service);
  const game = new Game({ seed: 11, loadouts: link, dayLength: 999, nightLength: 999, godMode: true });
  game.code = 'WGLK';
  game.phase = PHASE.DAY;
  const aPid = randomUUID();
  const bPid = randomUUID();
  const aOwner = `g:${createHash('sha256').update(aPid).digest('hex')}`;
  const bOwner = `g:${createHash('sha256').update(bPid).digest('hex')}`;
  await service.grant(aOwner, 1, {}, 'leave-lock:a');
  await service.grant(bOwner, 2, {}, 'leave-lock:b');
  const aItem = (await service.collection(aOwner)).items[0];
  const bItem = (await service.collection(bOwner)).items[0];
  const a = join(game, 'A', aPid);
  const b = join(game, 'B', bPid);
  await settle();
  game.cards.startMatch([a, b], [defaultDeck(F.SURVIVORS), defaultDeck(F.DEAD)], [0, 0], [[aItem.id], [bItem.id]]);
  game.cards.stakeConfirm(a, { on: true });
  game.cards.stakeConfirm(b, { on: true });
  await settle();
  game.cards.leave(a);
  store.releaseLock();
  await settle();
  check('in-run leave while wager lock is in flight refunds both items', store.wagerLocks.size === 0 && (await service.collection(aOwner)).items.some((it) => it.id === aItem.id) && (await service.collection(bOwner)).items.some((it) => it.id === bItem.id));
}

catalogRules();
await persistence();
await inRunRules();
await inRunTrade();
await handoffTradeReplay();
await handoffWagerReplay();
await leaveDuringWagerLock();

if (fails.length) {
  console.error(`\n${fails.length} loadout test(s) failed: ${fails.join(', ')}`);
  process.exit(1);
}
console.log('\nloadout tests passed');

