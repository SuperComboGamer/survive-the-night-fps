// Rate allowances: so many of something in a row, then one every so often. Per key (an address, an account).
// The same rule as the lobby's (rooms.js allow): n is how much was used lately, wearing off by one every `every`
// seconds.
export class Allowance {
  constructor(burst, every) {
    this.burst = burst;
    this.every = every;
    this.map = new Map();
    this.sweepT = 0;
  }
  _get(key, now) {
    let a = this.map.get(key);
    if (!a) this.map.set(key, (a = { n: 0, t: now }));
    a.n = Math.max(0, a.n - (now - a.t) / this.every);
    a.t = now;
    return a;
  }
  // uses one, if there is one to use
  take(key) {
    const now = Date.now() / 1000;
    this.sweep(now);
    const a = this._get(key, now);
    if (a.n + 1 > this.burst) return false;
    a.n++;
    return true;
  }
  // is there one left (without using it)?
  has(key) {
    const a = this.map.get(key);
    if (!a) return true;
    return Math.max(0, a.n - (Date.now() / 1000 - a.t) / this.every) + 1 <= this.burst;
  }
  // gives one back (a login that worked does not count against the account)
  clear(key) {
    this.map.delete(key);
  }
  // forgets the keys whose use has worn off, now and then
  sweep(now = Date.now() / 1000) {
    if (now - this.sweepT < 60) return;
    this.sweepT = now;
    for (const [k, a] of this.map) if (now - a.t >= a.n * this.every) this.map.delete(k);
  }
}
