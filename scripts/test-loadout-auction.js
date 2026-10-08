// Zombie Skulls and loadout auction house:
// - skull earning is idempotent and hourly capped
// - guests earn and merge into accounts, but cannot trade on the auction house
// - listed items are escrowed out of collection/equipment
// - buy, cancel, expiry, insufficient funds and double-buy races are atomic
import { createHash, randomUUID } from 'node:crypto';
import { LoadoutService, MemoryLoadoutStore } from '../server/userloadout.js';
import { auctionFee } from '../shared/economy.js';

const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : info}`);
  if (!ok) fails.push(name);
};
const acct = () => `a:${randomUUID()}`;
const guest = () => `g:${'a'.repeat(64)}`;
const errCode = async (fn) => {
  try {
    await fn();
    return '';
  } catch (err) {
    return err.code || err.message;
  }
};

async function earningAndMerge() {
  console.log('\n-- skull earning and guest merge');
  const store = new MemoryLoadoutStore();
  const svc = new LoadoutService({ store });
  const g = guest();
  const one = await svc.earnSkulls(g, 25, { kind: 'boss' }, 'earn:boss:one');
  const dup = await svc.earnSkulls(g, 25, { kind: 'boss' }, 'earn:boss:one');
  check('earn ledger id applies once', one.amount === 25 && dup.amount === 0 && (await svc.balance(g)) === 25);
  await svc.earnSkulls(g, 500, { kind: 'test' }, 'earn:cap');
  check('hourly earning cap limits grants', (await svc.balance(g)) === 300);
  const a = acct();
  const rawGuest = randomUUID();
  const realGuest = `g:${createHash('sha256').update(rawGuest).digest('hex')}`;
  await svc.earnSkulls(realGuest, 80, { kind: 'night' }, 'earn:guest-night');
  await svc.mergeGuest(a.slice(2), rawGuest);
  check('guest skulls move onto account', (await svc.balance(realGuest)) === 0 && (await svc.balance(a)) === 80);
}

async function escrowCancelAndExpiry() {
  console.log('\n-- auction escrow, cancel, expiry');
  const store = new MemoryLoadoutStore();
  const svc = new LoadoutService({ store });
  const seller = acct();
  const guestOwner = guest();
  await svc.grant(seller, 1, {}, 'item:one');
  const item = (await svc.collection(seller)).items[0];
  await svc.equip(seller, [item.id, null, null]);
  const listing = await svc.listItem(seller, item.id, 100);
  const afterList = await svc.collection(seller);
  check('listed item leaves collection and equipped slot', afterList.items.length === 0 && afterList.slots.every((x) => !x));
  check('guest cannot list items', (await errCode(() => svc.listItem(guestOwner, item.id, 10))) === 'guest_market');
  await svc.cancelListing(seller, listing.id);
  check('cancel returns item from escrow', (await svc.collection(seller)).items.some((it) => it.id === item.id));
  const relisted = await svc.listItem(seller, item.id, 90);
  store.listings.get(relisted.id).expiresAt = Date.now() - 1;
  await svc.auction(seller);
  check('expired listing returns item from escrow', (await svc.collection(seller)).items.some((it) => it.id === item.id) && store.listings.get(relisted.id).status === 'expired');
}

async function buyingAndRaces() {
  console.log('\n-- auction buying and races');
  const svc = new LoadoutService({ store: new MemoryLoadoutStore() });
  const seller = acct();
  const buyer = acct();
  const other = acct();
  await svc.grant(seller, 2, {}, 'item:armor');
  const item = (await svc.collection(seller)).items[0];
  const listing = await svc.listItem(seller, item.id, 100);
  check('insufficient funds blocks buy atomically', (await errCode(() => svc.buyListing(buyer, listing.id))) === 'insufficient_skulls' && (await svc.collection(seller)).items.length === 0);
  await svc.earnSkulls(buyer, 120, { kind: 'test' }, 'earn:buyer');
  await svc.earnSkulls(other, 120, { kind: 'test' }, 'earn:other');
  const res = await Promise.allSettled([svc.buyListing(buyer, listing.id), svc.buyListing(other, listing.id)]);
  const ok = res.filter((r) => r.status === 'fulfilled').length;
  const no = res.filter((r) => r.status === 'rejected').map((r) => r.reason.code);
  const fee = auctionFee(100);
  check('only one buyer wins a double-buy race', ok === 1 && no.length === 1 && no[0] === 'sold', JSON.stringify(res));
  const buyerHas = (await svc.collection(buyer)).items.some((it) => it.id === item.id);
  const otherHas = (await svc.collection(other)).items.some((it) => it.id === item.id);
  check('purchase moves item to the winning buyer only', buyerHas !== otherHas);
  check('purchase debits buyer and credits seller minus fee', (await svc.balance(seller)) === 100 - fee && ((await svc.balance(buyer)) === 20 || (await svc.balance(other)) === 20));
}

await earningAndMerge();
await escrowCancelAndExpiry();
await buyingAndRaces();

if (fails.length) {
  console.error(`\n${fails.length} auction test(s) failed: ${fails.join(', ')}`);
  process.exit(1);
}
console.log('\nloadout auction tests passed');
