// Accounts' bestiaries, kept in Postgres (db/migrations/010_bestiary.sql; the book is shared/bestiary.js): which
// kinds of the dead each account has seen. The network thread's. An account's record is read once as it comes into a
// game (load, from Room.record) and the game holds it from then on; what the game says the account saw for the first
// time (Room 'seen') is written within SOON_MS, a row per kind, and a kind already there stays as it was (ON CONFLICT
// DO NOTHING). A write that fails is put back and tried again RETRY_MS later. A guest's bestiary is their browser's.
import { BESTIARY, bit, cleanSeen } from '../shared/bestiary.js';

const SOON_MS = 150;
const RETRY_MS = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const userId = (v) => {
  const id = String(v || '').toLowerCase();
  return UUID.test(id) ? id : '';
};

export class BestiaryStore {
  constructor({ db, log = () => {} }) {
    this.db = db;
    this.log = log;
    this.q = new Map(); // account id -> the kinds it saw that are not written yet (a mask)
    this.flushing = null;
    this.timer = null;
  }

  // The kinds this account has seen -> Promise of a mask (what is still to be written included)
  async load(user) {
    const id = userId(user);
    if (!id) return 0;
    await this.flushing;
    const r = await this.db.query('SELECT ztype FROM user_bestiary WHERE user_id = $1', [id]);
    let mask = this.q.get(id) || 0;
    for (const row of r.rows) if (row.ztype >= 0 && row.ztype < 31) mask |= bit(row.ztype);
    return cleanSeen(mask);
  }

  // The account saw these kinds for the first time (a mask)
  add(user, mask) {
    const id = userId(user);
    mask = cleanSeen(mask);
    if (!id || !mask) return;
    this.q.set(id, (this.q.get(id) || 0) | mask);
    this.soon(SOON_MS);
  }

  soon(ms) {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch(() => {});
    }, ms);
    this.timer.unref?.();
  }

  async flush() {
    if (this.flushing) return this.flushing;
    if (!this.q.size) return;
    const batch = this.q;
    this.q = new Map();
    const rows = [];
    for (const [user_id, mask] of batch) for (const e of BESTIARY) if (mask & bit(e.t)) rows.push({ user_id, ztype: e.t });
    let failed = false;
    // (an account deleted meanwhile is left out: its row would fail the batch, and the batch again, for good)
    this.flushing = this.db
      .query(
        `INSERT INTO user_bestiary (user_id, ztype)
           SELECT x.user_id, x.ztype FROM jsonb_to_recordset($1::jsonb) AS x(user_id uuid, ztype smallint)
           JOIN users u ON u.id = x.user_id
         ON CONFLICT DO NOTHING`,
        [JSON.stringify(rows)]
      )
      .then(
        () => {},
        (err) => {
          failed = true;
          this.log(`bestiary: could not write ${batch.size} account(s) (${err.message}); trying again`);
          for (const [user, mask] of batch) this.q.set(user, (this.q.get(user) || 0) | mask);
        }
      )
      .finally(() => {
        this.flushing = null;
        if (this.q.size) this.soon(failed ? RETRY_MS : SOON_MS);
      });
    return this.flushing;
  }

  async close() {
    clearTimeout(this.timer);
    this.timer = null;
    await this.flushing;
    await this.flush();
  }
}
