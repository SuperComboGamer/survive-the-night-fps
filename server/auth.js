// Accounts: registering with an email address, a name to play under and a password; signing in with either the
// email or the name; staying signed in by a cookie.
//
// Passwords are kept as scrypt hashes (node's crypto, no native module). A sign-in is a random 32-byte token in an
// HttpOnly cookie (stn_session): the sessions table keeps its SHA-256, so the table alone signs nobody in. A
// session lasts 30 days from when it was last used. Signing in, the socket a game is played on and the social one
// (social.js) all find the player the same way: userForToken, which keeps what it found for a minute so a burst of
// sockets does not each go to the database.
//
// What the browser had before it signed in - the id it made up for the leaderboard (client/net/identity.js) - can
// come along with a register or a sign-in (guestId): the stats it earned as a guest move onto the account
// (DbStats.claimGuest), and so do the Dead Hand cards and decks it found (CardService.mergeGuest), and the id goes no
// further than that.
import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { HttpError } from './http.js';
import { Allowance } from './allowance.js';

export const COOKIE = 'stn_session';
const SESSION_DAYS = 30;
const CACHE_MS = 60_000;
const CACHE_MAX = 20_000;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }; // ~50 ms on one core, in libuv's pool (not this thread)

export const USERNAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_.-]{2,15}$/u;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]+$/;

const sha = (s) => createHash('sha256').update(s).digest('hex');
const scryptAsync = (pw, salt, { N, r, p, keylen }) =>
  new Promise((resolve, reject) => scrypt(pw, salt, keylen, { N, r, p, maxmem: 256 * N * r }, (err, key) => (err ? reject(err) : resolve(key))));

// 'scrypt$N$r$p$salt$hash', salt and hash in base64
export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw, stored) {
  const [alg, N, r, p, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = await scryptAsync(pw, Buffer.from(salt, 'base64'), { N: +N, r: +r, p: +p, keylen: want.length });
  return got.length === want.length && timingSafeEqual(got, want);
}
// what a sign-in with an unknown name costs, so a wrong name takes as long to say no to as a wrong password
const DUMMY = hashPassword('not anybody').catch(() => '');

export function checkEmail(v) {
  const email = typeof v === 'string' ? v.trim() : '';
  if (!email) throw new HttpError(400, 'Enter your email address.', { field: 'email' });
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new HttpError(400, 'That does not look like an email address.', { field: 'email' });
  return email;
}
export function checkUsername(v) {
  const name = typeof v === 'string' ? v.trim() : '';
  if (!name) throw new HttpError(400, 'Pick a name to play under.', { field: 'username' });
  if (!USERNAME_RE.test(name)) throw new HttpError(400, 'A name is 3 to 16 letters, numbers, dots, dashes or underscores, starting with a letter or number.', { field: 'username' });
  return name;
}
function checkPassword(v) {
  const pw = typeof v === 'string' ? v : '';
  if (pw.length < 8) throw new HttpError(400, 'A password is at least 8 characters.', { field: 'password' });
  if (pw.length > 128) throw new HttpError(400, 'A password is at most 128 characters.', { field: 'password' });
  return pw;
}

// what a client is told of its own account
export const publicUser = (u) => ({ id: u.id, username: u.username, email: u.email, createdAt: u.created_at });

export class Auth {
  // db: server/db. stats: the DbStats a guest's record moves onto their account from (optional). cards: the card
  // collections a guest's moves onto their account from (usercards.js CardService, optional)
  constructor({ db, stats = null, cards = null, log = () => {} }) {
    this.db = db;
    this.stats = stats;
    this.cards = cards;
    this.log = log;
    this.cache = new Map(); // token hash -> { user: { id, name, isAdmin } | null, until }
    this.registers = new Allowance(10, 300); // per address (a household, a LAN party): 10 accounts, then one every 5 minutes
    this.logins = new Allowance(10, 20); // per address: 10 tries, then one every 20 s
    this.failures = new Allowance(8, 60); // per account: 8 wrong passwords, then one try a minute
    this.onSignOut = null; // (user id) => void: social.js closes that browser's socket
  }

  cookieFor(token, secure) {
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
  }
  clearCookie(secure) {
    return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
  }
  // a cookie only goes out over https if the page came over it (Railway's edge says so)
  static secure(ctx) {
    return ctx.proto === 'https' || process.env.COOKIE_SECURE === '1';
  }

  async newSession(user, ctx) {
    const token = randomBytes(32).toString('base64url');
    await this.db.query(`INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent) VALUES ($1, $2, now() + make_interval(days => $3), $4, $5)`, [sha(token), user.id, SESSION_DAYS, ctx.ip || null, ctx.ua || null]);
    return token;
  }

  // -> { user, cookie }
  async register(body, ctx) {
    const email = checkEmail(body.email);
    const username = checkUsername(body.username);
    const password = checkPassword(body.password);
    if (!this.registers.take(ctx.ip)) throw new HttpError(429, 'Several accounts were made from here just now. Try again in a few minutes.');
    const taken = await this.db.query('SELECT lower(email) = lower($1) AS email, lower(username) = lower($2) AS username FROM users WHERE lower(email) = lower($1) OR lower(username) = lower($2)', [email, username]);
    if (taken.rows.some((r) => r.email)) throw new HttpError(409, 'There is an account with that email already. Sign in instead?', { field: 'email' });
    if (taken.rows.some((r) => r.username)) throw new HttpError(409, 'That name is taken.', { field: 'username' });
    const hash = await hashPassword(password);
    let user;
    try {
      user = (await this.db.query('INSERT INTO users (email, username, password_hash, last_login_at) VALUES ($1, $2, $3, now()) RETURNING *', [email, username, hash])).rows[0];
    } catch (err) {
      if (err.code !== '23505') throw err; // (unique_violation: two registers raced for it)
      throw new HttpError(409, /email/.test(err.constraint || err.message) ? 'There is an account with that email already.' : 'That name is taken.');
    }
    await this.claimGuest(user, body.guestId);
    const token = await this.newSession(user, ctx);
    this.log(`account ${user.username} registered`);
    return { user, cookie: this.cookieFor(token, Auth.secure(ctx)) };
  }

  // login: the email or the name. -> { user, cookie }
  async login(body, ctx) {
    const login = typeof body.login === 'string' ? body.login.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!login || !password) throw new HttpError(400, 'Enter your email (or name) and password.');
    if (!this.logins.take(ctx.ip)) throw new HttpError(429, 'Too many sign-in attempts. Wait a minute and try again.');
    const who = login.toLowerCase();
    if (!this.failures.has(who)) throw new HttpError(429, 'Too many wrong passwords for that account. Wait a minute and try again.');
    const user = (await this.db.query('SELECT * FROM users WHERE lower(email) = $1 OR lower(username) = $1 LIMIT 1', [who])).rows[0];
    const ok = user ? await verifyPassword(password, user.password_hash) : (await verifyPassword(password, await DUMMY), false);
    if (!ok) {
      this.failures.take(who);
      throw new HttpError(401, 'That email or name and password do not match an account.');
    }
    this.failures.clear(who);
    await this.db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    await this.claimGuest(user, body.guestId);
    const token = await this.newSession(user, ctx);
    return { user, cookie: this.cookieFor(token, Auth.secure(ctx)) };
  }

  async claimGuest(user, guestId) {
    if (typeof guestId !== 'string' || !guestId) return;
    if (this.stats) {
      try {
        await this.stats.claimGuest(user.id, user.username, guestId);
      } catch (err) {
        this.log(`account ${user.username}: guest stats not moved over (${err.message})`); // (the account is made all the same)
      }
    }
    // (on its own: claimGuest above has nothing to do for a guest with no stats, who may well have found cards)
    if (this.cards) {
      try {
        await this.cards.mergeGuest(user.id, guestId);
      } catch (err) {
        this.log(`account ${user.username}: guest cards not moved over (${err.message})`);
      }
    }
  }

  async logout(ctx) {
    const token = ctx.cookies[COOKIE];
    if (!token) return;
    const h = sha(token);
    const gone = await this.db.query('DELETE FROM sessions WHERE token_hash = $1 RETURNING user_id', [h]);
    this.cache.delete(h);
    if (gone.rows[0]) this.onSignOut?.(gone.rows[0].user_id, h);
  }

  // The account a cookie's token signs in, { id, name, isAdmin, hash } (hash: the session's), or null. Uses the
  // session (and pushes its expiry on) at most once an hour.
  async userForToken(token, fresh = false) {
    if (!token || typeof token !== 'string' || token.length > 100) return null;
    const h = sha(token);
    const now = Date.now();
    const hit = this.cache.get(h);
    if (!fresh && hit && hit.until > now) return hit.user;
    const row = (
      await this.db.query(
        `SELECT s.user_id, s.last_used_at, u.username, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`,
        [h]
      )
    ).rows[0];
    const user = row ? { id: row.user_id, name: row.username, isAdmin: row.is_admin === true, hash: h } : null;
    if (row && now - new Date(row.last_used_at).getTime() > 3600_000) {
      this.db
        .query(`UPDATE sessions SET last_used_at = now(), expires_at = now() + make_interval(days => $2) WHERE token_hash = $1`, [h, SESSION_DAYS])
        .catch((err) => this.log(`session touch failed (${err.message})`));
      this.db.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [row.user_id]).catch(() => {});
    }
    if (this.cache.size >= CACHE_MAX) this.cache.clear();
    this.cache.set(h, { user, until: now + CACHE_MS });
    return user;
  }

  // the signed-in account behind a request: the full row, or null
  async me(ctx) {
    const u = await this.userForToken(ctx.cookies[COOKIE]);
    if (!u) return null;
    return (await this.db.query('SELECT * FROM users WHERE id = $1', [u.id])).rows[0] || null;
  }

  // ...or a 401
  async need(ctx) {
    const u = await this.userForToken(ctx.cookies[COOKIE]);
    if (!u) throw new HttpError(401, 'Sign in first.');
    return u;
  }

  // sessions past their date, now and then
  async sweep() {
    await this.db.query('DELETE FROM sessions WHERE expires_at < now()');
    const now = Date.now();
    for (const [k, v] of this.cache) if (v.until <= now) this.cache.delete(k);
  }
}
