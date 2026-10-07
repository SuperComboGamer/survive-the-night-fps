// The admin panel's API (/api/admin/*; the page is client/admin.html, served at /admin): what the people who run the
// game see and do from outside it - the server, its games and their players, the settings kept in the database, the
// accounts, and a record of everything done here. docs/admin-panel.md says what each action does.
//
// WHO MAY. Every route goes through guard() first, and nothing else decides:
//   - the request came from a page of ours: Origin (when the browser sends one) names this host, Sec-Fetch-Site (when
//     the browser sends it) says same-origin, and the X-STN-Admin header is there - a header a page on another site
//     cannot add without asking this server first (a CORS preflight, which nothing here answers);
//   - the server has accounts at all (a database): without one there are no admins, and every route is a 503;
//   - the session cookie signs in an account whose admin flag is set, read from the database on this very request
//     (Auth.userForToken(token, true): never the minute's cache), so a revoked admin or a signed-out browser is
//     refused at once.
// Everything that changes something is a POST or PUT with a JSON body (http.js api: a form on another site cannot
// send one), is counted against the admin's allowance, and is written to admin_audit - done or refused - with who
// did it. Looking is not recorded.
//
// WHAT GOES OUT. Names players play under, account ids and names, game codes (invite-only ones too: an admin can
// close any game), timings. Never an email address, a password hash, a session token, a guest's browser id or an
// address: two players on one address are shown as the same short tag (addrTag), which says nothing of the address.
//
// A game is asked through its worker's message channel (Room.ask -> gameadmin.js), which checks everything again on
// its side; a worker that does not answer is an answer ("did not answer in time"), never a hang or a crash here.
import { createHash, randomBytes } from 'node:crypto';
import { HttpError, sameOrigin } from './http.js';
import { COOKIE } from './auth.js';
import { Allowance } from './allowance.js';
import { CODE_RE } from './rooms.js';
import { SETTINGS } from './serversettings.js';
import { setAdminById, AdminRuleError } from './admin.js';
import { COMMANDS, ZOMBIE_KEYS, ITEM_KEYS, SPAWN_MAX, GIVE_MAX, cleanText } from './gameadmin.js';
import { ZTYPE, ZOMBIE_DEFS, ITEM, ITEM_DEFS } from '../shared/defs.js';
import { DIFFICULTIES, chosenDifficulty } from '../shared/difficulty.js';
import { ENDED_CODE, PROTOCOL_VERSION } from '../shared/protocol.js';
import { PHASE } from '../shared/constants.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MESSAGE_MAX = 200; // a message to players (a chat line is 140; "[Admin] " and a little more)
const REASON_MAX = 100; // why a game was closed or a player removed (it has to fit a close frame: rooms.js closeReason)
const INCIDENTS_MAX = 50;
const AUDIT_PAGE = 50;
const ACCOUNTS_MAX = 25;
const RESET_WAIT_MS = 10_000; // a reset deals a new valley: a few hundred ms, seconds on a loaded box
export const RESTART_EXIT_CODE = 75; // (not 0: a supervisor that restarts "on failure" has to see one)

const bad = (message, extra) => new HttpError(400, message, extra);

export class AdminPanel {
  // auth, db, settings, social: null without a database. cluster: null on a server on its own. store: where games are
  // handed to the next server (handoff.js), null when a restart would end them. info: { build, clientBuild, port }.
  // net(): { cpuMs, elu, sockets } of the network thread. stopping(): the server is going down.
  // restart(code): hands the games over and exits with that code (index.js shutdown).
  constructor({ auth, db, lobby, cluster = null, settings = null, social = null, store = null, info = {}, net = () => ({}), stopping = () => false, restart = null, log = () => {} }) {
    this.auth = auth;
    this.db = db;
    this.lobby = lobby;
    this.cluster = cluster;
    this.settings = settings;
    this.social = social;
    this.store = store;
    this.info = info;
    this.net = net;
    this.stopping = stopping;
    this.restart = restart;
    this.log = log;
    this.startedAt = Date.now();
    // every request, by address, before the database is asked who it is (a flood of guesses costs a lookup each)...
    this.byAddress = new Allowance(300, 0.2);
    // ...and what an admin changes: 60 in a row, then one every 2 s
    this.writes = new Allowance(60, 2);
    this.salt = randomBytes(16); // for addrTag: new every start, so a tag cannot be matched to an address later
    this.incidents = []; // games that crashed, stopped by themselves or could not be restored: the newest last
    this.dbCheck = { at: 0, ok: null, ms: 0 };
    lobby.onIncident = (i) => {
      this.incidents.push({ at: Date.now(), code: String(i.code), kind: String(i.kind), text: String(i.text || '') });
      if (this.incidents.length > INCIDENTS_MAX) this.incidents.shift();
    };
    // what the other servers of a cluster do when an admin does it here
    cluster?.on('admin_say', (m) => this.sayEverywhere(cleanText(m.text, MESSAGE_MAX)));
    cluster?.on('admin_signout', (m) => UUID_RE.test(String(m.user)) && this.forget(m.user));
    cluster?.on('admin_role', (m) => UUID_RE.test(String(m.user)) && this.roleChanged(m.user, m.isAdmin === true));
  }

  // ---------------------------------------------------------------- who may
  // -> the admin behind this request, { id, name, isAdmin: true }, or throws what the route answers
  async guard(ctx, { write = false } = {}) {
    if (!sameOrigin(ctx.origin, ctx.host) || (ctx.site && ctx.site !== 'same-origin') || ctx.panel !== '1') throw new HttpError(403, 'Not from the admin panel.');
    if (!this.auth) throw new HttpError(503, 'This server has no database, so it has no accounts and no admins.', { accounts: false });
    if (!this.byAddress.take(ctx.ip || '-')) throw new HttpError(429, 'Too many requests. Wait a moment.');
    const me = await this.auth.userForToken(ctx.cookies[COOKIE], true);
    if (!me) throw new HttpError(401, 'Sign in first.');
    if (!me.isAdmin) throw new HttpError(403, 'Only an admin can use this.');
    if (write && !this.writes.take(me.id)) throw new HttpError(429, 'You are changing things very fast. Wait a few seconds.');
    return me;
  }

  // ---------------------------------------------------------------- the record
  // Never throws: an action that was done stays done, and a row that could not be written is said in the log.
  async audit(me, { action, target = '', detail = {} }, ok, result) {
    try {
      await this.db.query('INSERT INTO admin_audit (admin_id, admin_name, action, target, detail, ok, result, server_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)', [me.id, me.name, action, String(target).slice(0, 80), JSON.stringify(detail), !!ok, String(result || '').slice(0, 300), this.cluster?.id || '']);
      return true;
    } catch (err) {
      console.error(`[admin] ${me.name} ${action} ${target}: ${ok ? 'done' : 'refused'} (${result}) - NOT written to the audit log: ${err.message}`);
      return false;
    }
  }

  // ---------------------------------------------------------------- the routes
  // route: index.js's (method, path, fn, opts)
  routes(route) {
    const see = (path, fn) => route('get', path, async (ctx) => ({ body: await fn(ctx, await this.guard(ctx)) }));
    // An action: fn(ctx, body, me, entry) fills entry.target / entry.detail as soon as it knows them (so a refusal is
    // recorded with what was aimed at) and returns { result (for the record), ...what the panel is told }
    const act = (method, path, action, fn) =>
      route(
        method,
        path,
        async (ctx, b) => {
          const me = await this.guard(ctx, { write: true });
          const entry = { action, target: '', detail: {} };
          let out;
          try {
            out = await fn(ctx, b, me, entry);
          } catch (err) {
            await this.audit(me, entry, false, err instanceof HttpError ? err.message : 'failed: something went wrong on the server');
            throw err;
          }
          const { result = 'done', after = null, ...body } = out || {};
          const audited = await this.audit(me, entry, true, result);
          after?.(); // (what must only happen once the record is written: the restart)
          return { body: { ok: true, result, audited, ...body } };
        },
        { body: true, max: 2048 }
      );

    see('/api/admin/state', (ctx, me) => this.state(me));
    see('/api/admin/catalog', () => this.catalog());
    see('/api/admin/games/:code', (ctx) => this.gameDetail(this.room(ctx.params[0])));
    see('/api/admin/settings', () => this.settingsView());
    see('/api/admin/accounts', (ctx) => this.accounts(ctx.query.get('q')));
    see('/api/admin/audit', (ctx) => this.auditPage(ctx.query.get('before')));

    // ---- games
    act('post', '/api/admin/games', 'game.create', async (ctx, b, me, entry) => {
      if (this.stopping()) throw new HttpError(409, 'The server is going down.');
      const name = typeof b.name === 'string' ? b.name.trim().slice(0, 28) : '';
      const maxPlayers = b.maxPlayers === undefined ? this.lobby.maxPlayers : b.maxPlayers;
      if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > this.lobby.roomMaxPlayers) throw bad(`A game has 1 to ${this.lobby.roomMaxPlayers} seats.`);
      const difficulty = chosenDifficulty(b.difficulty);
      if (!difficulty) throw bad('Pick easy, standard, or hard.');
      if (b.inviteOnly !== undefined && typeof b.inviteOnly !== 'boolean') throw bad('inviteOnly is true or false.');
      entry.detail = { name, maxPlayers, difficulty, inviteOnly: b.inviteOnly === true };
      if (this.lobby.closedToNew) throw new HttpError(409, 'New games are stopped on this server. Resume them first.');
      // (no maker: an admin's game does not count as their one game, and is not held to an address's allowance)
      const made = await this.lobby.make({ name, host: me.name, inviteOnly: b.inviteOnly === true, maxPlayers, difficulty });
      if (made.error) throw new HttpError(made.status || 503, made.error);
      await made.room.up;
      entry.target = made.room.code;
      return { result: `made, ${made.room.inviteOnly ? 'invite only' : 'public'}, ${maxPlayers} seats`, game: this.gameRow(made.room) };
    });

    const gameAct = (path, action, fn) =>
      act('post', `/api/admin/games/:code/${path}`, action, async (ctx, b, me, entry) => {
        const code = String(ctx.params[0] || '').toUpperCase();
        entry.target = CODE_RE.test(code) ? code : '';
        return fn(this.room(code), b, me, entry);
      });

    // a line in the chat of everyone in the game
    gameAct('message', 'game.message', async (room, b, me, entry) => {
      const text = this.text(b.text, MESSAGE_MAX, 'Write a message.');
      entry.detail = { text };
      const r = this.answer(await room.ask('say', { text }));
      return { result: `said to ${r.players} player${r.players === 1 ? '' : 's'}` };
    });

    // a new run in the same game (gameadmin.js reset says exactly what that is)
    gameAct('reset', 'game.reset', async (room, b, me, entry) => {
      this.confirmed(b, room.code);
      const r = this.answer(await room.ask('reset', {}, RESET_WAIT_MS));
      if (r.note) return { result: r.note };
      entry.detail = { wasDay: r.was.day, players: r.players };
      return { result: `a new run from day 1 for ${r.players} player${r.players === 1 ? '' : 's'} (it was day ${r.was.day})` };
    });

    // the game ends: its match is written as it stands, every socket is closed with the reason, the code is gone
    gameAct('close', 'game.close', async (room, b, me, entry) => {
      const reason = this.reason(b.reason);
      entry.detail = { reason };
      this.confirmed(b, room.code);
      const n = await this.closeRoom(room, reason);
      return { result: `closed with ${n} connected` };
    });

    gameAct('kick', 'game.kick', async (room, b, me, entry) => {
      const player = this.playerId(b.player);
      const reason = this.reason(b.reason);
      entry.detail = { player, reason };
      const r = this.answer(await room.ask('kick', { player, why: reason }));
      entry.detail.name = r.name;
      return { result: `${r.name} removed${r.held ? ' (their held place)' : ''}` };
    });

    // one of the admin chat commands that make sense from outside a game (gameadmin.js COMMANDS)
    gameAct('command', 'game.command', async (room, b, me, entry) => {
      const cmd = typeof b.cmd === 'string' ? b.cmd : '';
      if (!Object.hasOwn(COMMANDS, cmd)) throw bad('No such command.');
      const m = { cmd };
      if (COMMANDS[cmd].player) m.player = this.playerId(b.player);
      if (cmd === 'spawn') {
        m.type = typeof b.type === 'string' ? b.type.toUpperCase() : '';
        if (!ZOMBIE_KEYS.includes(m.type)) throw bad('No such zombie type.');
        m.count = this.count(b.count, SPAWN_MAX);
      }
      if (cmd === 'give') {
        m.item = typeof b.item === 'string' ? b.item.toUpperCase() : '';
        if (!ITEM_KEYS.includes(m.item)) throw bad('No such item.');
        m.count = this.count(b.count, GIVE_MAX);
      }
      entry.detail = m;
      const r = this.answer(await room.ask('command', m));
      return { result: `ran "${r.ran}" as ${r.as}` };
    });

    // ---- the server
    act('post', '/api/admin/server/broadcast', 'server.broadcast', async (ctx, b, me, entry) => {
      const text = this.text(b.text, MESSAGE_MAX, 'Write a message.');
      entry.detail = { text };
      const n = await this.sayEverywhere(text);
      this.cluster?.publish({ t: 'admin_say', text });
      return { result: `said in ${n} game${n === 1 ? '' : 's'}${this.cluster ? ' here, and passed to the other servers' : ''}` };
    });

    // { on: true } no new games are made here (those running carry on and can be joined); { on: false } they are again
    act('post', '/api/admin/server/drain', 'server.drain', async (ctx, b, me, entry) => {
      if (typeof b.on !== 'boolean') throw bad('on is true or false.');
      entry.detail = { on: b.on };
      if (this.stopping()) throw new HttpError(409, 'The server is going down.');
      this.lobby.closedToNew = b.on;
      this.log(`admin ${me.name}: new games ${b.on ? 'stopped' : 'resumed'}`);
      return { result: b.on ? 'no new games from now on' : 'new games again', draining: b.on };
    });

    act('post', '/api/admin/server/close-all', 'server.close_all', async (ctx, b, me, entry) => {
      const reason = this.reason(b.reason);
      entry.detail = { reason };
      this.confirmed(b, 'CLOSE ALL');
      const rooms = [...this.lobby.rooms.values()];
      const counts = await Promise.all(rooms.map((room) => this.closeRoom(room, reason)));
      entry.detail.games = rooms.map((r) => r.code);
      return { result: `${rooms.length} game${rooms.length === 1 ? '' : 's'} closed, ${counts.reduce((a, b2) => a + b2, 0)} connected` };
    });

    // Hands every game over as a deploy does and exits, for the host to start the server again (docs/admin-panel.md)
    act('post', '/api/admin/server/restart', 'server.restart', async (ctx, b, me, entry) => {
      const can = this.restartInfo();
      if (!can.available) throw new HttpError(409, can.why);
      this.confirmed(b, 'RESTART');
      entry.detail = { games: this.lobby.rooms.size, players: this.lobby.players() };
      this.log(`admin ${me.name}: restart asked for`);
      return { result: `handing ${this.lobby.rooms.size} game(s) over and exiting with code ${RESTART_EXIT_CODE}`, after: () => setTimeout(() => this.restart(RESTART_EXIT_CODE), 250) };
    });

    // ---- the settings in the database (serversettings.js)
    act('put', '/api/admin/settings/:key', 'setting.set', async (ctx, b, me, entry) => {
      const key = ctx.params[0];
      if (!Object.hasOwn(SETTINGS, key)) throw new HttpError(404, 'No such setting.');
      entry.target = key;
      if (!('value' in b)) throw bad('Give a value (null to unset it).');
      const value = b.value;
      entry.detail = { value: typeof value === 'number' || value === null ? value : String(JSON.stringify(value)).slice(0, 60) };
      const before = this.settings.values[key];
      if (value === null) await this.db.query('DELETE FROM server_settings WHERE key = $1', [key]);
      else {
        const s = SETTINGS[key];
        if (s.parse(value) === undefined || (typeof value === 'number' && value > (s.max ?? Infinity))) throw bad(`That is not a value for ${key}: ${s.about}.`, { field: key });
        await this.db.query(`INSERT INTO server_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, JSON.stringify(value)]);
      }
      await this.settings.refresh(); // (in force here now; the other servers and the proxy read it within a few seconds)
      entry.detail.before = before;
      return { result: value === null ? `unset (was ${before ?? 'unset'})` : `set to ${value} (was ${before ?? 'unset'})`, settings: (await this.settingsView()).settings };
    });

    // ---- accounts
    const accountAct = (path, action, fn) =>
      act('post', `/api/admin/accounts/:id/${path}`, action, async (ctx, b, me, entry) => {
        const id = String(ctx.params[0] || '').toLowerCase();
        if (!UUID_RE.test(id)) throw new HttpError(404, 'No such account.');
        entry.target = id;
        entry.detail = { id };
        // (the record names the account, whatever comes of it)
        const u = (await this.db.query('SELECT username FROM users WHERE id = $1', [id])).rows[0];
        if (!u) throw new HttpError(404, 'No such account.');
        entry.target = u.username;
        return fn(id, b, me, entry, u);
      });

    // { on } gives or takes the admin flag. Never your own, never the last one (admin.js setAdminById)
    accountAct('admin', 'account.admin', async (id, b, me, entry) => {
      if (typeof b.on !== 'boolean') throw bad('on is true or false.');
      entry.detail = { id, on: b.on };
      let u;
      try {
        u = await setAdminById(this.db, me.id, id, b.on);
      } catch (err) {
        if (!(err instanceof AdminRuleError)) throw err;
        throw new HttpError(err.rule === 'gone' ? 404 : err.rule === 'actor' ? 403 : 409, err.message, { rule: err.rule });
      }
      if (!u.changed) return { result: `${u.username} already ${b.on ? 'was' : 'was not'} an admin` };
      this.forget(id);
      this.roleChanged(id, b.on);
      this.cluster?.publish({ t: 'admin_signout', user: id });
      this.cluster?.publish({ t: 'admin_role', user: id, isAdmin: b.on });
      this.log(`admin ${me.name}: ${u.username} is ${b.on ? 'now' : 'no longer'} an admin`);
      return { result: `${u.username} is ${b.on ? 'now' : 'no longer'} an admin; their sign-ins were ended` };
    });

    // every browser signed in to the account has to sign in again (a game it is playing in goes on)
    accountAct('sessions/end', 'account.sessions_end', async (id, b, me, entry, u) => {
      const gone = await this.db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
      this.forget(id);
      this.cluster?.publish({ t: 'admin_signout', user: id });
      return { result: `${gone.rowCount} sign-in${gone.rowCount === 1 ? '' : 's'} of ${u.username} ended`, self: id === me.id };
    });
  }

  // ---------------------------------------------------------------- what a request may carry
  room(code) {
    code = String(code || '').toUpperCase();
    const room = CODE_RE.test(code) ? this.lobby.rooms.get(code) : null;
    if (!room || room.closed) throw new HttpError(404, 'No game goes by that code on this server. It may have ended.');
    return room;
  }
  text(v, max, empty) {
    if (typeof v !== 'string') throw bad(empty);
    if (v.length > max * 4) throw bad(`At most ${max} characters.`);
    const text = cleanText(v, max + 1);
    if (!text) throw bad(empty);
    if (text.length > max) throw bad(`At most ${max} characters.`);
    return text;
  }
  // a reason is optional: '' when none was given
  reason(v) {
    if (v === undefined || v === null || v === '') return '';
    return this.text(v, REASON_MAX, 'A reason is a line of text.');
  }
  playerId(v) {
    if (!Number.isInteger(v) || v < 1 || v > 65535) throw bad('Which player?');
    return v;
  }
  count(v, max) {
    if (!Number.isInteger(v) || v < 1 || v > max) throw bad(`A whole number from 1 to ${max}.`);
    return v;
  }
  // A destructive action names what it is aimed at a second time, in its body: a request built for one game cannot
  // land on another, and nothing destructive happens on a bare POST
  confirmed(b, word) {
    if (b.confirm !== word) throw bad(`To confirm, send confirm: "${word}".`, { confirm: word });
  }
  // a worker's answer, or the error it gave as this route's
  answer(r) {
    if (r?.ok) return r;
    throw new HttpError(r?.timeout ? 503 : 409, r?.error || 'The game refused.');
  }

  // ---------------------------------------------------------------- doing
  // -> how many sockets it had
  async closeRoom(room, reason) {
    const n = room.open;
    await room.finish(1500); // (the match being played is ended as it stands and written, as when a server goes down)
    room.shut(ENDED_CODE, reason ? `An admin closed this game: ${reason}` : 'An admin closed this game.');
    this.log(`game ${room.code} closed by an admin${reason ? ` (${reason})` : ''}`);
    return n;
  }
  // -> how many games heard it
  async sayEverywhere(text) {
    if (!text) return 0;
    const said = await Promise.all([...this.lobby.rooms.values()].map((room) => room.ask('say', { text })));
    return said.filter((r) => r.ok).length;
  }
  // an account's sign-ins were ended: what this server remembers of them goes, and its /social sockets close
  forget(userId) {
    if (this.auth) for (const [hash, hit] of this.auth.cache) if (hit.user?.id === userId) this.auth.cache.delete(hash);
    for (const ws of [...(this.social?.socks.get(userId) || [])]) {
      try {
        ws.end(4001, 'Signed out');
      } catch {}
    }
  }
  // an account's admin flag changed: the games it is playing in here know at once (the chat commands, the spawn menu's
  // requests), not at its next connection
  roleChanged(userId, isAdmin) {
    for (const room of this.lobby.playing.get(userId)?.keys() || []) {
      for (const u of room.users) if (u && u.id === userId) u.isAdmin = isAdmin;
      room.ask('role', { user: userId, isAdmin });
    }
  }

  // ---------------------------------------------------------------- seeing
  addrTag(ip) {
    return ip ? createHash('sha256').update(this.salt).update(String(ip)).digest('hex').slice(0, 6) : '';
  }
  restartInfo() {
    if (!this.restart) return { available: false, why: 'This server cannot restart itself.' };
    if (process.env.ADMIN_RESTART !== '1') return { available: false, why: 'Off on this server. The host has to say it starts the server again after it exits: set ADMIN_RESTART=1 (docs/admin-panel.md says what that relies on).' };
    if (!this.store) return { available: false, why: 'This server has nowhere to hand its games to (no database and no HANDOFF_DIR): a restart would end every game.' };
    if (this.stopping()) return { available: false, why: 'The server is already going down.' };
    return { available: true, why: '' };
  }

  gameRow(room) {
    const s = room.st;
    const w = s.tick?.window;
    const budget = s.tick?.budgetMs || 50;
    const p99 = w?.p99Ms || 0;
    return {
      code: room.code,
      name: room.title,
      inviteOnly: room.inviteOnly,
      quick: !!room.quick,
      difficulty: room.difficulty,
      players: Math.max(0, s.players || 0),
      held: s.held || 0,
      sockets: room.open,
      max: room.maxPlayers,
      phase: s.phase,
      day: s.day,
      act: s.act || 1,
      zombies: s.zombies || 0,
      ageS: Math.round((Date.now() - room.created) / 1000),
      emptyS: room.open || !room.emptySince ? 0 : Math.round((Date.now() - room.emptySince) / 1000),
      ready: room.ready,
      match: !!room.match,
      tick: w ? { meanMs: w.meanMs, p99Ms: w.p99Ms, maxMs: w.maxMs, over: w.over, ticks: w.ticks, budgetMs: budget, overTotal: s.tick.sinceBoot?.over || 0 } : null,
      cpuMs: s.load?.cpuMs || 0,
      heapMb: s.heapMb || 0,
      errs: s.errs || 0,
      lastErr: s.lastErr || '',
      // ok, slow (the worst tick of 100 is over half the budget), late (over the budget), errors (ticks are throwing)
      health: s.errs ? 'errors' : p99 > budget ? 'late' : p99 > budget / 2 ? 'slow' : 'ok',
    };
  }

  async dbHealth() {
    if (!this.db) return { kind: null, ok: null, ms: 0 };
    const c = this.dbCheck;
    if (Date.now() - c.at > 5000) {
      c.at = Date.now();
      const t0 = performance.now();
      try {
        await this.db.query('SELECT 1');
        c.ok = true;
      } catch {
        c.ok = false;
      }
      c.ms = Math.round((performance.now() - t0) * 10) / 10;
    }
    return { kind: this.db.kind, ok: c.ok, ms: c.ms };
  }

  async state(me) {
    const lobby = this.lobby;
    const mem = process.memoryUsage();
    const games = [...lobby.rooms.values()].filter((r) => !r.closed).map((r) => this.gameRow(r));
    games.sort((a, b) => b.sockets - a.sockets || a.ageS - b.ageS);
    let servers = null;
    if (this.cluster) {
      servers = await this.db
        .query(`SELECT id, deployment, build, extract(epoch FROM started_at) * 1000 AS started, extract(epoch FROM now() - seen_at) AS seen_s, draining, games, players, max_games FROM cluster_servers ORDER BY id`)
        .then((r) => r.rows.map((s) => ({ id: s.id, deployment: String(s.deployment).slice(0, 12), build: s.build, startedAt: Math.round(s.started), seenS: Math.round(s.seen_s), draining: s.draining, games: s.games, players: s.players, maxGames: s.max_games, me: s.id === this.cluster.id })))
        .catch(() => []);
    }
    return {
      me: { id: me.id, name: me.name },
      server: {
        id: this.cluster?.id || '',
        clustered: !!this.cluster,
        build: this.info.build || '',
        clientBuild: this.info.clientBuild || '',
        protocol: PROTOCOL_VERSION,
        node: process.version,
        env: process.env.NODE_ENV || '',
        startedAt: this.startedAt,
        uptimeS: Math.round((Date.now() - this.startedAt) / 1000),
        stopping: !!this.stopping(),
        draining: lobby.closedToNew,
        db: await this.dbHealth(),
        handoff: !this.store ? null : this.store.dir ? 'files' : 'postgres',
        rssMb: Math.round(mem.rss / 1e6),
        heapMb: Math.round(mem.heapUsed / 1e6),
        net: this.net(),
        games: games.length,
        maxGames: lobby.maxGames,
        maxTotal: lobby.maxTotal,
        canCreate: lobby.canCreate,
        players: lobby.players(),
        seats: games.reduce((n, g) => n + g.max, 0),
        defaultPlayers: lobby.maxPlayers,
        maxPlayers: lobby.roomMaxPlayers,
        restart: this.restartInfo(),
      },
      servers,
      games,
      incidents: this.incidents.slice().reverse(),
    };
  }

  async gameDetail(room) {
    const row = this.gameRow(room);
    const r = await room.ask('detail');
    const out = { game: { ...row, made: room.created, madeBy: room.maker.startsWith('u:') ? 'an account' : room.maker ? 'a guest' : room.quick ? 'a quick join' : 'an admin or the server', load: room.st.load, tickFull: room.st.tick || null }, detail: null, players: [], error: '' };
    if (!r.ok) {
      out.error = r.error; // (the room's own numbers are still shown: a game that hangs can be closed from here)
      return out;
    }
    out.detail = r.game;
    out.players = r.players.map(({ slot, ...p }) => {
      const ws = slot >= 0 ? room.socks[slot] : null;
      return { ...p, accountId: (slot >= 0 && room.users[slot]?.id) || '', addr: ws ? this.addrTag(ws.getUserData().ip) : '' };
    });
    return out;
  }

  catalog() {
    return {
      zombies: ZOMBIE_KEYS.map((key) => ({ key, name: ZOMBIE_DEFS[ZTYPE[key]].name, boss: !!ZOMBIE_DEFS[ZTYPE[key]].boss })),
      items: ITEM_KEYS.map((key) => ({ key, name: ITEM_DEFS[ITEM[key]].name, cat: ITEM_DEFS[ITEM[key]].cat || '' })),
      commands: Object.fromEntries(Object.entries(COMMANDS).map(([k, c]) => [k, { about: c.about, player: !!c.player, when: c.when ?? null }])),
      difficulties: DIFFICULTIES.map((d) => ({ id: d.id, name: d.name, rank: d.rank })),
      limits: { message: MESSAGE_MAX, reason: REASON_MAX, spawn: SPAWN_MAX, give: GIVE_MAX },
      phases: PHASE,
    };
  }

  async settingsView() {
    const rows = new Map((await this.db.query('SELECT key, value, updated_at FROM server_settings')).rows.map((r) => [r.key, r]));
    return {
      settings: Object.entries(SETTINGS).map(([key, s]) => ({
        key,
        about: s.about,
        default: s.default,
        max: s.max ?? null,
        stored: rows.has(key) ? rows.get(key).value : null, // what the database holds (null: unset)
        updatedAt: rows.get(key)?.updated_at || null,
        inForce: this.settings.values[key], // what this server is going by right now
      })),
      // what else decides how the server runs, which only a deploy changes: shown, not set here
      fixed: { maxGames: this.lobby.maxGames, defaultPlayers: this.lobby.maxPlayers, maxPlayers: this.lobby.roomMaxPlayers, idleS: Math.round(this.lobby.idleMs / 1000), limits: this.lobby.limits },
    };
  }

  // q: part of a name ('' : the admins, then whoever was seen last)
  async accounts(q) {
    q = typeof q === 'string' ? q.trim() : '';
    if (q.length > 32 || (q && !/^[\p{L}\p{N}_.-]+$/u.test(q))) throw bad('Search by part of a name: letters, numbers, dots, dashes and underscores.');
    const like = `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const r = await this.db.query(
      `SELECT u.id, u.username, u.is_admin, u.created_at, u.last_login_at, u.last_seen_at,
              (SELECT count(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > now()) AS sessions
         FROM users u
        WHERE lower(u.username) LIKE $1
        ORDER BY ${q ? 'lower(u.username) = $2 DESC, length(u.username),' : 'u.is_admin DESC,'} coalesce(u.last_seen_at, u.last_login_at, u.created_at) DESC
        LIMIT ${ACCOUNTS_MAX + 1}`,
      q ? [like, q.toLowerCase()] : [like]
    );
    const rows = r.rows.slice(0, ACCOUNTS_MAX);
    const elsewhere = this.cluster ? await this.cluster.statusOf(rows.map((u) => u.id)).catch(() => new Map()) : new Map();
    const admins = (await this.db.query('SELECT count(*) AS n FROM users WHERE is_admin')).rows[0].n;
    return {
      q,
      more: r.rows.length > ACCOUNTS_MAX,
      admins,
      accounts: rows.map((u) => ({
        id: u.id,
        username: u.username,
        isAdmin: u.is_admin === true,
        createdAt: u.created_at,
        lastLoginAt: u.last_login_at,
        lastSeenAt: u.last_seen_at,
        sessions: u.sessions,
        game: this.lobby.playingRoom(u.id)?.code || elsewhere.get(u.id)?.game?.code || '',
      })),
    };
  }

  async auditPage(before) {
    const b = before === null || before === '' ? null : Number(before);
    if (b !== null && (!Number.isSafeInteger(b) || b < 1)) throw bad('before is the id of a row.');
    const r = await this.db.query(`SELECT id, at, admin_name, action, target, detail, ok, result, server_id FROM admin_audit WHERE ($1::bigint IS NULL OR id < $1) ORDER BY id DESC LIMIT ${AUDIT_PAGE + 1}`, [b]);
    return {
      more: r.rows.length > AUDIT_PAGE,
      rows: r.rows.slice(0, AUDIT_PAGE).map((a) => ({ id: a.id, at: a.at, admin: a.admin_name, action: a.action, target: a.target, detail: a.detail, ok: a.ok, result: a.result, server: a.server_id })),
    };
  }
}
