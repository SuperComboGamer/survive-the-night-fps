// The JSON API's plumbing over uWebSockets.js: routes whose handlers are async functions, JSON bodies, cookies.
//
// uWS hands a handler a request that is only valid until it returns, so everything a handler may want of it is
// read up front into `ctx`; and a response whose client went away must not be written to, so every reply checks.
//   api(app, 'post', '/api/x', async (ctx, body) => ({ status, body, cookies }), { body: true })
// A handler throws HttpError(status, message) to answer { error: message } with that status; anything else it
// throws is a 500 (and goes to the log).

export class HttpError extends Error {
  constructor(status, message, extra = null) {
    super(message);
    this.status = status;
    this.extra = extra; // more fields for the error's JSON
  }
}

const STATUS_TEXT = {
  200: '200 OK',
  201: '201 Created',
  204: '204 No Content',
  400: '400 Bad Request',
  401: '401 Unauthorized',
  403: '403 Forbidden',
  404: '404 Not Found',
  409: '409 Conflict',
  413: '413 Payload Too Large',
  415: '415 Unsupported Media Type',
  429: '429 Too Many Requests',
  500: '500 Internal Server Error',
  503: '503 Service Unavailable',
};

// name -> value of a Cookie header
export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    if (!(k in out)) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

// Was this request sent by a page of ours? A browser says where a page came from in Origin on every POST and on a
// WebSocket's handshake; a page on another site can make a signed-in player's browser send one with their cookie
// unless the server looks. No Origin at all is not a browser's cross-site request (curl, the tests).
export function sameOrigin(origin, host) {
  if (!origin) return true;
  try {
    return new URL(origin).host.toLowerCase() === String(host || '').toLowerCase();
  } catch {
    return false;
  }
}

// Writes a reply, unless the client went away
export function reply(res, { status = 200, body = null, cookies = [], headers = {} } = {}) {
  if (res.aborted) return;
  res.cork(() => {
    res.writeStatus(STATUS_TEXT[status] || String(status));
    res.writeHeader('Content-Type', 'application/json');
    res.writeHeader('Cache-Control', 'no-store');
    for (const [k, v] of Object.entries(headers)) res.writeHeader(k, v);
    for (const c of cookies) res.writeHeader('Set-Cookie', c);
    res.end(body === null ? '{}' : JSON.stringify(body));
  });
  res.aborted = true; // (written: nothing more goes out on it)
}

// The body, up to `max` bytes, as one Buffer. Must be called before the handler returns (uWS)
function readBody(res, max) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    let done = false;
    res.onData((chunk, last) => {
      if (done) return;
      size += chunk.byteLength;
      if (size > max) {
        done = true;
        return reject(new HttpError(413, 'Too much'));
      }
      // (copied: the chunk is only valid during this callback. Buffer.from(chunk) would be a view of it, detached by
      // the time a body of more than one chunk is joined, and that throw in uWS's callback ends the process)
      parts.push(Buffer.from(new Uint8Array(chunk)));
      if (last) {
        done = true;
        resolve(Buffer.concat(parts));
      }
    });
  });
}

// (a bad %-escape is left as it came: throwing here would be in uWS's callback, before anything can answer)
const decode = (v) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};

// app: the uWS app. method: 'get' | 'post' | 'put' | 'del'. opts: { body: read a JSON body, max: its most bytes,
// address: (res, req) -> the client's address }
export function api(app, method, path, fn, { body = false, max = 4096, address = () => '', log = console.error } = {}) {
  const nParams = (path.match(/:/g) || []).length;
  app[method](path, (res, req) => {
    const ctx = {
      method: method.toUpperCase(),
      url: req.getUrl(),
      query: new URLSearchParams(req.getQuery() || ''),
      params: Array.from({ length: nParams }, (_, i) => decode(req.getParameter(i) || '')),
      cookies: parseCookies(req.getHeader('cookie')),
      host: req.getHeader('host'),
      origin: req.getHeader('origin'),
      proto: req.getHeader('x-forwarded-proto'),
      ua: req.getHeader('user-agent').slice(0, 300),
      contentType: req.getHeader('content-type'),
      ip: address(res, req),
    };
    res.aborted = false;
    res.onAborted(() => {
      res.aborted = true;
    });
    const fail = (err) => {
      if (err instanceof HttpError) return reply(res, { status: err.status, body: { error: err.message, ...(err.extra || {}) } });
      log(`[server] ${ctx.method} ${ctx.url} failed:`, err);
      reply(res, { status: 500, body: { error: 'Something went wrong on the server' } });
    };
    const run = (b) => {
      try {
        Promise.resolve(fn(ctx, b)).then((out) => reply(res, out || {}), fail);
      } catch (err) {
        fail(err);
      }
    };
    if (!body) return run(null);
    // (JSON only: a form on another site cannot post that without the browser asking this server first)
    if (!/^application\/json\b/i.test(ctx.contentType)) {
      res.onData(() => {});
      return fail(new HttpError(415, 'Send JSON'));
    }
    if (!sameOrigin(ctx.origin, ctx.host)) {
      res.onData(() => {});
      return fail(new HttpError(403, 'Not from this site'));
    }
    readBody(res, max).then((buf) => {
      let o;
      try {
        o = JSON.parse(buf.toString('utf8') || '{}');
      } catch {
        return fail(new HttpError(400, 'Bad request'));
      }
      if (!o || typeof o !== 'object' || Array.isArray(o)) return fail(new HttpError(400, 'Bad request'));
      run(o);
    }, fail);
  });
}
