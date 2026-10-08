// A signed-in player's own settings on their account (db/migrations/005_settings.sql), one row per kind of setting:
//   - their keybinds (kind 'binds': shared/binds.js, client/net/accountbinds.js). Each copy carries when the player last
//     changed it, by their browser's clock, and the newer one wins: a save older than what is kept is not written, and
//     the answer to every save is what is kept - so a browser that was behind learns it from its own save.
//   - their own survivors (kind 'customs': the character creator, shared/customs.js, client/net/accountcustoms.js).
//     Merged survivor by survivor instead (mergeCustoms: of each the copy changed last; a deletion stays): a save is
//     merged into what is kept, in one transaction, and the answer is the merged copy.
import { HttpError } from './http.js';
import { Allowance } from './allowance.js';
import { checkOverrides } from '../shared/binds.js';
import { checkCustoms, mergeCustoms } from '../shared/customs.js';

const DAY = 86400_000;

export class UserSettings {
  constructor({ db }) {
    this.db = db;
    this.saves = new Allowance(30, 2); // per account: 30 saves in a row, then one every 2 s (a client sends one per burst of changes)
    this.customSaves = new Allowance(30, 2); // (the same, for their survivors)
  }

  // -> { customs: { v: 2, list, gone } | null }
  async customs(userId) {
    const row = (await this.db.query(`SELECT data FROM user_settings WHERE user_id = $1 AND kind = 'customs'`, [userId])).rows[0];
    return { customs: row ? row.data : null };
  }

  // body: { customs: { v: 2, list, gone } } -> what is kept afterwards: it merged with what was there
  async saveCustoms(userId, body) {
    const checked = checkCustoms(body?.customs);
    if (!checked.ok) throw new HttpError(400, `Those survivors can't be kept: ${checked.error}.`);
    if (!this.customSaves.take(userId)) throw new HttpError(429, 'Saving survivors too often. Try again in a moment.');
    return this.db.tx(async (t) => {
      const row = (await t.query(`SELECT data FROM user_settings WHERE user_id = $1 AND kind = 'customs' FOR UPDATE`, [userId])).rows[0];
      const merged = mergeCustoms(row ? row.data : null, checked.customs);
      await t.query(
        `INSERT INTO user_settings (user_id, kind, data, updated_at) VALUES ($1, 'customs', $2::jsonb, now())
         ON CONFLICT (user_id, kind) DO UPDATE SET data = excluded.data, updated_at = now(), saved_at = now()`,
        [userId, JSON.stringify(merged)],
      );
      return { customs: merged };
    });
  }

  // -> { binds: overrides | null, updatedAt: ms (0: never saved) }
  async binds(userId) {
    const row = (await this.db.query(`SELECT data, round(extract(epoch FROM updated_at) * 1000)::float8 AS at FROM user_settings WHERE user_id = $1 AND kind = 'binds'`, [userId])).rows[0];
    return row ? { binds: row.data, updatedAt: row.at } : { binds: null, updatedAt: 0 };
  }

  // body: { binds: overrides, updatedAt: ms } -> what is kept afterwards (theirs, or a newer one already there)
  async saveBinds(userId, body) {
    const checked = checkOverrides(body?.binds);
    if (!checked.ok) throw new HttpError(400, `Those keybinds can't be kept: ${checked.error}.`);
    const at = Number(body.updatedAt);
    if (!Number.isFinite(at) || at <= 0) throw new HttpError(400, 'updatedAt: when they were changed, in ms.');
    if (!this.saves.take(userId)) throw new HttpError(429, 'Saving keybinds too often. Try again in a moment.');
    // (a browser whose clock runs days ahead can't make its copy win for ever after)
    const when = Math.min(Math.round(at), Date.now() + DAY);
    await this.db.query(
      `INSERT INTO user_settings (user_id, kind, data, updated_at) VALUES ($1, 'binds', $2::jsonb, to_timestamp($3::float8 / 1000))
       ON CONFLICT (user_id, kind) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, saved_at = now()
         WHERE user_settings.updated_at <= excluded.updated_at`,
      [userId, JSON.stringify(checked.binds), when],
    );
    return this.binds(userId);
  }
}
