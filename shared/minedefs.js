// Zombies-mode numbers and wire ids shared by the server (server/mine.js) and the client.
import { BOX_POOL } from './mine.js';
import { ITEM } from './defs.js';

// ENT.CACHE ctype ranges (survival's containers are 1..11)
export const MINE_CT = { BOX: 0, GUN: 0, PERK: 0, BUY: 32, GATE: 64 }; // BUY + index of the stop's buy, GATE + index of its gate
export const isMineCt = (c) => c >= MINE_CT.BUY;

export const MINE = {
  STATE: { PREP: 0, ROUND: 1, CLEAR: 2, RIDE: 3 },
  ELEV: { AWAY: 0, ARRIVING: 1, OPEN: 2, CLOSING: 3, RIDING: 4, OPENING: 5 },
  START_POINTS: 500,
  FIRST_PREP: 14, // seconds before the first round
  PREP: 9, // between arriving and the round starting
  BOARD_TIME: 40, // the cage waits this long (counting from its arrival) for the team
  BOARD_GRACE: 14, // ...and this long after the first one is in
  ARRIVE_TIME: 3.2,
  GATE_TIME: 1.7,
  RIDE_MIN: 6,
  RIDE_MAX: 13,
  POWER: { MAX_AMMO: 0, INSTA_KILL: 1, DOUBLE_POINTS: 2, KABOOM: 3 },
  POWER_CT: 100, // ENT.CACHE ctype of a power-up lying about: POWER_CT + kind
  POWER_LIFE: 30,
  POWER_TIME: 30,
  BOX_ROLL: 3.6,
  BOX_HOLD: 12,
};

// the old game's round table (the quota of the dead per round, one survivor), and its health curve
const ROUND_QUOTA = [6, 8, 13, 18, 24, 27, 28, 28, 29, 33, 34, 36, 39, 41, 44, 47, 49, 52, 54, 56];
export const roundQuota = (r) => (r <= 20 ? ROUND_QUOTA[r - 1] : Math.min(90, Math.round(56 + (r - 20) * 3.4)));
export const roundHealth = (r) => (r < 10 ? 150 + 100 * (r - 1) : Math.round(950 * Math.pow(1.1, r - 9)));

export function boxItem(r) {
  return BOX_POOL[Math.min(BOX_POOL.length - 1, Math.floor(r * BOX_POOL.length))];
}
export { ITEM };
