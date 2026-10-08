export const SKULLS = Object.freeze({
  NAME: 'Zombie Skulls',
  SHORT: 'Skulls',
  ICON: 'skull',
});

// First-pass endgame economy tuning. The hourly cap follows Dead Hand's pack cap pattern:
// normal play reaches it only by stacking several high-value events, while farm loops stop paying.
export const SKULL_EARN = Object.freeze({
  NIGHT_BASE: 10,
  NIGHT_STEP: 5,
  NIGHT_MAX: 35,
  BOSS_KILL: 25,
  ESCAPE_ABOARD: 75,
  ESCAPE_TEAM: 35,
  HOURLY_CAP: 300,
});

export const AUCTION = Object.freeze({
  FEE_RATE: 0.05,
  FEE_MIN: 1,
  PRICE_MIN: 1,
  PRICE_MAX: 100000,
  LISTING_DAYS: 3,
  PAGE_SIZE: 80,
});

export const auctionFee = (price) => Math.max(AUCTION.FEE_MIN, Math.ceil(Math.max(0, price | 0) * AUCTION.FEE_RATE));
export const sellerProceeds = (price) => Math.max(0, (price | 0) - auctionFee(price));
export const nightSkulls = (night) => Math.min(SKULL_EARN.NIGHT_MAX, SKULL_EARN.NIGHT_BASE + Math.max(0, (night | 0) - 1) * SKULL_EARN.NIGHT_STEP);
