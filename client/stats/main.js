// The stats page (/stats): the whole game's numbers from GET /api/stats (server/publicstats.js), drawn again every
// half minute, and the admin's part from GET /api/stats/admin when the browser is signed in as an admin.
import { fmt, lineChart, barChart, hbars, donut, heatmap } from './charts.js';

const C = {
  blood: '#d42a2a',
  bloodDeep: '#7a0d12',
  bone: '#e6dfcf',
  boneDim: 'rgba(230, 223, 207, 0.45)',
  amber: '#e8a33d',
  sick: '#a3d64e',
  steel: '#9fb0bb',
  moon: '#8fb4e0',
  brass: '#c9a54a',
};
const OUTCOME = {
  victory: ['Escaped', C.sick],
  wipe: ['Wiped out', C.blood],
  abandoned: ['Abandoned', C.steel],
  interrupted: ['Server restart', C.boneDim],
  handoff: ['Carried to a new server', C.moon],
  playing: ['Still going', C.amber],
};
const MODE_COLOR = { ember: C.amber, nightfall: C.blood, blackout: C.moon };
const RANGE_LABEL = { '7d': '7 days', '30d': '30 days', '90d': '90 days', all: 'All time' };
const PHASE_LABEL = { 0: 'Waiting', 1: 'Day', 2: 'Night', 3: 'Game over', 4: 'Escaped', 5: 'Crossing the bridge' };
const REFRESH_MS = 30_000;

const h = (tag, cls, parent, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
};
const card = (parent, title, sub = '', cls = '') => {
  const c = h('section', `st-card ${cls}`, parent);
  const head = h('header', 'st-card-h', c);
  h('h3', '', head, title);
  if (sub) h('p', 'st-card-s', head, sub);
  return h('div', 'st-card-b', c);
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayLabel = (key, _i, long) => {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return long ? `${WD[dt.getUTCDay()]}, ${MONTHS[m - 1]} ${d}` : `${MONTHS[m - 1]} ${d}`;
};
const ago = (iso) => {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};
const dateText = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};
const duration = (s) => {
  s = Math.round(s);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
};
const running = (base, values) => {
  let t = base;
  return values.map((v) => (t += v));
};
const pctOf = (a, b) => (b ? Math.round((100 * a) / b) : 0);

// a number that counts up to where it is going
function counter(el, to, format = fmt.int) {
  const from = el._v ?? 0;
  el._v = to;
  if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = format(to);
    return;
  }
  const t0 = performance.now();
  const ms = from ? 900 : 1600;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    const e = 1 - (1 - k) ** 3;
    el.textContent = format(from + (to - from) * e);
    if (k < 1 && el._v === to) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------- the page
const root = document.getElementById('stats');
const params = new URLSearchParams(location.search);
let range = RANGE_LABEL[params.get('range')] ? params.get('range') : '30d';

const head = h('header', 'st-top', root);
const brand = h('a', 'st-brand', head);
brand.href = '/';
h('span', 'st-brand-a', brand, 'Survive');
h('span', 'st-brand-b', brand, 'The Night');
const live = h('div', 'st-live', head);
const liveDot = h('i', 'st-dot', live);
const liveTxt = h('span', '', live, 'Counting the living…');
const play = h('a', 'st-play', head, 'Play now');
play.href = '/';

const hero = h('section', 'st-hero', root);
h('div', 'st-kicker', hero, 'The body count');
const heroNum = h('div', 'st-hero-n', hero, '0');
const heroSub = h('div', 'st-hero-s', hero, 'zombies put down');

const tiles = h('section', 'st-tiles', root);
const TILES = [
  ['players', 'Survivors', (t) => `${fmt.int(t.accounts)} accounts · ${fmt.int(t.guests)} guests`],
  ['matches', 'Runs started', (t) => `${fmt.int(t.victories)} ended in escape`],
  ['hours', 'Hours survived', null, fmt.one],
  ['nightsSurvived', 'Nights lived through', null],
  ['escaped', 'Survivors escaped', null],
  ['bossesKilled', 'Bosses slain', null],
  ['headshots', 'Headshots', (t) => `${pctOf(t.headshots, t.shots)}% of shots fired`],
  ['shots', 'Rounds fired', null],
  ['deaths', 'Survivors lost', (t) => `${fmt.int(t.downs)} times knocked down`],
  ['revives', 'Teammates revived', null],
  ['km', 'Kilometres walked', null, fmt.one],
  ['built', 'Barricades built', (t) => `${fmt.int(t.lost)} torn down by the horde`],
  ['searched', 'Places searched', null],
  ['crafted', 'Things crafted', null],
  ['supplies', 'Car parts installed', null],
  ['deer', 'Deer hunted', null],
];
const tileEls = {};
for (const [key, name, , format] of TILES) {
  const t = h('div', 'st-tile', tiles);
  const n = h('div', 'st-tile-n', t, '0');
  h('div', 'st-tile-l', t, name);
  const s = h('div', 'st-tile-s', t, '');
  tileEls[key] = { n, s, format: format || fmt.int };
}

const nowWrap = h('section', 'st-now', root);
nowWrap.hidden = true;

const bar = h('nav', 'st-range', root);
h('span', 'st-range-l', bar, 'Showing');
const rangeBtns = {};
for (const k of Object.keys(RANGE_LABEL)) {
  const b = h('button', 'st-range-b', bar, RANGE_LABEL[k]);
  b.type = 'button';
  b.addEventListener('click', () => {
    if (range === k) return;
    range = k;
    const u = new URL(location.href);
    u.searchParams.set('range', k);
    history.replaceState(null, '', u);
    load(true);
  });
  rangeBtns[k] = b;
}
const updated = h('span', 'st-updated', bar, '');

const err = h('div', 'st-err', root);
err.hidden = true;

const grid = h('main', 'st-grid', root);
const G = {};
G.growPlayers = card(grid, 'Survivors, all told', 'Everyone who has ever played, as the count grew', 'st-half');
G.growKills = card(grid, 'The dead, all told', 'Zombies put down since the first match', 'st-half');
G.players = card(grid, 'Players a day', 'New faces on top of those coming back', 'st-half');
G.matches = card(grid, 'Runs a day', 'Runs started, and how many got out alive', 'st-half');
G.hours = card(grid, 'Hours played a day', '', 'st-third');
G.killsDeaths = card(grid, 'Kills and losses a day', 'Zombies killed against survivors lost', 'st-third');
G.peak = card(grid, 'Most playing at once', 'Busiest moment of each day', 'st-third');
G.online = card(grid, 'The last 24 hours', 'Players in a game, every 15 minutes', 'st-half');
G.heat = card(grid, 'When the valley is busiest', 'Sessions begun, by hour of the week (your time)', 'st-half');
G.outcomes = card(grid, 'How runs end', '', 'st-third');
G.modes = card(grid, 'Difficulty picked', '', 'st-third');
G.teams = card(grid, 'Escape rate by team size', 'Runs that ended in escape or wipe', 'st-third');
G.nights = card(grid, 'How far teams get', 'Teams that reached each night, and how many saw the dawn', 'st-wide');
G.kinds = card(grid, 'Zombies killed by kind', '', 'st-third');
G.weapons = card(grid, 'Deadliest weapons', 'Kills, with accuracy', 'st-third');
G.causes = card(grid, 'What kills survivors', 'Deaths, with knock-downs', 'st-third');
G.records = card(grid, 'Hall of records', 'The best of every run so far', 'st-wide');
G.top = card(grid, 'Top survivors', 'Most zombies killed in this range', 'st-half');
G.bosses = card(grid, 'Bosses', 'How often each is put down', 'st-half');
G.recent = card(grid, 'Latest runs', '', 'st-wide');

const adminWrap = h('section', 'st-admin', root);
adminWrap.hidden = true;

const foot = h('footer', 'st-foot', root);
foot.textContent = 'Numbers come from every match played on the live servers. Days are UTC days.';

// ---------------------------------------------------------------- filling it in
function renderPublic(d) {
  const t = d.totals;
  counter(heroNum, t.zombiesKilled);
  heroSub.textContent = t.firstMatchAt ? `zombies put down since ${dateText(t.firstMatchAt)}` : 'zombies put down';
  for (const [key, , sub] of TILES) {
    const e = tileEls[key];
    counter(e.n, t[key] || 0, e.format);
    e.s.textContent = sub ? sub(t) : '';
  }
  renderLive(d.live);

  const days = d.daily;
  const labels = days.map((x) => x.day);
  const col = (k) => days.map((x) => x[k]);
  lineChart(G.growPlayers, { labels, labelFormat: dayLabel, series: [{ name: 'Survivors', values: running(d.base.players, col('newPlayers')), color: C.amber, area: true }] });
  lineChart(G.growKills, { labels, labelFormat: dayLabel, series: [{ name: 'Zombies killed', values: running(d.base.kills, col('kills')), color: C.blood, area: true }] });
  barChart(G.players, {
    labels,
    labelFormat: dayLabel,
    stacked: true,
    series: [
      { name: 'Returning', values: days.map((x) => Math.max(0, x.players - x.newPlayers)), color: C.bloodDeep },
      { name: 'New', values: col('newPlayers'), color: C.amber },
    ],
  });
  barChart(G.matches, {
    labels,
    labelFormat: dayLabel,
    stacked: true,
    series: [
      { name: 'Escaped', values: col('victories'), color: C.sick },
      { name: 'Did not', values: days.map((x) => Math.max(0, x.matches - x.victories)), color: C.bloodDeep },
    ],
  });
  lineChart(G.hours, { labels, labelFormat: dayLabel, format: fmt.one, series: [{ name: 'Hours', values: col('hours'), color: C.moon, area: true }] });
  lineChart(G.killsDeaths, {
    labels,
    labelFormat: dayLabel,
    series: [
      { name: 'Zombies killed', values: col('kills'), color: C.blood, area: true },
      { name: 'Survivors lost', values: col('deaths'), color: C.bone, dashed: true },
    ],
  });
  lineChart(G.peak, { labels, labelFormat: dayLabel, series: [{ name: 'At once', values: col('peak'), color: C.sick, area: true }] });

  const online = d.online24h;
  const hhmm = (iso, _i, long) => {
    const dt = new Date(iso);
    const s = dt.toLocaleTimeString([], { hour: 'numeric', minute: long ? '2-digit' : undefined });
    return s.replace(':00', '').replace(' ', '').toLowerCase();
  };
  lineChart(G.online, { labels: online.map((x) => x.at), labelFormat: hhmm, series: [{ name: 'Playing', values: online.map((x) => x.players), color: C.amber, area: true }] });

  // the week's hours turned from UTC to the browser's time
  const off = Math.round(-new Date().getTimezoneOffset() / 60);
  const local = new Array(168).fill(0);
  d.heatmap.forEach((v, i) => (local[(((i + off) % 168) + 168) % 168] += v));
  heatmap(G.heat, local);

  donut(G.outcomes, d.outcomes.map((o) => ({ label: (OUTCOME[o.outcome] || [o.outcome])[0], value: o.n, color: (OUTCOME[o.outcome] || [, C.steel])[1] })), { caption: 'runs' });
  donut(G.modes, d.modes.map((m) => ({ label: m.label, value: m.matches, color: MODE_COLOR[m.key] || C.steel })), { caption: 'runs' });
  barChart(G.teams, {
    labels: d.teams.map((x) => String(x.team)),
    labelFormat: (v, _i, long) => (long ? `${v} player${v === '1' ? '' : 's'}` : v === '1' ? 'solo' : `${v}`),
    format: fmt.pct,
    legend: false,
    height: 180,
    series: [{ name: 'Escaped', values: d.teams.map((x) => x.victoryPct), color: C.sick }],
  });
  barChart(G.nights, {
    labels: d.nights.map((x) => String(x.night)),
    labelFormat: (v, _i, long) => (long ? `Night ${v}` : `N${v}`),
    height: 220,
    series: [
      { name: 'Reached', values: d.nights.map((x) => x.reached), color: C.bloodDeep },
      { name: 'Saw the dawn', values: d.nights.map((x) => x.survived + x.escaped), color: C.amber },
    ],
  });
  hbars(G.kinds, d.killsByType.map((k) => ({ label: k.label, value: k.kills, note: `${k.pct}%` })));
  hbars(G.weapons, d.weapons.filter((w) => w.kills > 0).slice(0, 8).map((w) => ({ label: w.label, value: w.kills, note: w.accuracy !== null && w.shots ? `${w.accuracy}% accuracy over ${fmt.short(w.shots)} shots` : '' })), { color: C.amber });
  hbars(G.causes, d.deathCauses.map((c) => ({ label: c.label, value: c.deaths, note: `${fmt.int(c.downs)} knock-downs` })), { color: C.steel });

  renderRecords(d.records);
  table(G.top, ['', 'Survivor', 'Kills', 'Headshots', 'Nights', 'Revives', 'Runs'], d.topPlayers.map((p, i) => [`#${i + 1}`, p.name + (p.account ? ' ★' : ''), fmt.int(p.kills), fmt.int(p.headshots), fmt.int(p.nights), fmt.int(p.revives), fmt.int(p.matches)]));
  table(G.bosses, ['Boss', 'Came', 'Put down', 'Kill rate', 'Wiped the team'], d.bosses.map((b) => [b.label, fmt.int(b.nights), fmt.int(b.killed), `${b.killPct}%`, `${b.wipePct}%`]));
  table(
    G.recent,
    ['Ended', 'How', 'Players', 'Reached', 'Kills', 'Lost', 'Length', 'Difficulty'],
    d.recent.map((r) => [ago(r.endedAt), { text: (OUTCOME[r.outcome] || [r.outcome])[0], color: (OUTCOME[r.outcome] || [, C.steel])[1] }, fmt.int(r.players), `Day ${r.lastDay}`, fmt.int(r.kills), fmt.int(r.deaths), `${fmt.one(r.minutes)} min`, r.mode])
  );
}

function renderLive(lv) {
  if (!lv) return;
  liveDot.classList.toggle('on', lv.players > 0);
  liveTxt.textContent = lv.players > 0 ? `${fmt.int(lv.players)} playing now in ${fmt.int(lv.games)} game${lv.games === 1 ? '' : 's'}` : 'Nobody playing right now. Be the first.';
  nowWrap.replaceChildren();
  const list = (lv.list || []).filter((g) => g.players > 0);
  nowWrap.hidden = !list.length;
  if (!list.length) return;
  h('div', 'st-now-l', nowWrap, 'Running now');
  for (const g of list) {
    const a = h('a', 'st-game', nowWrap);
    a.href = `/?game=${encodeURIComponent(g.code)}`;
    h('div', 'st-game-n', a, g.name || 'A game');
    h('div', 'st-game-s', a, `${g.players}/${g.max} · Day ${g.day || 1} · ${PHASE_LABEL[g.phase] || ''}`);
    h('div', 'st-game-j', a, 'Join');
  }
}

function renderRecords(r) {
  const el = G.records;
  el.replaceChildren();
  const grid = h('div', 'st-recs', el);
  const rec = (title, value, who, when) => {
    const c = h('div', 'st-rec', grid);
    h('div', 'st-rec-t', c, title);
    h('div', 'st-rec-v', c, value);
    if (who) h('div', 'st-rec-w', c, who);
    if (when) h('div', 'st-rec-d', c, dateText(when));
  };
  const any = Object.values(r).some(Boolean);
  if (!any) return h('div', 'ch-empty', el, 'Nothing yet');
  if (r.longestRun) rec('Longest run', `${r.longestRun.value} night${r.longestRun.value === 1 ? '' : 's'}`, r.longestRun.names, r.longestRun.at);
  if (r.mostKills) rec('Most kills in one run', fmt.int(r.mostKills.value), r.mostKills.name, r.mostKills.at);
  if (r.fastestEscape) rec('Fastest escape', duration(r.fastestEscape.value), r.fastestEscape.names, r.fastestEscape.at);
  if (r.longestLife) rec('Longest without dying', duration(r.longestLife.value), r.longestLife.name, r.longestLife.at);
  if (r.mostHeadshots) rec('Most headshots in one run', fmt.int(r.mostHeadshots.value), r.mostHeadshots.name, r.mostHeadshots.at);
  if (r.mostRevives) rec('Most revives in one run', fmt.int(r.mostRevives.value), r.mostRevives.name, r.mostRevives.at);
  if (r.farthestWalk) rec('Farthest walked in one run', `${fmt.one(r.farthestWalk.value / 1000)} km`, r.farthestWalk.name, r.farthestWalk.at);
  if (r.deadliestNight) rec('Bloodiest night', `${fmt.int(r.deadliestNight.value)} kills`, `on night ${r.deadliestNight.night}`, r.deadliestNight.at);
  if (r.biggestHorde) rec('Biggest horde', `${fmt.int(r.biggestHorde.value)} zombies`, `on night ${r.biggestHorde.night}`, r.biggestHorde.at);
  if (r.biggestGame) rec('Biggest game', `${r.biggestGame.value} players`, '', r.biggestGame.at);
}

// rows: arrays of cells, each a string or { text, color }
function table(el, cols, rows) {
  el.replaceChildren();
  if (!rows.length) return h('div', 'ch-empty', el, 'Nothing yet');
  const wrap = h('div', 'st-tw', el);
  const t = h('table', 'st-t', wrap);
  const tr = h('tr', '', h('thead', '', t));
  for (const c of cols) h('th', '', tr, c);
  const body = h('tbody', '', t);
  for (const r of rows) {
    const row = h('tr', '', body);
    for (const c of r) {
      const td = h('td', '', row, typeof c === 'object' && c ? c.text : c);
      if (c && c.color) td.style.color = c.color;
    }
  }
}

// ---------------------------------------------------------------- the admin's part
let adminBuilt = null;
function renderAdmin(a) {
  if (!adminBuilt) {
    adminWrap.hidden = false;
    const hd = h('header', 'st-admin-h', adminWrap);
    h('h2', '', hd, 'Admin');
    h('p', '', hd, 'Only you see this part: who comes back, how long they stay, and how the servers hold up.');
    const tilesEl = h('div', 'st-tiles st-tiles-a', adminWrap);
    const g = h('div', 'st-grid', adminWrap);
    adminBuilt = {
      tiles: tilesEl,
      signups: card(g, 'New accounts a day', '', 'st-third'),
      sessions: card(g, 'Session length', 'One player in one run', 'st-third'),
      loyalty: card(g, 'Runs played per player', '', 'st-third'),
      retention: card(g, 'Do new players come back?', 'Of each day\'s new players: back the next day, and within a week', 'st-half'),
      quits: card(g, 'When players walk out', 'Leaving a run that was still going, by the day they left on', 'st-half'),
      tick: card(g, 'Server tick time', 'Average and worst p99 a day (ms; a tick has 50)', 'st-half'),
      ping: card(g, 'Ping and load', 'Average ping (ms), and the most zombies alive in one game', 'st-half'),
      builds: card(g, 'Each deploy', 'Runs played on every build: how balance changes landed', 'st-wide'),
      votes: card(g, 'How hard players say it is', 'End screen votes: 1 too easy … 5 too hard', 'st-half'),
      pacing: card(g, 'Car part pacing', 'Minutes into a run each part is first found and installed', 'st-half'),
      regulars: card(g, 'Regulars', 'Most hours played in this range', 'st-wide'),
    };
  }
  const A = adminBuilt;
  A.tiles.replaceChildren();
  const tile = (n, l, s = '') => {
    const t = h('div', 'st-tile', A.tiles);
    h('div', 'st-tile-n', t, n);
    h('div', 'st-tile-l', t, l);
    h('div', 'st-tile-s', t, s);
  };
  tile(fmt.int(a.actives.dau), 'Played today', 'last 24 hours');
  tile(fmt.int(a.actives.wau), 'Played this week', 'last 7 days');
  tile(fmt.int(a.actives.mau), 'Played this month', 'last 30 days');
  tile(`${a.actives.stickiness}%`, 'Stickiness', 'daily ÷ monthly players');
  tile(fmt.int(a.actives.accounts), 'Accounts', `${fmt.int(a.actives.accountsWeek)} new this week`);
  tile(`${fmt.one(a.sessions.medianMinutes)} min`, 'Median session', `mean ${fmt.one(a.sessions.meanMinutes)} min`);
  tile(`${a.bounce.pct}%`, 'Bounced', `of ${fmt.int(a.bounce.newPlayers)} new players: first run under 2 min`);

  barChart(A.signups, { labels: a.signups.map((x) => x.day), labelFormat: dayLabel, legend: false, series: [{ name: 'Accounts', values: a.signups.map((x) => x.n), color: C.amber }] });
  barChart(A.sessions, { labels: a.sessions.buckets.map((x) => x.label), legend: false, series: [{ name: 'Sessions', values: a.sessions.buckets.map((x) => x.n), color: C.moon }] });
  barChart(A.loyalty, { labels: a.loyalty.map((x) => x.bucket), labelFormat: (v, _i, long) => (long ? `${v} runs` : v), legend: false, series: [{ name: 'Players', values: a.loyalty.map((x) => x.players), color: C.blood }] });
  lineChart(A.retention, {
    labels: a.cohorts.map((x) => x.day),
    labelFormat: dayLabel,
    format: fmt.pct,
    series: [
      { name: 'Back next day', values: a.cohorts.map((x) => pctOf(x.d1, x.newPlayers)), color: C.amber },
      { name: 'Back within a week', values: a.cohorts.map((x) => pctOf(x.d7, x.newPlayers)), color: C.sick },
    ],
  });
  barChart(A.quits, {
    labels: a.quits.map((x) => String(x.day)),
    labelFormat: (v, _i, long) => (long ? `Day ${v}` : `D${v}`),
    stacked: true,
    series: [
      { name: 'By day', values: a.quits.map((x) => x.byDay), color: C.amber },
      { name: 'At night', values: a.quits.map((x) => x.byNight), color: C.moon },
    ],
  });
  lineChart(A.tick, {
    labels: a.health.map((x) => x.day),
    labelFormat: dayLabel,
    format: fmt.one,
    series: [
      { name: 'Average', values: a.health.map((x) => x.tickMs), color: C.sick, area: true },
      { name: 'Worst p99', values: a.health.map((x) => x.tickP99), color: C.blood, dashed: true },
    ],
  });
  lineChart(A.ping, {
    labels: a.health.map((x) => x.day),
    labelFormat: dayLabel,
    series: [
      { name: 'Ping (ms)', values: a.health.map((x) => x.pingMs), color: C.amber },
      { name: 'Most zombies', values: a.health.map((x) => x.zombies), color: C.steel, dashed: true },
    ],
  });
  table(A.builds, ['Build', 'First run', 'Runs', 'Escape rate', 'Avg nights', 'Avg length', 'Avg kills'], a.builds.map((b) => [b.build, dateText(b.first), fmt.int(b.matches), b.victoryPct === null ? '-' : `${b.victoryPct}%`, fmt.one(b.avgNights), `${fmt.one(b.avgMinutes)} min`, fmt.one(b.avgKills)]));
  table(A.votes, ['Who', 'Votes', 'Avg', 'Too easy', 'Just right', 'Too hard'], a.votes.map((v) => [v.bucket, fmt.int(v.votes), fmt.one(v.avg), `${Math.round(v.tooEasy + v.easy)}%`, `${Math.round(v.justRight)}%`, `${Math.round(v.hard + v.tooHard)}%`]));
  table(A.pacing, ['Part', 'Found in', 'Found at', 'Installed in', 'Installed at'], a.pacing.map((p) => [p.label, `${fmt.int(p.found)} runs`, p.foundMin === null ? '-' : `${fmt.one(p.foundMin)} min`, `${fmt.int(p.installed)} runs`, p.installedMin === null ? '-' : `${fmt.one(p.installedMin)} min`]));
  table(A.regulars, ['Player', 'Hours', 'Runs', 'Days played', 'First seen', 'Last seen'], a.regulars.map((r) => [r.name + (r.account ? ' ★' : ' (guest)'), fmt.one(r.hours), fmt.int(r.matches), fmt.int(r.days), dateText(r.firstSeen), ago(r.lastSeen)]));
}

// ---------------------------------------------------------------- asking the server
let loading = 0;
let timer = 0;
async function load(changed = false) {
  const n = ++loading;
  clearTimeout(timer);
  for (const k in rangeBtns) rangeBtns[k].classList.toggle('on', k === range);
  if (changed) root.classList.add('st-busy');
  try {
    const [pub, adm] = await Promise.all([
      fetch(`/api/stats?range=${range}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`the server said ${r.status}`)))),
      fetch(`/api/stats/admin?range=${range}`, { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (n !== loading) return;
    err.hidden = true;
    if (!pub.enabled) {
      renderLive(pub.live);
      grid.hidden = true;
      bar.hidden = true;
      err.hidden = false;
      err.textContent = 'This server keeps no match records (it has no database), so there is nothing to count yet.';
    } else {
      renderPublic(pub);
      updated.textContent = `Updated ${new Date(pub.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    }
    if (adm) renderAdmin(adm);
  } catch (e) {
    if (n !== loading) return;
    err.hidden = false;
    err.textContent = `Could not load the numbers (${e.message}). Trying again shortly.`;
  } finally {
    if (n === loading) {
      root.classList.remove('st-busy');
      timer = setTimeout(load, REFRESH_MS);
    }
  }
}
load(true);
