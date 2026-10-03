// What the player thinks of the game, sent to the server as a run ends (server/feedback.js): how hard it was, voted
// on the end screen (ui/menus.js EndScreen). The server files the vote against the run this player has just finished,
// by their account or, for a guest, this browser's id (identity.js), as a JOIN does.
import { playerId } from './identity.js';
import { post } from './lobby.js';

// rating 1 too easy .. 5 too hard -> { mine, counts: [votes for each answer], total }: everyone's, this vote counted.
// Rejects with the server's own words (a 404 when there is no run of ours that just ended)
export const voteDifficulty = (rating) => post('/api/feedback/difficulty', { rating, guestId: playerId() }, 6000);
