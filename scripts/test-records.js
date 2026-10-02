// The personal record (client/ui/records.js) against a stand-in for localStorage: what a run does to the
// bests, that whatever is found in storage comes back as a well-formed record, and that nothing throws when
// storage is broken or not there at all.
import { sanitizeRecord, applyRun, recordRun, loadRecord, clearRecord, recordSummary } from '../client/ui/records.js';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${detail}`);
}

// ---- a stand-in for the browser's storage: working, refusing everything, or absent
const KEY = 'stn.runs';
let store = {};
const working = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => void (store[k] = String(v)),
  removeItem: (k) => void delete store[k],
};
const refuse = () => {
  throw new Error('storage is blocked');
};
const broken = { getItem: refuse, setItem: refuse, removeItem: refuse };
const setStorage = (s) => Object.defineProperty(globalThis, 'localStorage', { value: s, configurable: true, writable: true });

const run = (result, secs, nights, kills, team = 1) => ({ t: 1790000000000, seed: 4242, result, nights, secs, kills, team });
const wellFormed = (r) =>
  r.v === 1 &&
  Array.isArray(r.runs) &&
  r.runs.length <= 20 &&
  r.runs.every((x) => (x.result === 'escaped' || x.result === 'wiped') && [x.t, x.seed, x.nights, x.secs, x.kills, x.team].every((n) => Number.isInteger(n) && n >= 0)) &&
  [r.total.runs, r.total.escapes, r.total.streak, r.best.secs, r.best.nights, r.best.kills, r.best.streak].every((n) => Number.isInteger(n) && n >= 0) &&
  r.total.escapes <= r.total.runs &&
  r.total.streak <= r.total.escapes &&
  r.best.streak <= r.total.escapes;

// ---- whatever is stored comes back well formed
{
  const junk = [
    null,
    undefined,
    'x',
    42,
    [],
    { v: 2, runs: [run('escaped', 60, 1, 1)], total: { runs: 1, escapes: 1, streak: 1 } },
    { v: 1, runs: 'no', total: 7, best: [] },
    { v: 1, runs: [null, 3, { result: 'won' }, { result: 'escaped', secs: '12', kills: -4, nights: NaN, team: 1e99, t: {}, seed: -1 }], total: { runs: -1, escapes: 50, streak: 1e99 }, best: { secs: Infinity, nights: 2.7, kills: '9', streak: 400 } },
    { v: 1, runs: Array.from({ length: 45 }, (_, i) => run('wiped', i + 1, 0, 0)), total: { runs: 3 } },
  ];
  let ok = true;
  let detail = '';
  for (const j of junk) {
    let r;
    try {
      r = sanitizeRecord(j);
    } catch (e) {
      r = null;
    }
    if (!r || !wellFormed(r)) {
      ok = false;
      detail = JSON.stringify(j).slice(0, 80);
    }
  }
  check('junk in storage reads as a well-formed record', ok, detail);
  const cut = sanitizeRecord(junk[8]);
  check('a log longer than 20 keeps its newest 20, and the run count never falls below the log', cut.runs.length === 20 && cut.runs[19].secs === 45 && cut.total.runs === 20, `${cut.runs.length} kept, ${cut.total.runs} runs`);
  const odd = sanitizeRecord(junk[7]);
  check('one usable entry among junk is kept, its bad fields zeroed', odd.runs.length === 1 && odd.runs[0].secs === 0 && odd.runs[0].kills === 0 && odd.runs[0].team === 255, JSON.stringify(odd.runs[0]));
}

// ---- what a run does to the bests
{
  let rec = sanitizeRecord(null);
  let rep = applyRun(rec, run('wiped', 400, 0, 12));
  check('a first run sets the bests and announces none', rep.news.length === 0 && rep.record.total.runs === 1 && rep.record.best.kills === 12 && rep.record.best.secs === 0, JSON.stringify(rep.record.best));
  rep = applyRun(rep.record, run('escaped', 900, 2, 30));
  check(
    'a first escape is announced, with the nights and kills it beat',
    rep.news.map((n) => n.k).join() === 'secs,nights,kills' && rep.news[0].label === 'First escape' && rep.news[0].text === '15:00' && rep.record.best.secs === 900 && rep.record.total.streak === 1,
    rep.news.map((n) => `${n.label}: ${n.text}`).join(' | '),
  );
  rep = applyRun(rep.record, run('escaped', 872, 2, 30));
  check(
    'a faster escape is a new best and says what it beat; a second in a row is a best streak',
    rep.news.length === 2 && rep.news[0].text === 'escaped in 14:32' && rep.news[0].was === '15:00' && rep.news[1].k === 'streak' && rep.record.best.streak === 2,
    rep.news.map((n) => `${n.label}: ${n.text} (was ${n.was})`).join(' | '),
  );
  rep = applyRun(rep.record, run('escaped', 872, 2, 30));
  check('equalling a best is not a new best', rep.news.every((n) => n.k === 'streak') && rep.record.best.secs === 872, rep.news.map((n) => n.text).join(' | '));
  rep = applyRun(rep.record, run('wiped', 100, 5, 3));
  check(
    'a wipe ends the streak, keeps the best streak and the fastest escape, and can still set a nights best',
    rep.record.total.streak === 0 && rep.record.best.streak === 3 && rep.record.best.secs === 872 && rep.news.length === 1 && rep.news[0].text === '5 nights survived' && rep.news[0].was === '2',
    JSON.stringify(rep.record.total),
  );
  rec = rep.record;
  for (let i = 0; i < 30; i++) rec = applyRun(rec, run('wiped', 50, 0, 0)).record;
  check('the log holds the last 20 runs while the totals count them all', rec.runs.length === 20 && rec.total.runs === 35 && rec.total.escapes === 3 && wellFormed(rec), `${rec.runs.length} in the log, ${rec.total.runs} runs`);
  check('the splash gets nothing for an empty record', recordSummary(sanitizeRecord(null)).length === 0);
  check('...and runs, escapes, fastest escape and most nights for a played one', recordSummary(rec).join(' · ') === '35 runs · 3 escapes · fastest escape 14:32 · most nights 5', recordSummary(rec).join(' · '));
}

// ---- through storage
{
  setStorage(working);
  store = {};
  check('nothing stored reads as an empty record', loadRecord().total.runs === 0);
  recordRun(run('escaped', 700, 1, 9, 3));
  const rep = recordRun(run('wiped', 300, 0, 2));
  const back = loadRecord();
  check('a recorded run is read back from storage', back.total.runs === 2 && back.runs.length === 2 && back.runs[0].team === 3 && back.best.secs === 700 && JSON.stringify(back) === JSON.stringify(rep.record), store[KEY]);
  check('everything is under the one key', Object.keys(store).join() === KEY, Object.keys(store).join());
  check('a run that is not a run is not recorded', recordRun({ result: 'left', secs: 5 }) === null && recordRun(null) === null && loadRecord().total.runs === 2);

  store[KEY] = '{"v":1,"runs":[{"result":"esc';
  check('a stored value that is not JSON reads as empty', loadRecord().total.runs === 0);
  check('...and the next run starts a fresh record over it', recordRun(run('wiped', 60, 0, 1)).record.total.runs === 1 && loadRecord().total.runs === 1);
  clearRecord();
  check('clearing removes the key', !(KEY in store) && loadRecord().total.runs === 0);

  for (const [name, s] of [
    ['storage that refuses every call', broken],
    ['no storage at all', undefined],
  ]) {
    setStorage(s);
    let ok = true;
    let detail = '';
    try {
      ok = loadRecord().total.runs === 0;
      recordRun(run('escaped', 500, 1, 4));
      const second = recordRun(run('escaped', 450, 1, 4));
      // with nowhere to write, the record lasts as long as the page: the second run still sees the first
      ok = ok && second.record.total.runs === 2 && second.news[0].was === '8:20' && loadRecord().total.runs === 2;
      clearRecord();
      ok = ok && loadRecord().total.runs === 0;
    } catch (e) {
      ok = false;
      detail = String(e);
    }
    check(`${name}: nothing throws and the record lives in memory`, ok, detail);
  }

  // storage that fills up after a first write keeps serving the newer record from memory, not the stale stored one
  setStorage(working);
  store = {};
  recordRun(run('wiped', 60, 0, 1));
  setStorage({ ...working, setItem: refuse });
  recordRun(run('wiped', 60, 0, 1));
  check('a write that fails does not lose the run for this page', loadRecord().total.runs === 2 && JSON.parse(store[KEY]).total.runs === 1);
  setStorage(working);
  recordRun(run('wiped', 60, 0, 1));
  check('...and it is written once storage takes writes again', JSON.parse(store[KEY]).total.runs === 3);
}

console.log(failed ? `${failed} checks failed` : 'all record checks passed');
process.exit(failed ? 1 : 0);
