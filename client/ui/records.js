// The player's own record: the last runs they finished and their bests over every run, kept in this browser's
// localStorage and nowhere else - nothing in here is sent to the server. The end screen and the splash show it,
// the settings panel clears it. Game.trackRun (game/game.js) decides which runs count.
//
// Stored as JSON under 'stn.runs':
//   { v: 1,
//     runs:  [{ t, seed, result, nights, secs, kills, team }, ...],  the last RUNS_KEPT runs, oldest first
//     total: { runs, escapes, streak },                              over every run recorded (streak: escapes in a row, now)
//     best:  { secs, nights, kills, streak } }                       secs: the fastest escape, 0 until there is one
//   t       when the run ended (ms since 1970)        seed   the valley it was played in
//   result  'escaped' | 'wiped' (the team's outcome)  nights nights survived (the day it ended on, minus one)
//   secs    how long the run lasted                   kills  this player's own, this run
//   team    players connected when it ended
import { fmtTime } from './dom.js';

const KEY = 'stn.runs';
const RUNS_KEPT = 20;

// a whole number in 0..max out of anything at all (NaN, a string, a negative, undefined: 0)
const whole = (v, max) => (typeof v === 'number' && v > 0 ? Math.min(Math.floor(v), max) : 0);
const some = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function cleanRun(r) {
  if (!r || typeof r !== 'object' || (r.result !== 'escaped' && r.result !== 'wiped')) return null;
  return { t: whole(r.t, 1e14), seed: whole(r.seed, 0xffffffff), result: r.result, nights: whole(r.nights, 255), secs: whole(r.secs, 1e7), kills: whole(r.kills, 65535), team: whole(r.team, 255) };
}

// A record of the right shape out of whatever was stored: the stored value is never trusted (hand-edited,
// cut short, written by some other version), and one that is no use at all reads as an empty record.
export function sanitizeRecord(raw) {
  const o = raw && typeof raw === 'object' && raw.v === 1 ? raw : {};
  const runs = (Array.isArray(o.runs) ? o.runs : []).map(cleanRun).filter(Boolean).slice(-RUNS_KEPT);
  const t = o.total && typeof o.total === 'object' ? o.total : {};
  const b = o.best && typeof o.best === 'object' ? o.best : {};
  const total = { runs: Math.max(whole(t.runs, 1e6), runs.length), escapes: 0, streak: 0 };
  total.escapes = Math.min(whole(t.escapes, 1e6), total.runs);
  total.streak = Math.min(whole(t.streak, 1e6), total.escapes);
  const best = { secs: total.escapes ? whole(b.secs, 1e7) : 0, nights: whole(b.nights, 255), kills: whole(b.kills, 65535), streak: Math.min(Math.max(whole(b.streak, 1e6), total.streak), total.escapes) };
  return { v: 1, runs, total, best };
}

// the record storage would not take (private mode, blocked, full): it then lasts as long as the page does
let unsaved = null;

export function loadRecord() {
  if (unsaved) return unsaved;
  try {
    return sanitizeRecord(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    return sanitizeRecord(null); // no storage, or something in it that is not JSON
  }
}

function saveRecord(rec) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rec));
    unsaved = null;
  } catch {
    unsaved = rec;
  }
}

export function clearRecord() {
  unsaved = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

// Pure: the record after `run`, and the bests that run set (`news`, in the order the end screen lists them).
export function applyRun(rec, run) {
  const { total: t, best: b } = rec;
  const won = run.result === 'escaped';
  const streak = won ? t.streak + 1 : 0;
  const best = {
    secs: won && (!b.secs || run.secs < b.secs) ? run.secs : b.secs,
    nights: Math.max(b.nights, run.nights),
    kills: Math.max(b.kills, run.kills),
    streak: Math.max(b.streak, streak),
  };
  const news = [];
  if (won && !b.secs) news.push({ k: 'secs', label: 'First escape', text: fmtTime(run.secs) });
  else if (best.secs !== b.secs) news.push({ k: 'secs', label: 'New best', text: 'escaped in ' + fmtTime(run.secs), was: fmtTime(b.secs) });
  // a first run has nothing to beat: its figures simply become the bests
  if (t.runs) {
    if (best.nights > b.nights) news.push({ k: 'nights', label: 'New best', text: some(run.nights, 'night') + ' survived', was: String(b.nights) });
    if (best.kills > b.kills) news.push({ k: 'kills', label: 'New best', text: some(run.kills, 'kill'), was: String(b.kills) });
    if (best.streak > b.streak && streak > 1) news.push({ k: 'streak', label: 'New best', text: streak + ' escapes in a row', was: String(b.streak) });
  }
  return { run, news, record: { v: 1, runs: [...rec.runs, run].slice(-RUNS_KEPT), total: { runs: t.runs + 1, escapes: t.escapes + (won ? 1 : 0), streak }, best } };
}

// A run just ended: put it on the record. Returns applyRun's report for the end screen.
export function recordRun(run) {
  const r = cleanRun(run);
  if (!r) return null;
  const rep = applyRun(loadRecord(), r);
  saveRecord(rep.record);
  return rep;
}

// The record in a few words for the splash; empty for a player with no run on it.
export function recordSummary(rec) {
  const { total: t, best: b } = rec;
  if (!t.runs) return [];
  const out = [some(t.runs, 'run'), t.escapes ? some(t.escapes, 'escape') : 'no escape yet'];
  if (b.secs) out.push('fastest escape ' + fmtTime(b.secs));
  out.push('most nights ' + b.nights);
  return out;
}
