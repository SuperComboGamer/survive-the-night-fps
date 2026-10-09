// The control room (/admin): what the people who run the game see and do from outside it. Everything here comes
// from /api/admin/* (server/adminpanel.js), which decides on every request whether this browser is an admin's: the
// page itself knows nothing and shows nothing until the server has said yes, and goes blank again the moment it
// says no. Asked again every few seconds while the page is in front.
//
// Every name on this page (players, games, accounts) is somebody else's text: it only ever goes into the page as
// text (textContent), never as markup.

const POLL_MS = 3000;
const PHASE = { 0: 'Waiting', 1: 'Day', 2: 'Night', 3: 'Game over', 4: 'Escaped', 5: 'Crossing' };
const PHASE_CLS = { 0: 'dim', 1: 'day', 2: 'night', 3: 'bad', 4: 'good', 5: 'day' };
const ACT = { 1: 'Island', 2: 'Mainland' };
const HEALTH = { ok: ['Steady', 'good'], slow: ['Slow ticks', 'warn'], late: ['Running late', 'bad'], errors: ['Throwing errors', 'bad'] };
const DIFF = { ember: 'Ember', nightfall: 'Nightfall', blackout: 'Blackout' };
const PLAYER_STATE = { alive: ['Alive', 'good'], down: ['Down', 'warn'], dead: ['Dead', 'bad'], turned: ['Turned', 'bad'] };
const ACTION = {
  'game.create': 'Made a game',
  'game.message': 'Message to a game',
  'game.reset': 'Reset a game',
  'game.close': 'Closed a game',
  'game.kick': 'Removed a player',
  'game.command': 'Ran a command',
  'server.broadcast': 'Message to everyone',
  'server.drain': 'New games on / off',
  'server.close_all': 'Closed every game',
  'server.restart': 'Restarted the server',
  'setting.set': 'Changed a setting',
  'account.admin': 'Admin access',
  'account.sessions_end': 'Ended sign-ins',
};
const TABS = [
  ['overview', 'Overview'],
  ['games', 'Games'],
  ['server', 'Server'],
  ['accounts', 'Accounts'],
  ['audit', 'Audit log'],
];

// ---------------------------------------------------------------- small things
const h = (tag, cls, parent, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
};
const clear = (n) => {
  while (n.firstChild) n.removeChild(n.firstChild);
  return n;
};
const int = (v) => Math.round(v || 0).toLocaleString('en-US');
const bytes = (v) => {
  v = Math.max(0, v || 0);
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i ? v.toFixed(v < 10 ? 1 : 0) : Math.round(v)} ${u[i]}`;
};
const bps = (v) => `${bytes(v)}/s`;
const plural = (n, one, many = `${one}s`) => `${int(n)} ${n === 1 ? one : many}`;
const span = (s) => {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
};
// (coarser, for a table that should not redraw every second)
const age = (s) => (s < 60 ? 'under a minute' : s < 3600 ? `${Math.floor(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m` : `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`);
const ago = (iso) => {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
};
const clock = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const chip = (parent, text, cls = '') => h('span', `ad-chip ${cls}`, parent, text);
function spark(parent, title) {
  const box = h('div', 'ad-spark', parent);
  h('div', 'ad-spark-t', box, title);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 120 36');
  svg.setAttribute('preserveAspectRatio', 'none');
  box.appendChild(svg);
  const out = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  const inn = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  out.setAttribute('class', 'out');
  inn.setAttribute('class', 'in');
  svg.append(out, inn);
  const cap = h('div', 'ad-spark-c', box);
  return (points = []) => {
    const max = Math.max(1, ...points.map((p) => Math.max(p.bytesIn || 0, p.bytesOut || 0)));
    const draw = (key) =>
      points
        .map((p, i) => {
          const x = points.length <= 1 ? 0 : (i / (points.length - 1)) * 120;
          const y = 34 - ((p[key] || 0) / max) * 32;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
    inn.setAttribute('points', draw('bytesIn'));
    out.setAttribute('points', draw('bytesOut'));
    const last = points[points.length - 1] || {};
    cap.textContent = `In ${bytes(last.bytesIn || 0)} / Out ${bytes(last.bytesOut || 0)}`;
  };
}
const button = (parent, text, cls, onClick) => {
  const b = h('button', `ad-btn ${cls || ''}`, parent, text);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
};
const field = (parent, label, input, hint) => {
  const f = h('label', 'ad-field', parent);
  h('span', 'ad-field-l', f, label);
  f.appendChild(input);
  if (hint) h('span', 'ad-field-h', f, hint);
  return f;
};
const input = (attrs = {}) => Object.assign(document.createElement('input'), { className: 'ad-input', autocomplete: 'off', spellcheck: false, ...attrs });
const select = (options, value) => {
  const s = Object.assign(document.createElement('select'), { className: 'ad-input' });
  setOptions(s, options, value);
  return s;
};
// options: [[value, label]] - kept as chosen when the list is filled again
function setOptions(s, options, value = s.value) {
  const sig = JSON.stringify(options);
  if (s._sig === sig) return;
  s._sig = sig;
  clear(s);
  for (const [v, label] of options) Object.assign(h('option', '', s, label), { value: v });
  if (options.some(([v]) => String(v) === String(value))) s.value = value;
}
// a section of a page: a titled card
const card = (parent, title, sub, cls = '') => {
  const c = h('section', `st-card ad-card ${cls}`, parent);
  const head = h('header', 'st-card-h', c);
  h('h3', '', head, title);
  if (sub) h('p', 'st-card-s', head, sub);
  return h('div', 'st-card-b', c);
};
// a table drawn again only when what it shows changed (so a click is never lost to a redraw)
function table(parent, cols) {
  const wrap = h('div', 'st-tw ad-tw', parent);
  const t = h('table', 'st-t ad-t', wrap);
  const head = h('tr', '', h('thead', '', t));
  for (const c of cols) h('th', c.cls || '', head, c.name);
  const body = h('tbody', '', t);
  const empty = h('div', 'ad-empty', parent);
  let sig = null;
  return (rows, { emptyText = 'Nothing here.', key = (r) => r } = {}) => {
    const next = JSON.stringify(rows.map(key));
    if (next === sig) return;
    sig = next;
    clear(body);
    wrap.hidden = !rows.length;
    empty.hidden = !!rows.length;
    empty.textContent = emptyText;
    for (const r of rows) {
      const tr = h('tr', '', body);
      for (const c of cols) {
        const td = h('td', c.cls || '', tr);
        td.dataset.l = c.name; // (the label a phone shows beside the value: admin.css)
        const v = c.cell(r, td, tr);
        if (v !== undefined && v !== null) td.textContent = v;
      }
    }
  };
}

// ---------------------------------------------------------------- the API
let via = ''; // in a cluster: the server being managed (the proxy sends the panel's requests to it: x-stn-via)
try {
  via = sessionStorage.getItem('stn.admin.via') || '';
} catch {}
class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || (status ? `The server answered ${status}.` : 'The server could not be reached.'));
    this.status = status;
    this.body = body || {};
  }
}
async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-STN-Admin': '1', ...(via ? { 'x-stn-via': via } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json);
  return json;
}

// ---------------------------------------------------------------- the page's frame
const root = document.getElementById('admin');
const top = h('header', 'st-top ad-top', root);
const brand = h('a', 'st-brand', top);
brand.href = '/';
h('span', 'st-brand-a', brand, 'Survive');
h('span', 'st-brand-b', brand, 'The Night');
h('div', 'ad-title', top, 'Control room');
const who = h('div', 'ad-who', top);
const main = h('main', 'ad-main', root);
const toasts = h('div', 'ad-toasts', document.body);

function toast(text, bad = false) {
  const t = h('div', `ad-toast ${bad ? 'bad' : ''}`, toasts);
  h('b', '', t, bad ? 'Not done' : 'Done');
  h('span', '', t, text);
  setTimeout(() => t.classList.add('out'), bad ? 7000 : 4200);
  setTimeout(() => t.remove(), bad ? 7400 : 4600);
}

// ---------------------------------------------------------------- asking twice
// A dialog that names what is about to happen and to what. word: has to be typed before the button works. reason: a
// line the players are shown. -> { reason } or null
function confirmDialog({ title, target, lines = [], action, word = '', reason = false, reasonHint = '' }) {
  return new Promise((resolve) => {
    const veil = h('div', 'ad-veil', document.body);
    const box = h('div', 'ad-dialog', veil);
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    h('div', 'ad-dialog-k', box, 'Are you sure?');
    h('h2', 'ad-dialog-t', box, title);
    if (target) h('div', 'ad-dialog-target', box, target);
    const ul = h('ul', 'ad-dialog-l', box);
    for (const l of lines) h('li', '', ul, l);
    let why = null;
    if (reason) {
      why = input({ maxLength: 100, placeholder: 'Optional' });
      field(box, 'Reason the players are shown', why, reasonHint);
    }
    let typed = null;
    if (word) {
      typed = input({ placeholder: word });
      field(box, `Type ${word} to go ahead`, typed);
    }
    const foot = h('div', 'ad-dialog-f', box);
    const done = (v) => {
      document.removeEventListener('keydown', onKey);
      veil.remove();
      resolve(v);
    };
    const cancel = button(foot, 'Cancel', '', () => done(null));
    const go = button(foot, action, 'ad-btn-danger', () => done({ reason: why ? why.value.trim() : '' }));
    const armed = () => (go.disabled = !!word && typed.value.trim().toUpperCase() !== word);
    typed?.addEventListener('input', armed);
    armed();
    const onKey = (e) => {
      if (e.key === 'Escape') done(null);
      if (e.key === 'Enter' && !go.disabled && document.activeElement !== cancel) done({ reason: why ? why.value.trim() : '' });
    };
    document.addEventListener('keydown', onKey);
    veil.addEventListener('mousedown', (e) => e.target === veil && done(null));
    (typed || why || cancel).focus();
  });
}

// Does something, says how it went, and has the page ask the server again
async function act(fn, { busy = null } = {}) {
  if (busy) busy.disabled = true;
  try {
    const r = await fn();
    toast(r?.result ? `${r.result[0].toUpperCase()}${r.result.slice(1)}.` : 'Done.');
    if (r && r.audited === false) toast('It was done, but the audit log could not be written. The server log has it.', true);
    refresh();
    return r;
  } catch (err) {
    if (err.status === 401 || (err.status === 403 && !err.body.rule)) gate(err);
    else toast(err.message, true);
    return null;
  } finally {
    if (busy) busy.disabled = false;
  }
}

// ---------------------------------------------------------------- who is here
// Until the server has said this browser is an admin's, the page is this card and nothing else.
let me = null;
let catalog = null;
let state = null;
let view = null; // the tab on screen: { name, update(state), stop() }
let timer = 0;

function gate(err) {
  me = null;
  state = null;
  clearTimeout(timer);
  view?.stop?.();
  view = null;
  clear(who);
  clear(main);
  document.querySelector('.ad-tabs')?.remove();
  document.querySelector('.ad-veil')?.remove();
  root.classList.add('ad-gated');
  const box = h('section', 'ad-gate', main);
  const kicker = h('div', 'ad-dialog-k', box);
  const title = h('h1', 'ad-gate-t', box);
  const text = h('p', 'ad-gate-p', box);
  const retry = () => button(box, 'Try again', '', () => start());

  if (err.status === 503 && err.body.accounts === false) {
    kicker.textContent = 'No database';
    title.textContent = 'Nobody is an admin here';
    text.textContent = 'This server runs without a database, so it has no accounts, and without accounts there are no admins. The control room only works on a server started with DATABASE_URL.';
    h('p', 'ad-gate-p ad-dim', box, 'The game itself runs as usual. Its public numbers are on /status.');
  } else if (err.status === 401) {
    kicker.textContent = 'Admins only';
    title.textContent = 'Sign in';
    text.textContent = 'The control room is for the accounts that run the game. Sign in with yours.';
    const form = h('form', 'ad-gate-f', box);
    const login = input({ name: 'login', placeholder: 'Email or name', autocomplete: 'username', required: true });
    const pass = input({ name: 'password', type: 'password', placeholder: 'Password', autocomplete: 'current-password', required: true });
    field(form, 'Email or name', login);
    field(form, 'Password', pass);
    const msg = h('div', 'ad-gate-e', form);
    const go = h('button', 'ad-btn ad-btn-blood', form, 'Sign in');
    go.type = 'submit';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      go.disabled = true;
      msg.textContent = '';
      try {
        await api('POST', '/api/auth/login', { login: login.value, password: pass.value });
        start();
      } catch (e2) {
        msg.textContent = e2.message;
        go.disabled = false;
      }
    });
    login.focus();
  } else if (err.status === 403) {
    kicker.textContent = 'Admins only';
    title.textContent = 'This account is not an admin';
    text.textContent = 'You are signed in, but the control room is only for the accounts that run the game. There is nothing to see here.';
    api('GET', '/api/auth/me')
      .then((r) => r.user && (text.textContent = `You are signed in as ${r.user.username}, but the control room is only for the accounts that run the game. There is nothing to see here.`))
      .catch(() => {});
    const row = h('div', 'ad-gate-row', box);
    Object.assign(h('a', 'ad-btn', row, 'Back to the game'), { href: '/' });
    button(row, 'Sign out', '', async () => {
      await api('POST', '/api/auth/logout', {}).catch(() => {});
      start();
    });
  } else {
    kicker.textContent = err.status === 429 ? 'Slow down' : 'No answer';
    title.textContent = err.status === 429 ? 'Too many requests' : 'The server cannot be reached';
    text.textContent = err.status ? err.message : 'It may be restarting. This page tries again by itself every few seconds.';
    retry();
    timer = setTimeout(start, 5000);
  }
}

async function start() {
  clearTimeout(timer);
  if (!me) {
    clear(main);
    root.classList.add('ad-gated');
    h('div', 'ad-loading', main, 'Checking who you are…');
  }
  try {
    const s = await api('GET', '/api/admin/state');
    if (!catalog) catalog = await api('GET', '/api/admin/catalog');
    if (!me) frame(s);
    onState(s);
  } catch (err) {
    return gate(err);
  }
  schedule();
}

// ---------------------------------------------------------------- the frame of a signed-in admin's page
let tabsEl = null;
let banner = null;
let lost = null;
function frame(s) {
  me = s.me;
  root.classList.remove('ad-gated');
  clear(main);
  clear(who);
  h('span', 'ad-who-n', who, me.name);
  chip(who, 'Admin', 'moon');
  button(who, 'Sign out', 'ad-btn-s', async () => {
    await api('POST', '/api/auth/logout', {}).catch(() => {});
    start();
  });
  tabsEl = h('nav', 'ad-tabs', null);
  root.insertBefore(tabsEl, main);
  for (const [name, label] of TABS) {
    const a = h('a', 'ad-tab', tabsEl, label);
    a.href = `#${name}`;
    a.dataset.tab = name;
  }
  lost = h('div', 'ad-banner bad', main, 'The server is not answering. Trying again…');
  lost.hidden = true;
  banner = h('div', 'ad-banner', main);
  banner.hidden = true;
  h('div', 'ad-view', main);
  route();
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(poll, POLL_MS);
}
async function poll() {
  if (!me) return;
  if (document.hidden) return schedule(); // (nobody is looking: ask again when they are)
  try {
    onState(await api('GET', '/api/admin/state'));
    lost.hidden = true;
  } catch (err) {
    if (err.status === 401 || err.status === 403 || err.status === 503) return gate(err);
    lost.hidden = false; // (a restart, a blip: what is on screen stays, marked as old)
  }
  schedule();
}
// straight away, after something was done
function refresh() {
  clearTimeout(timer);
  poll();
  view?.refresh?.();
}
document.addEventListener('visibilitychange', () => !document.hidden && me && refresh());

function onState(s) {
  state = s;
  const sv = s.server;
  // which server this is, when there are several
  if (sv.clustered && via && sv.id !== via) {
    via = sv.id;
    toast(`The server you were managing is gone. This is ${sv.id}.`, true);
  }
  clear(banner);
  banner.hidden = !(sv.stopping || sv.draining);
  banner.className = `ad-banner ${sv.stopping ? 'bad' : 'warn'}`;
  if (sv.stopping) banner.textContent = 'This server is going down: its games are being handed to the next one.';
  else if (sv.draining) {
    h('span', '', banner, 'New games are stopped on this server. The games running carry on and can still be joined.');
    button(banner, 'Resume', 'ad-btn-s', (e) => act(() => api('POST', '/api/admin/server/drain', { on: false }), { busy: e.currentTarget }));
  }
  for (const a of tabsEl.children) if (a.dataset.tab === 'games') a.textContent = `Games · ${s.games.length}`;
  view?.update?.(s);
}

// ---------------------------------------------------------------- tabs
const VIEWS = {};
function route() {
  if (!me) return;
  const [name, arg] = location.hash.replace(/^#/, '').split('/');
  const tab = VIEWS[name] ? name : 'overview';
  for (const a of tabsEl.children) a.classList.toggle('on', a.dataset.tab === tab);
  view?.stop?.();
  const el = clear(main.querySelector('.ad-view'));
  view = VIEWS[tab](el, arg ? decodeURIComponent(arg) : '');
  if (state) view.update?.(state);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

// a row of number tiles, each { n, l, s, cls, bar }
function tiles(parent) {
  const box = h('section', 'st-tiles st-tiles-a ad-tiles', parent);
  const els = new Map();
  return (list) => {
    for (const t of list) {
      let e = els.get(t.l);
      if (!e) {
        const d = h('div', 'st-tile', box);
        e = { d, n: h('div', 'st-tile-n', d), l: h('div', 'st-tile-l', d, t.l), bar: h('i', 'ad-bar', h('div', 'ad-bar-t', d)), s: h('div', 'st-tile-s', d) };
        els.set(t.l, e);
      }
      e.n.textContent = t.n;
      e.s.textContent = t.s || '';
      e.d.className = `st-tile ${t.cls || ''}`;
      e.bar.parentNode.hidden = t.bar === undefined;
      if (t.bar !== undefined) e.bar.style.width = `${Math.max(0, Math.min(100, t.bar * 100))}%`;
    }
  };
}
const worstTick = (games) => games.reduce((m, g) => Math.max(m, g.tick?.p99Ms || 0), 0);
const gameName = (g) => g.name || 'Open game';
function gameChips(parent, g) {
  chip(parent, `${ACT[g.act] || 'Island'} · ${g.phase === 0 ? 'Waiting' : `${PHASE[g.phase] || '?'} ${g.day}`}`, PHASE_CLS[g.phase]);
  if (g.inviteOnly) chip(parent, 'Invite only', 'moon');
  if (g.health !== 'ok') chip(parent, HEALTH[g.health][0], HEALTH[g.health][1]);
}

// ---------------------------------------------------------------- overview
VIEWS.overview = (el) => {
  const status = h('section', 'ad-status', el);
  const dot = h('i', 'st-dot', status);
  const statusT = h('div', 'ad-status-t', status);
  const statusS = h('div', 'ad-status-s', status);
  const setTiles = tiles(el);
  const grid = h('div', 'st-grid ad-grid', el);

  const serversCard = card(grid, 'Servers', 'Every game server behind the proxy. This page manages one at a time.', 'st-wide');
  const serversTable = table(serversCard, [
    { name: 'Server', cell: (s, td) => (h('span', 'ad-mono', td, s.id), s.me && chip(td, 'This one', 'moon'), undefined) },
    { name: 'State', cell: (s, td) => void chip(td, s.seenS > 10 ? 'Not answering' : s.draining ? 'Going down' : 'Up', s.seenS > 10 ? 'bad' : s.draining ? 'warn' : 'good') },
    { name: 'Games', cls: 'ad-num', cell: (s) => `${s.games} / ${s.maxGames}` },
    { name: 'Players', cls: 'ad-num', cell: (s) => int(s.players) },
    { name: 'Up for', cell: (s) => age((Date.now() - s.startedAt) / 1000) },
    { name: 'Deploy', cell: (s) => s.deployment || '-' },
    { name: '', cls: 'ad-act', cell: (s, td) => void (s.me || button(td, 'Manage', 'ad-btn-s', () => switchServer(s.id))) },
  ]);

  const gamesCard = card(grid, 'Games right now', 'The busiest first. Open one to manage it.', 'st-half');
  const gamesList = h('div', 'ad-glist', gamesCard);
  const gamesMore = h('a', 'ad-more', gamesCard, 'Every game');
  gamesMore.href = '#games';

  const troubleCard = card(grid, 'Trouble', 'Games that crashed, stopped by themselves or are struggling, since this server started.', 'st-half');
  const trouble = h('div', 'ad-trouble', troubleCard);

  const buildCard = card(grid, 'This server', '', 'st-wide');
  const facts = h('dl', 'ad-facts', buildCard);
  const netCard = card(grid, 'Network bandwidth', 'Bytes and messages counted on this server at WebSocket and JSON API send/receive points.', 'st-wide');
  const netSummary = h('div', 'ad-net-summary', netCard);
  const netWindows = ['lastMinute', 'lastHour', 'lastDay'].map((key) => {
    const row = h('div', 'ad-net-window', netSummary);
    h('b', '', row, key === 'lastMinute' ? 'Last minute' : key === 'lastHour' ? 'Last hour' : 'Last day');
    return {
      key,
      inOut: h('span', '', row),
      msg: h('span', '', row),
      rate: h('span', '', row),
      player: h('span', '', row),
    };
  });
  const charts = h('div', 'ad-sparks', netCard);
  const minuteSpark = spark(charts, 'Per minute, last hour');
  const hourSpark = spark(charts, 'Per hour, last day');
  const netNote = h('p', 'ad-note', netCard);
  const channelsTable = table(netCard, [
    { name: 'Channel', cell: (c) => c.label },
    { name: 'Last hour in', cls: 'ad-num', cell: (c) => bytes(c.lastHour.bytesIn) },
    { name: 'Last hour out', cls: 'ad-num', cell: (c) => bytes(c.lastHour.bytesOut) },
    { name: 'Msgs in/out', cls: 'ad-num', cell: (c) => `${int(c.lastHour.messagesIn)} / ${int(c.lastHour.messagesOut)}` },
    { name: 'Day total', cls: 'ad-num', cell: (c) => bytes(c.lastDay.bytesIn + c.lastDay.bytesOut) },
  ]);
  let gamesSig = '';
  let troubleSig = '';

  return {
    update(s) {
      const sv = s.server;
      const slow = s.games.filter((g) => g.health !== 'ok');
      dot.className = `st-dot ${sv.stopping || sv.db.ok === false ? '' : 'on'} ${sv.draining ? 'warn' : ''}`;
      statusT.textContent = sv.stopping ? 'Going down' : sv.draining ? 'Running, new games stopped' : slow.length ? 'Running, with trouble' : 'All quiet';
      statusS.textContent = `${plural(sv.players, 'player')} in ${plural(sv.games, 'game')}${sv.clustered ? ` on ${sv.id}` : ''} · up ${span(sv.uptimeS)}`;
      const cap = sv.maxTotal === null ? sv.maxGames : Math.min(sv.maxGames, sv.maxTotal);
      const p99 = worstTick(s.games);
      const budget = s.games[0]?.tick?.budgetMs || 50;
      const bw = sv.bandwidth;
      setTiles([
        { l: 'Games', n: `${sv.games} / ${cap}`, s: sv.canCreate ? 'room for more' : sv.draining ? 'new games stopped' : 'no room for more', bar: cap ? sv.games / cap : 0, cls: !sv.canCreate && !sv.draining ? 'warn' : '' },
        { l: 'Players', n: int(sv.players), s: sv.seats ? `of ${int(sv.seats)} seats in those games` : 'nobody is playing', bar: sv.seats ? sv.players / sv.seats : 0 },
        { l: 'Slowest tick', n: s.games.length ? `${p99.toFixed(1)} ms` : '-', s: s.games.length ? `99th percentile, of a ${budget} ms budget` : 'no game is running', bar: s.games.length ? p99 / budget : undefined, cls: p99 > budget ? 'bad' : p99 > budget / 2 ? 'warn' : '' },
        { l: 'Network thread', n: `${(sv.net.cpuMs ?? 0).toFixed(0)} ms/s`, s: `${plural(sv.net.sockets || 0, 'socket')} open${bw ? `, ${bps(bw.windows.lastMinute.avgBytesPerSecondOut)} out` : ''}`, bar: (sv.net.cpuMs || 0) / 1000, cls: sv.net.cpuMs > 500 ? 'warn' : '' },
        { l: 'Memory', n: `${int(sv.rssMb)} MB`, s: `${int(sv.heapMb)} MB of it this thread's heap` },
        { l: 'Database', n: sv.db.ok ? 'Answering' : sv.db.ok === false ? 'Not answering' : '-', s: `${sv.db.kind === 'pglite' ? 'PGlite (local)' : 'Postgres'} · ${sv.db.ms} ms`, cls: sv.db.ok === false ? 'bad' : '' },
        { l: 'Uptime', n: span(sv.uptimeS), s: `since ${clock(sv.startedAt)}` },
        { l: 'Trouble', n: int(slow.length + s.incidents.length), s: s.incidents.length ? `${plural(s.incidents.length, 'game')} went down` : slow.length ? 'games struggling' : 'none', cls: s.incidents.length ? 'bad' : slow.length ? 'warn' : '' },
      ]);

      serversCard.parentNode.hidden = !s.servers;
      if (s.servers) serversTable(s.servers, { key: (x) => [x.id, x.me, x.draining, x.games, x.players, x.seenS > 10, age((Date.now() - x.startedAt) / 1000)] });

      netCard.parentNode.hidden = !bw;
      if (bw) {
        for (const row of netWindows) {
          const w = bw.windows[row.key];
          row.inOut.textContent = `${bytes(w.bytesIn)} in / ${bytes(w.bytesOut)} out`;
          row.msg.textContent = `${int(w.messagesIn)} in / ${int(w.messagesOut)} out messages`;
          row.rate.textContent = `${bps(w.avgBytesPerSecond)} average`;
          row.player.textContent = bw.players ? `${bps(bw.perPlayer[row.key].avgBytesPerSecond)} per connected player` : 'no connected players';
        }
        minuteSpark(bw.perMinute);
        hourSpark(bw.perHour);
        netNote.textContent = bw.note || '';
        channelsTable(bw.channels.slice(0, 10), {
          emptyText: 'No network traffic has been counted yet.',
          key: (c) => [c.name, c.lastHour.bytesIn, c.lastHour.bytesOut, c.lastHour.messagesIn, c.lastHour.messagesOut, c.lastDay.bytesIn, c.lastDay.bytesOut],
        });
      }

      const topGames = s.games.slice(0, 6);
      const sig = JSON.stringify(topGames.map((g) => [g.code, g.name, g.players, g.max, g.phase, g.day, g.act, g.health, g.zombies, g.inviteOnly]));
      if (sig !== gamesSig) {
        gamesSig = sig;
        clear(gamesList);
        if (!topGames.length) h('div', 'ad-empty', gamesList, 'No game is running. One starts when somebody presses Play, or make one under Server.');
        for (const g of topGames) {
          const a = h('a', 'ad-gcard', gamesList);
          a.href = `#games/${g.code}`;
          const l = h('div', 'ad-gcard-l', a);
          h('div', 'ad-gcard-n', l, gameName(g));
          const meta = h('div', 'ad-gcard-m', l);
          h('span', 'ad-mono', meta, g.code);
          gameChips(meta, g);
          const r = h('div', 'ad-gcard-r', a);
          h('b', '', r, `${g.players}/${g.max}`);
          h('span', '', r, plural(g.zombies, 'zombie'));
        }
        gamesMore.hidden = s.games.length <= topGames.length;
        gamesMore.textContent = `All ${s.games.length} games`;
      }

      const tsig = JSON.stringify([s.incidents, slow.map((g) => [g.code, g.health, g.errs, g.lastErr])]);
      if (tsig !== troubleSig) {
        troubleSig = tsig;
        clear(trouble);
        for (const g of slow) {
          const row = h('a', 'ad-inc', trouble);
          row.href = `#games/${g.code}`;
          chip(row, HEALTH[g.health][0], HEALTH[g.health][1]);
          h('span', 'ad-inc-t', row, `${gameName(g)} (${g.code}): ${g.health === 'errors' ? `${plural(g.errs, 'tick')} threw. Last: ${g.lastErr}` : `its slowest ticks take ${g.tick.p99Ms.toFixed(1)} ms of a ${g.tick.budgetMs} ms budget`}`);
        }
        for (const i of s.incidents) {
          const row = h('div', 'ad-inc', trouble);
          chip(row, i.kind, 'bad');
          h('span', 'ad-inc-t', row, `Game ${i.code}: ${i.text}`);
          h('span', 'ad-inc-w', row, ago(i.at));
        }
        if (!slow.length && !s.incidents.length) h('div', 'ad-empty good', trouble, 'No game has crashed or fallen behind since this server started.');
      }

      clear(facts);
      const fact = (k, v) => (h('dt', '', facts, k), h('dd', '', facts, v));
      if (sv.clustered) fact('Server', sv.id);
      fact('Build', sv.build ? sv.build.slice(0, 12) : 'not known (no commit in the environment)');
      fact('Client build', sv.clientBuild || '-');
      fact('Protocol', String(sv.protocol));
      fact('Node', sv.node);
      fact('Started', clock(sv.startedAt));
      fact('Games on a deploy', sv.handoff === 'postgres' ? 'Handed to the next server through Postgres' : sv.handoff === 'files' ? 'Handed to the next server through files on this disk' : 'Ended: this server has nowhere to hand them to');
      fact('Seats in a game', `${sv.defaultPlayers} unless its maker picks, ${sv.maxPlayers} at most`);
    },
  };
};
function switchServer(id) {
  via = id;
  try {
    sessionStorage.setItem('stn.admin.via', id);
  } catch {}
  toast(`Now managing ${id}.`);
  refresh();
}

// ---------------------------------------------------------------- games
VIEWS.games = (el, code) => (code ? gameView(el, code.toUpperCase()) : gamesView(el));

function gamesView(el) {
  const bar = h('div', 'ad-toolbar', el);
  const q = input({ placeholder: 'Find a game by name or code', type: 'search' });
  bar.appendChild(q);
  const count = h('span', 'ad-toolbar-n', bar);
  const draw = table(h('section', 'st-card ad-card', el), [
    {
      name: 'Game',
      cell: (g, td, tr) => {
        tr.classList.add('ad-row-link');
        tr.addEventListener('click', (e) => e.target.closest('button, a') || (location.hash = `#games/${g.code}`));
        const a = h('a', 'ad-gname', td, gameName(g));
        a.href = `#games/${g.code}`;
        const m = h('div', 'ad-gsub', td);
        h('span', 'ad-mono', m, g.code);
        if (g.inviteOnly) chip(m, 'Invite only', 'moon');
        if (g.quick) chip(m, 'Quick join', 'dim');
      },
    },
    { name: 'Where', cell: (g, td) => void chip(td, `${ACT[g.act] || 'Island'} · ${g.phase === 0 ? 'Waiting' : `${PHASE[g.phase] || '?'} ${g.day}`}`, PHASE_CLS[g.phase]) },
    { name: 'Difficulty', cell: (g) => DIFF[g.difficulty] || g.difficulty },
    { name: 'Players', cls: 'ad-num', cell: (g) => `${g.players} / ${g.max}${g.held ? ` (${g.held} held)` : ''}` },
    { name: 'Zombies', cls: 'ad-num', cell: (g) => int(g.zombies) },
    { name: 'Age', cell: (g) => age(g.ageS) },
    {
      name: 'Tick',
      cell: (g, td) => {
        if (!g.tick || !g.tick.ticks) return '-';
        h('span', `ad-tick ${HEALTH[g.health][1]}`, td, `${g.tick.p99Ms.toFixed(1)} ms`);
        h('i', `ad-bar ${HEALTH[g.health][1]}`, h('div', 'ad-bar-t', td)).style.width = `${Math.min(100, (g.tick.p99Ms / g.tick.budgetMs) * 100)}%`;
      },
    },
    { name: 'CPU', cls: 'ad-num', cell: (g) => `${g.cpuMs.toFixed(0)} ms/s` },
    { name: 'Memory', cls: 'ad-num', cell: (g) => `${g.heapMb.toFixed(0)} MB` },
    { name: '', cls: 'ad-act', cell: (g, td) => void Object.assign(h('a', 'ad-btn ad-btn-s', td, 'Open'), { href: `#games/${g.code}` }) },
  ]);
  const update = (s) => {
    const k = q.value.trim().toLowerCase();
    const rows = s.games.filter((g) => !k || g.code.toLowerCase().includes(k) || gameName(g).toLowerCase().includes(k));
    count.textContent = k ? `${rows.length} of ${plural(s.games.length, 'game')}` : `${plural(s.games.length, 'game')}, ${plural(s.server.players, 'player')}`;
    draw(rows, {
      emptyText: s.games.length ? 'No game matches that.' : 'No game is running. One starts when somebody presses Play, or make one under Server.',
      key: (g) => [g.code, g.name, g.inviteOnly, g.quick, g.act, g.phase, g.day, g.difficulty, g.players, g.max, g.held, g.zombies, age(g.ageS), g.tick?.p99Ms.toFixed(1), g.health, g.cpuMs.toFixed(0), g.heapMb.toFixed(0)],
    });
  };
  q.addEventListener('input', () => state && update(state));
  return { update };
}

function gameView(el, code) {
  let d = null;
  let stopped = false;
  let t = 0;
  const back = h('a', 'ad-back', el, 'All games');
  back.href = '#games';
  const head = h('header', 'ad-ghead', el);
  const title = h('h1', 'ad-ghead-t', head, code);
  const sub = h('div', 'ad-ghead-s', head);
  const warn = h('div', 'ad-banner bad', el);
  warn.hidden = true;
  const setTiles = tiles(el);
  const grid = h('div', 'st-grid ad-grid', el);
  const P = `/api/admin/games/${code}`;
  const post = (path, body, busy) => act(() => api('POST', `${P}/${path}`, body), { busy });

  // ---- players
  const playersCard = card(grid, 'Players', 'Everyone with a place in this game. A held place is a player who dropped and can still come back.', 'st-wide');
  const drawPlayers = table(playersCard, [
    {
      name: 'Player',
      cell: (p, td) => {
        h('b', 'ad-pname', td, p.name);
        if (p.admin) chip(td, 'Admin', 'moon');
      },
    },
    { name: 'Account', cell: (p, td) => void (p.guest ? chip(td, 'Guest', 'dim') : (Object.assign(h('a', 'ad-link', td, p.account), { href: `#accounts/${encodeURIComponent(p.account)}` }), undefined)) },
    { name: 'State', cell: (p, td) => void (p.held ? chip(td, `Held · ${p.held.handoff ? 'from the last server' : 'dropped'}`, 'warn') : chip(td, PLAYER_STATE[p.state][0], PLAYER_STATE[p.state][1])) },
    { name: 'Health', cls: 'ad-num', cell: (p) => (p.state === 'alive' || p.state === 'down' ? int(p.hp) : '-') },
    { name: 'Kills', cls: 'ad-num', cell: (p) => int(p.kills) },
    { name: 'Level', cls: 'ad-num', cell: (p) => p.level },
    { name: 'Ping', cls: 'ad-num', cell: (p) => (p.held || !p.ping ? '-' : `${p.ping} ms`) },
    { name: 'Address', cell: (p, td) => void (p.addr ? (h('span', 'ad-mono ad-dim', td, p.addr).title = 'Not the address: a tag that is the same for players on one address, and changes when the server restarts') : (td.textContent = '-')) },
    {
      name: '',
      cls: 'ad-act',
      cell: (p, td) =>
        void button(td, 'Remove', 'ad-btn-s ad-btn-danger', async (e) => {
          const ok = await confirmDialog({
            title: 'Remove this player?',
            target: `${p.name} · in ${gameName(d.game)} (${code})`,
            lines: [p.held ? 'Their held place is let go: they cannot come back to where they were.' : 'They are out of the game at once and sent back to the menu with your reason.', 'What they were carrying drops where they stood.', 'This is not a ban: they can join again.'],
            action: 'Remove player',
            reason: !p.held,
          });
          if (ok) post('kick', { player: p.id, reason: ok.reason }, e.target);
        }),
    },
  ]);

  // ---- a message
  const sayCard = card(grid, 'Message the players', 'A line in the chat of everyone in this game, marked [Admin].', 'st-half');
  const sayForm = h('form', 'ad-inline', sayCard);
  const sayText = input({ maxLength: catalog.limits.message, placeholder: 'The server restarts in five minutes' });
  sayForm.appendChild(sayText);
  const sayGo = Object.assign(h('button', 'ad-btn', sayForm, 'Send'), { type: 'submit' });
  sayForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!sayText.value.trim()) return sayText.focus();
    if (await post('message', { text: sayText.value }, sayGo)) sayText.value = '';
  });

  // ---- the commands
  const cmdCard = card(grid, 'Commands', 'The admin chat commands that make sense from here, run in the game as if typed. The players see a [debug] line.', 'st-half');
  const quick = h('div', 'ad-btnrow', cmdCard);
  const cmd = (name, label) => button(quick, label, '', (e) => post('command', { cmd: name }, e.target));
  const bNight = cmd('night', 'Skip to night');
  const bDay = cmd('day', 'Skip to day');
  cmd('clear', 'Clear the zombies');
  cmd('airdrop', 'Supply drop');
  cmd('unlock', 'Unlock schematics');
  cmd('parts', 'Install car parts');
  const playerSel = () => select([['', 'No players']]);
  const spawnRow = h('form', 'ad-inline ad-inline-w', cmdCard);
  const spawnType = select(catalog.zombies.map((z) => [z.key, z.boss ? `${z.name} (boss)` : z.name]), 'WALKER');
  const spawnN = input({ type: 'number', min: 1, max: catalog.limits.spawn, value: 5 });
  const spawnAt = playerSel();
  field(spawnRow, 'Spawn', spawnType);
  field(spawnRow, 'How many', spawnN);
  field(spawnRow, 'Ahead of', spawnAt);
  const spawnGo = Object.assign(h('button', 'ad-btn', spawnRow, 'Spawn'), { type: 'submit' });
  spawnRow.addEventListener('submit', (e) => (e.preventDefault(), post('command', { cmd: 'spawn', type: spawnType.value, count: +spawnN.value, player: +spawnAt.value }, spawnGo)));
  const giveRow = h('form', 'ad-inline ad-inline-w', cmdCard);
  const giveItem = select(
    catalog.items.slice().sort((a, b) => a.name.localeCompare(b.name)).map((i) => [i.key, i.name]),
    'MEDKIT'
  );
  const giveN = input({ type: 'number', min: 1, max: catalog.limits.give, value: 1 });
  const giveTo = playerSel();
  field(giveRow, 'Give', giveItem);
  field(giveRow, 'How many', giveN);
  field(giveRow, 'To', giveTo);
  const giveGo = Object.assign(h('button', 'ad-btn', giveRow, 'Give'), { type: 'submit' });
  giveRow.addEventListener('submit', (e) => (e.preventDefault(), post('command', { cmd: 'give', item: giveItem.value, count: +giveN.value, player: +giveTo.value }, giveGo)));

  // ---- the two that cannot be taken back
  const dangerCard = card(grid, 'Reset or close', 'Neither can be undone. Both are written to the audit log with your name.', 'st-wide ad-danger');
  const dz = h('div', 'ad-dz', dangerCard);
  const dzRow = (titleText, text, label, fn) => {
    const r = h('div', 'ad-dz-row', dz);
    const l = h('div', '', r);
    h('b', '', l, titleText);
    h('p', '', l, text);
    return button(r, label, 'ad-btn-danger', fn);
  };
  dzRow('Reset this game', 'A new run from day 1 in the same game. Same code, same players, a new valley. Everything built, found and carried is gone.', 'Reset game', async (e) => {
    const n = d?.players.length || 0;
    const ok = await confirmDialog({
      title: 'Reset this game?',
      target: `${gameName(d.game)} · ${code} · ${plural(n, 'player')}`,
      lines: ['The run they are on ends now and is recorded as abandoned.', 'A new run starts at once: day 1 on the island, in a new valley.', 'Everyone stays in the game and starts again with a day-1 kit. What they built, found and carried is gone.', 'The code, the name, the seats and the difficulty stay. Accounts keep their XP, perks and stats.'],
      action: 'Reset game',
    });
    if (ok) post('reset', { confirm: code }, e.target);
  });
  dzRow('Close this game', 'The game ends for everyone in it and its code stops working. The players are sent back to the menu with your reason.', 'Close game', async (e) => {
    const n = d?.game.sockets ?? 0;
    const ok = await confirmDialog({
      title: 'Close this game?',
      target: `${gameName(d.game)} · ${code} · ${plural(n, 'player')} connected`,
      lines: ['The game ends now. Its run is recorded as interrupted.', 'Everyone in it is disconnected and sent back to the menu, where they read your reason.', 'The code stops working. Nothing of the game is kept.'],
      action: 'Close game',
      reason: true,
      reasonHint: 'They see: "An admin closed this game: your reason"',
    });
    if (!ok) return;
    if (await post('close', { confirm: code, reason: ok.reason }, e.target)) location.hash = '#games';
  });

  const detailFacts = h('dl', 'ad-facts', card(grid, 'Under the hood', '', 'st-wide'));

  async function load() {
    clearTimeout(t);
    if (stopped) return;
    try {
      d = await api('GET', P);
    } catch (err) {
      if (stopped) return;
      if (err.status === 404) {
        clear(el);
        const gone = h('section', 'ad-gate', el);
        h('div', 'ad-dialog-k', gone, code);
        h('h1', 'ad-gate-t', gone, 'That game has ended');
        h('p', 'ad-gate-p', gone, 'It was closed, or it emptied and shut itself down. Its code no longer works.');
        Object.assign(h('a', 'ad-btn', gone, 'All games'), { href: '#games' });
        stopped = true;
        return;
      }
      if (err.status === 401 || err.status === 403) return gate(err);
      warn.hidden = false;
      warn.textContent = `This game could not be asked: ${err.message}`;
      t = setTimeout(load, POLL_MS);
      return;
    }
    if (stopped) return;
    draw();
    t = setTimeout(load, document.hidden ? POLL_MS * 3 : POLL_MS);
  }

  function draw() {
    const g = d.game;
    const x = d.detail;
    title.textContent = gameName(g);
    clear(sub);
    h('span', 'ad-mono ad-code', sub, g.code);
    gameChips(sub, g);
    chip(sub, DIFF[g.difficulty] || g.difficulty, 'dim');
    if (g.quick) chip(sub, 'Quick join', 'dim');
    warn.hidden = !d.error;
    if (d.error) warn.textContent = `This game is not answering (${d.error}). Its last known numbers are shown. If it stays like this, close it.`;
    const tk = g.tick;
    setTiles([
      { l: 'Players', n: `${g.players} / ${g.max}`, s: g.held ? `${plural(g.held, 'place')} held for a rejoin` : `${plural(g.sockets, 'socket')} connected`, bar: g.players / g.max },
      { l: 'Day', n: g.phase === 0 ? '-' : String(g.day), s: x ? `${PHASE[x.phase]} on the ${(ACT[x.act] || 'island').toLowerCase()} · ${span(x.timeLeft)} left` : PHASE[g.phase], cls: g.phase === 2 ? 'night' : '' },
      { l: 'Zombies', n: int(x ? x.zombies : g.zombies), s: x ? `${int(x.entities)} entities in all` : '' },
      { l: 'Tick', n: tk && tk.ticks ? `${tk.p99Ms.toFixed(1)} ms` : '-', s: tk && tk.ticks ? `mean ${tk.meanMs.toFixed(1)} · worst ${tk.maxMs.toFixed(1)} · ${tk.over} over ${tk.budgetMs} ms` : 'no ticks timed yet', bar: tk && tk.ticks ? tk.p99Ms / tk.budgetMs : undefined, cls: HEALTH[g.health][1] === 'good' ? '' : HEALTH[g.health][1] },
      { l: 'CPU', n: `${g.cpuMs.toFixed(0)} ms/s`, s: 'of its own thread', bar: g.cpuMs / 1000 },
      { l: 'Memory', n: `${g.heapMb.toFixed(0)} MB`, s: 'of 512 MB before it ends', bar: g.heapMb / 512, cls: g.heapMb > 400 ? 'warn' : '' },
      { l: 'Age', n: span(g.ageS), s: g.emptyS ? `empty for ${span(g.emptyS)}` : `made by ${g.madeBy}` },
      { l: 'Errors', n: int(g.errs), s: g.errs ? g.lastErr : 'no tick has thrown', cls: g.errs ? 'bad' : '' },
    ]);
    drawPlayers(d.players, {
      emptyText: d.error ? 'The game did not say who is in it.' : 'Nobody is in this game. It shuts itself down after a while empty.',
      key: (p) => [p.id, p.name, p.account, p.admin, p.state, p.held && p.held.handoff, Math.round(p.hp / 5), p.kills, p.level, Math.round(p.ping / 10), p.addr],
    });
    const opts = d.players.length ? d.players.map((p) => [String(p.id), p.held ? `${p.name} (held)` : p.name]) : [['', 'No players']];
    setOptions(spawnAt, opts);
    setOptions(giveTo, opts);
    const running = x && (x.phase === 1 || x.phase === 2);
    for (const b of quick.children) b.disabled = !running || !d.players.length;
    bNight.disabled = !running || x.phase !== 1 || !d.players.length;
    bDay.disabled = !running || x.phase !== 2 || !d.players.length;
    spawnGo.disabled = giveGo.disabled = !running || !d.players.length;
    clear(detailFacts);
    const fact = (k, v) => (h('dt', '', detailFacts, k), h('dd', '', detailFacts, v));
    fact('Code', g.code);
    fact('Listed', g.inviteOnly ? 'No: invite only, the link is the way in' : 'Yes: public, and a quick join can land here');
    fact('Made', `${clock(g.made)} by ${g.madeBy}`);
    fact('Match being recorded', g.match ? 'Yes' : 'No');
    if (x) {
      fact('Valley seed', String(x.seed));
      fact('Run time', span(x.runS));
      fact('Built', `${plural(x.structures, 'structure')}, ${plural(x.items, 'item')} on the ground`);
      fact('Car parts', x.need.length ? x.supplies.map((n, i) => `${n}/${x.need[i]}`).join('  ') : '-');
      if (x.stepMode) fact('Clock', 'Held by /step (a filming tool): it lets go by itself');
      if (x.godMode) fact('God mode', 'On (a test server)');
    }
    if (tk) fact('Ticks since it started', `${int(tk.overTotal)} over budget`);
  }
  load();
  return {
    refresh: load,
    stop() {
      stopped = true;
      clearTimeout(t);
    },
  };
}

// ---------------------------------------------------------------- server
VIEWS.server = (el) => {
  const grid = h('div', 'st-grid ad-grid', el);

  // ---- make a game
  const makeCard = card(grid, 'Make a game', 'It is yours to hand out: nobody is put in it until they join.', 'st-half');
  const mf = h('form', 'ad-form', makeCard);
  const mName = input({ maxLength: 28, placeholder: 'Friday night run' });
  const mSeats = input({ type: 'number', min: 1, value: 8 });
  const mDiff = select(catalog.difficulties.map((x) => [x.id, `${x.name} (${x.rank.toLowerCase()})`]), 'nightfall');
  const mInvite = select([['0', 'Public: listed, quick joins land in it'], ['1', 'Invite only: the link is the way in']], '0');
  field(mf, 'Name', mName);
  const two = h('div', 'ad-two', mf);
  field(two, 'Seats', mSeats);
  field(two, 'Difficulty', mDiff);
  field(mf, 'Who can join', mInvite);
  const mGo = Object.assign(h('button', 'ad-btn ad-btn-blood', mf, 'Make game'), { type: 'submit' });
  mf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await act(() => api('POST', '/api/admin/games', { name: mName.value, maxPlayers: +mSeats.value, difficulty: mDiff.value, inviteOnly: mInvite.value === '1' }), { busy: mGo });
    if (r) location.hash = `#games/${r.game.code}`;
  });

  // ---- everyone
  const sayCard = card(grid, 'Message everyone', 'A line in the chat of every player in every game, marked [Admin].', 'st-half');
  const sf = h('form', 'ad-form', sayCard);
  const sText = input({ maxLength: catalog.limits.message, placeholder: 'The server restarts in five minutes. Your game carries on after it.' });
  field(sf, 'Message', sText);
  const sGo = Object.assign(h('button', 'ad-btn', sf, 'Send to everyone'), { type: 'submit' });
  const sNote = h('p', 'ad-note', sayCard);
  sf.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!sText.value.trim()) return sText.focus();
    if (await act(() => api('POST', '/api/admin/server/broadcast', { text: sText.value }), { busy: sGo })) sText.value = '';
  });

  // ---- the settings
  const setCard = card(grid, 'Settings', 'Kept in the database: a change is in force on every server within a few seconds, no deploy.', 'st-wide');
  const setBox = h('div', 'ad-settings', setCard);
  const fixed = h('dl', 'ad-facts', setCard);
  let settingsSig = '';
  async function loadSettings() {
    let r;
    try {
      r = await api('GET', '/api/admin/settings');
    } catch (err) {
      return void (clear(setBox), h('div', 'ad-empty', setBox, `The settings could not be read: ${err.message}`));
    }
    const sig = JSON.stringify(r);
    if (sig === settingsSig) return;
    settingsSig = sig;
    clear(setBox);
    for (const s of r.settings) {
      const row = h('form', 'ad-setting', setBox);
      const l = h('div', 'ad-setting-l', row);
      h('b', 'ad-mono', l, s.key);
      h('p', '', l, `${s.about[0].toUpperCase()}${s.about.slice(1)}.`);
      const now = h('p', 'ad-dim', l);
      now.textContent = s.stored === null ? 'Unset: the default holds.' : `Set to ${s.stored}, ${ago(s.updatedAt)}.`;
      if (s.inForce !== s.stored) h('p', 'ad-warn-t', l, `This server is still going by ${s.inForce ?? 'the default'}.`);
      const v = input({ type: 'number', min: 0, max: s.max ?? undefined, step: 1, placeholder: 'unset', value: s.stored ?? '' });
      const ctl = h('div', 'ad-setting-c', row);
      ctl.appendChild(v);
      const save = Object.assign(h('button', 'ad-btn', ctl, 'Save'), { type: 'submit' });
      const unset = button(ctl, 'Unset', 'ad-btn-s', () => put(null, unset));
      unset.disabled = s.stored === null;
      const err = h('div', 'ad-gate-e', row);
      const put = async (value, busy) => {
        err.textContent = '';
        const ok = await act(() => api('PUT', `/api/admin/settings/${s.key}`, { value }), { busy });
        if (ok) loadSettings();
      };
      row.addEventListener('submit', (e) => {
        e.preventDefault();
        const n = Number(v.value);
        if (v.value.trim() === '' || !Number.isInteger(n) || n < 0 || (s.max && n > s.max)) return void (err.textContent = `A whole number from 0 to ${int(s.max || 0)}.`);
        put(n, save);
      });
    }
    clear(fixed);
    const fact = (k, val) => (h('dt', '', fixed, k), h('dd', '', fixed, val));
    fact('Games this server runs at once', `${r.fixed.maxGames} (MAX_GAMES: set by the host, changed by a deploy)`);
    fact('Seats in a game', `${r.fixed.defaultPlayers} unless its maker picks, ${r.fixed.maxPlayers} at most`);
    fact('An empty game shuts down after', span(r.fixed.idleS));
    fact('Per-address limits', r.fixed.limits ? 'On' : 'Off (a load-test server)');
  }
  loadSettings();

  // ---- the heavy ones
  const dangerCard = card(grid, 'Stop, close, restart', 'Each is written to the audit log with your name.', 'st-wide ad-danger');
  const dz = h('div', 'ad-dz', dangerCard);
  const dzRow = () => {
    const r = h('div', 'ad-dz-row', dz);
    const l = h('div', '', r);
    return { r, l, t: h('b', '', l), p: h('p', '', l) };
  };
  const drain = dzRow();
  const drainB = button(drain.r, '', '', async (e) => {
    const on = !state.server.draining;
    if (on) {
      const ok = await confirmDialog({
        title: 'Stop new games?',
        target: state.server.clustered ? `Server ${state.server.id}` : 'This server',
        lines: ['Nobody can make a game here, and a quick join with no game to go to is turned away.', `The ${plural(state.server.games, 'game')} running carry on, and can still be joined.`, 'It holds until you resume, or until the server restarts.'],
        action: 'Stop new games',
      });
      if (!ok) return;
    }
    act(() => api('POST', '/api/admin/server/drain', { on }), { busy: e.target });
  });
  const closeAll = dzRow();
  closeAll.t.textContent = 'Close every game';
  const closeB = button(closeAll.r, 'Close every game', 'ad-btn-danger', async (e) => {
    const ok = await confirmDialog({
      title: 'Close every game?',
      target: `${plural(state.server.games, 'game')} · ${plural(state.server.players, 'player')}${state.server.clustered ? ` · on ${state.server.id}` : ''}`,
      lines: ['Every game on this server ends now. Each run is recorded as interrupted.', 'Every player is disconnected and sent back to the menu with your reason.', 'New games can still be made afterwards, unless you stop them first.'],
      action: 'Close every game',
      word: 'CLOSE ALL',
      reason: true,
    });
    if (ok) act(() => api('POST', '/api/admin/server/close-all', { confirm: 'CLOSE ALL', reason: ok.reason }), { busy: e.target });
  });
  const restart = dzRow();
  restart.t.textContent = 'Restart the server';
  const restartB = button(restart.r, 'Restart server', 'ad-btn-danger', async (e) => {
    const ok = await confirmDialog({
      title: 'Restart the server?',
      target: `${plural(state.server.games, 'game')} · ${plural(state.server.players, 'player')}${state.server.clustered ? ` · on ${state.server.id}` : ''}`,
      lines: ['Every game with players is saved and handed over, as on a deploy. Their players see "Server updating".', 'The server process then exits. The host has to start it again: until it is back, nobody can play.', 'Players are put back in their games when it is up. If it takes over 45 seconds, they are dropped to the menu.', 'This page stops answering until the server is back.'],
      action: 'Restart server',
      word: 'RESTART',
    });
    if (ok) act(() => api('POST', '/api/admin/server/restart', { confirm: 'RESTART' }), { busy: e.target });
  });

  return {
    update(s) {
      const sv = s.server;
      sNote.textContent = `${plural(sv.players, 'player')} in ${plural(sv.games, 'game')} would read it${sv.clustered ? ', on every server' : ''}.`;
      mSeats.max = sv.maxPlayers;
      if (!mSeats._set) {
        mSeats._set = true;
        mSeats.value = sv.defaultPlayers;
      }
      mGo.disabled = sv.draining || sv.stopping;
      drain.t.textContent = sv.draining ? 'New games are stopped' : 'Stop new games';
      drain.p.textContent = sv.draining ? 'Nobody can make a game here. The games running carry on and can be joined. Resume to let games be made again.' : 'Nobody can make a game here from then on; the games running carry on and can still be joined. For winding a server down gently.';
      drainB.textContent = sv.draining ? 'Resume new games' : 'Stop new games';
      drainB.className = `ad-btn ${sv.draining ? 'ad-btn-blood' : 'ad-btn-danger'}`;
      drainB.disabled = sv.stopping;
      closeAll.p.textContent = `Ends ${sv.games === 1 ? 'the one game' : `all ${sv.games} games`} on this server and sends ${plural(sv.players, 'player')} back to the menu with your reason.`;
      closeB.disabled = !sv.games;
      restart.p.textContent = sv.restart.available ? 'Hands every game over as a deploy does, then exits for the host to start the server again. Players are away until it is back.' : `Not available: ${sv.restart.why}`;
      restartB.disabled = !sv.restart.available;
    },
    refresh: loadSettings,
  };
};

// ---------------------------------------------------------------- accounts
VIEWS.accounts = (el, first) => {
  const bar = h('form', 'ad-toolbar', el);
  const q = input({ placeholder: 'Find an account by name', type: 'search', maxLength: 32, value: first || '' });
  bar.appendChild(q);
  Object.assign(h('button', 'ad-btn', bar, 'Search'), { type: 'submit' });
  const count = h('span', 'ad-toolbar-n', bar);
  const box = h('section', 'st-card ad-card', el);
  const note = h('p', 'ad-note', el, 'Granting or removing admin access ends that account’s sign-ins: they sign in again and have the new role. Nobody can remove their own admin access, so the game always has an admin. From a shell: npm run admin -- <name> on.');
  note.hidden = false;
  let admins = 0;
  const draw = table(box, [
    {
      name: 'Account',
      cell: (a, td) => {
        h('b', 'ad-pname', td, a.username);
        if (a.isAdmin) chip(td, 'Admin', 'moon');
        if (a.id === me.id) chip(td, 'You', 'dim');
      },
    },
    { name: 'Playing', cell: (a, td) => void (a.game ? Object.assign(h('a', 'ad-link ad-mono', td, a.game), { href: `#games/${a.game}` }) : (td.textContent = '-')) },
    { name: 'Signed in on', cls: 'ad-num', cell: (a) => plural(a.sessions, 'browser') },
    { name: 'Last seen', cell: (a) => ago(a.lastSeenAt || a.lastLoginAt) },
    { name: 'Joined', cell: (a) => clock(a.createdAt).slice(0, 10) },
    {
      name: '',
      cls: 'ad-act',
      cell: (a, td) => {
        const self = a.id === me.id;
        const role = button(td, a.isAdmin ? 'Remove admin' : 'Make admin', `ad-btn-s ${a.isAdmin ? 'ad-btn-danger' : ''}`, async (e) => {
          const ok = await confirmDialog(
            a.isAdmin
              ? { title: 'Remove admin access?', target: a.username, lines: ['They lose the control room and the admin commands in games, at once.', 'Their sign-ins are ended: they have to sign in again.', `${admins - 1 === 1 ? 'One admin is' : `${admins - 1} admins are`} left afterwards.`], action: 'Remove admin' }
              : { title: 'Make this account an admin?', target: a.username, lines: ['They can do everything on this page: close games, remove players, change settings, make and remove other admins.', 'They get the admin commands and the spawn menu in every game.', 'Their sign-ins are ended: they have to sign in again to get it.'], action: 'Make admin' }
          );
          if (ok && (await act(() => api('POST', `/api/admin/accounts/${a.id}/admin`, { on: !a.isAdmin }), { busy: e.target }))) load();
        });
        if (self && a.isAdmin) {
          role.disabled = true;
          role.title = 'Nobody removes their own admin access: another admin has to';
        }
        const end = button(td, 'End sign-ins', 'ad-btn-s', async (e) => {
          const ok = await confirmDialog({ title: 'End this account’s sign-ins?', target: `${a.username} · ${plural(a.sessions, 'browser')}`, lines: [self ? 'That is you: this page signs out too.' : 'Every browser signed in to it has to sign in again.', 'A game they are playing in right now goes on.', 'It does not stop them signing in again: it is not a ban.'], action: 'End sign-ins' });
          if (ok && (await act(() => api('POST', `/api/admin/accounts/${a.id}/sessions/end`, {}), { busy: e.target }))) self ? start() : load();
        });
        end.disabled = !a.sessions;
      },
    },
  ]);
  let n = 0;
  async function load() {
    const mine = ++n;
    try {
      const r = await api('GET', `/api/admin/accounts?q=${encodeURIComponent(q.value.trim())}`);
      if (mine !== n) return;
      admins = r.admins;
      count.textContent = r.q ? `${plural(r.accounts.length, 'account')}${r.more ? ', and more: narrow it down' : ''}` : `${plural(r.admins, 'admin')} · the admins first, then whoever was here last`;
      draw(r.accounts, { emptyText: `No account has "${r.q}" in its name.`, key: (a) => [a.id, a.username, a.isAdmin, a.game, a.sessions, ago(a.lastSeenAt || a.lastLoginAt)] });
    } catch (err) {
      if (err.status === 401 || err.status === 403) return gate(err);
      count.textContent = err.message;
    }
  }
  bar.addEventListener('submit', (e) => (e.preventDefault(), load()));
  load();
  return { refresh: load };
};

// ---------------------------------------------------------------- the audit log
VIEWS.audit = (el) => {
  const bar = h('div', 'ad-toolbar', el);
  h('span', 'ad-toolbar-n', bar, 'Everything done from this page: who, when, to what, and how it went. Looking is not recorded.');
  const box = h('section', 'st-card ad-card', el);
  const detailText = (a) => {
    const d = a.detail || {};
    const bits = [];
    if (d.reason) bits.push(`"${d.reason}"`);
    if (d.text) bits.push(`"${d.text}"`);
    if (d.cmd) bits.push([d.cmd, d.type || d.item, d.count].filter((v) => v !== undefined).join(' ').toLowerCase());
    if (d.name && a.action !== 'game.create') bits.push(d.name);
    if (a.action === 'game.create') bits.push(`${d.name || 'unnamed'}, ${d.maxPlayers} seats, ${DIFF[d.difficulty] || d.difficulty}${d.inviteOnly ? ', invite only' : ''}`);
    if (a.action === 'setting.set') bits.push(d.value === null ? 'unset' : `to ${d.value}`);
    if (a.action === 'server.drain') bits.push(d.on ? 'stopped' : 'resumed');
    if (a.action === 'account.admin') bits.push(d.on ? 'granted' : 'removed');
    return bits.join(' · ');
  };
  const draw = table(box, [
    { name: 'When', cls: 'ad-mono', cell: (a) => clock(a.at) },
    { name: 'Admin', cell: (a, td) => void h('b', '', td, a.admin) },
    { name: 'Did', cell: (a) => ACTION[a.action] || a.action },
    { name: 'To', cell: (a, td) => void (a.target ? h('span', /^[A-Z2-9]{6,10}$/.test(a.target) || a.action === 'setting.set' ? 'ad-mono' : '', td, a.target) : (td.textContent = a.server || 'the server')) },
    { name: 'With', cls: 'ad-wrap', cell: (a) => detailText(a) || '-' },
    {
      name: 'Outcome',
      cls: 'ad-wrap',
      cell: (a, td) => {
        const o = h('div', 'ad-out', td);
        chip(o, a.ok ? 'Done' : 'Refused', a.ok ? 'good' : 'bad');
        h('span', 'ad-outcome', o, a.result);
      },
    },
  ]);
  let rows = [];
  let more = false;
  const older = button(el, 'Older', 'ad-btn-s ad-older', async () => {
    const r = await api('GET', `/api/admin/audit?before=${rows[rows.length - 1].id}`).catch(() => null);
    if (!r) return;
    rows = rows.concat(r.rows);
    more = r.more;
    show();
  });
  const show = () => {
    draw(rows, { emptyText: 'Nothing has been done from the control room yet.', key: (a) => a.id });
    older.hidden = !more;
  };
  async function load() {
    try {
      const r = await api('GET', '/api/admin/audit');
      // (the newest page again; whatever older pages were opened stay under it)
      const seen = new Set(r.rows.map((a) => a.id));
      const rest = rows.filter((a) => !seen.has(a.id) && a.id < (r.rows[r.rows.length - 1]?.id ?? Infinity));
      more = rest.length ? more : r.more;
      rows = r.rows.concat(rest);
      show();
    } catch (err) {
      if (err.status === 401 || err.status === 403) return gate(err);
    }
  }
  load();
  const t = setInterval(() => document.hidden || load(), POLL_MS * 2);
  return { refresh: load, stop: () => clearInterval(t) };
};

start();
