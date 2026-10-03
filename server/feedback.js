// What players think of the game, asked of them as a run ends (migrations/004): how hard it was, on the end screen
// (client/ui/menus.js EndScreen). A vote is filed against the match the voter has just finished - found here from
// who they are, by their account or their browser's guest key, so the client never has to know a match's id - and
// one vote per player per match: voting again changes it. What comes back is how everyone has voted, for the bars.
//
// Only a match that ended as runs end on an end screen (victory or wipe) a few minutes ago, with the voter still in
// it at its end, takes a vote: anything else is a 404, so a vote cannot be cast for a run nobody saw end.
import { HttpError } from './http.js';

export const RATINGS = 5; // 1 too easy, 2 easy, 3 just right, 4 hard, 5 too hard
const RECENT_MIN = 10; // minutes after its end a match still takes votes

export class Feedback {
  // matches: the MatchStore, whose queued records (the match's end, its stints) are written before a vote looks
  constructor({ db, matches = null, log = () => {} }) {
    this.db = db;
    this.matches = matches;
    this.log = log;
  }

  // who: { userId } signed in, or { guestKey } (stats.js idKey of the browser's id). rating: 1..5
  // -> { mine, counts: [n for 1..5], total }
  async voteDifficulty(who, rating) {
    rating = Number(rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > RATINGS) throw new HttpError(400, 'Pick one of the answers.');
    const userId = who?.userId || null;
    const guestKey = userId ? null : who?.guestKey || null;
    if (!userId && !guestKey) throw new HttpError(400, 'Nobody to count the vote for.');
    const voter = userId ? `u:${userId}` : `g:${guestKey}`;
    // (the run's end and its stints go out of the game a moment before its end screen comes up: written first)
    if (this.matches) {
      await this.matches.flush();
      await this.matches.flush();
    }
    const found = await this.db.query(
      `SELECT m.id, m.outcome, m.last_day, m.nights_survived, m.peak_players, m.build,
              (array_agg(p.outcome ORDER BY p.joined_at DESC))[1] AS my_outcome,
              sum(p.seconds)::real AS my_seconds, sum(p.kills)::int AS my_kills, sum(p.deaths)::int AS my_deaths, sum(p.downs)::int AS my_downs
         FROM match_players p JOIN matches m ON m.id = p.match_id
        WHERE (p.user_id = $1::uuid OR p.guest_key = $2::text)
          AND m.outcome IN ('victory', 'wipe') AND m.ended_at > now() - make_interval(mins => $3)
        GROUP BY m.id
       HAVING bool_or(p.left_reason = 'match_end')
        ORDER BY m.ended_at DESC, m.started_at DESC
        LIMIT 1`,
      [userId, guestKey, RECENT_MIN]
    );
    const m = found.rows[0];
    if (!m) throw new HttpError(404, 'There is no run of yours that just ended to vote on.');
    const played = await this.db.query('SELECT count(DISTINCT match_id)::int AS n FROM match_players WHERE user_id = $1::uuid OR guest_key = $2::text', [userId, guestKey]);
    await this.db.query(
      `INSERT INTO difficulty_votes (match_id, voter, rating, outcome, last_day, nights_survived, players, build,
                                     my_outcome, my_seconds, my_kills, my_deaths, my_downs, my_matches)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (match_id, voter) DO UPDATE SET rating = EXCLUDED.rating, updated_at = now()`,
      [m.id, voter, rating, m.outcome, m.last_day, m.nights_survived, m.peak_players, m.build, m.my_outcome, m.my_seconds, m.my_kills, m.my_deaths, m.my_downs, played.rows[0]?.n || 1]
    );
    return { mine: rating, ...(await this.difficultyResults()) };
  }

  // how everyone has voted: { counts: [n for 1..5], total }
  async difficultyResults() {
    const r = await this.db.query('SELECT rating, count(*)::int AS n FROM difficulty_votes GROUP BY rating');
    const counts = new Array(RATINGS).fill(0);
    for (const row of r.rows) if (row.rating >= 1 && row.rating <= RATINGS) counts[row.rating - 1] = row.n;
    return { counts, total: counts.reduce((a, b) => a + b, 0) };
  }
}
