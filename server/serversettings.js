// Settings of the whole game that live in the database (db/migrations/012_server_settings.sql), so they change
// without a deploy: every server and the proxy read them every REFRESH_MS. Without a database there are none and
// every setting is its default.
//
//   max_total_games  the most games at once over every server (null: no total, only each server's own MAX_GAMES)
//
// Set them with `npm run setting -- <key> <value>` (scripts/setting.js), or in SQL:
//   INSERT INTO server_settings (key, value) VALUES ('max_total_games', '50')
//     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
const REFRESH_MS = 5000;

// key -> what a stored value means: the value, or undefined for one that is not valid (then the default holds)
export const SETTINGS = {
  max_total_games: { default: null, parse: (v) => (Number.isInteger(v) && v >= 0 ? v : undefined), about: 'the most games at once over every server (a whole number; unset: each server only has its own MAX_GAMES)' },
};

export class ServerSettings {
  constructor({ db, log = () => {} }) {
    this.db = db;
    this.log = log;
    this.values = Object.fromEntries(Object.entries(SETTINGS).map(([k, s]) => [k, s.default]));
    this.timer = null;
  }

  get maxTotalGames() {
    return this.values.max_total_games;
  }

  async start() {
    await this.refresh().catch((err) => this.log(`settings: not read (${err.message}): the defaults hold`));
    this.timer = setInterval(() => this.refresh().catch(() => {}), REFRESH_MS);
    this.timer.unref();
  }
  stop() {
    clearInterval(this.timer);
  }

  async refresh() {
    const r = await this.db.query('SELECT key, value FROM server_settings');
    const stored = new Map(r.rows.map((row) => [row.key, row.value]));
    for (const [key, s] of Object.entries(SETTINGS)) {
      const v = stored.has(key) ? s.parse(stored.get(key)) : s.default;
      if (v === undefined) continue; // (not a valid value: the one before holds)
      if (v !== this.values[key]) this.log(`settings: ${key} ${v === null ? 'unset' : `= ${v}`}`);
      this.values[key] = v;
    }
  }
}
