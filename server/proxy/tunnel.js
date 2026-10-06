// A WebSocket between a browser and a game server, through the proxy: the handshake goes on to the server, and from
// then on the bytes go both ways as they are, no frame taken apart. The proxy only follows where the server's frames
// begin and end (Frames), so that going down itself it can end a socket between two of them with a close of its own
// (MOVED_CODE: the client comes back in at once, through the next proxy, to the same server and its own body).
import net from 'node:net';

// The frames a server sends (unmasked, RFC 6455 5.2), after its HTTP response to the handshake
class Frames {
  constructor() {
    this.http = true; // still in the server's HTTP response
    this.head = ''; // ...as much of it as came
    this.ok = false; // it said 101: frames follow
    this.hdr = []; // the header of the frame under way, as far as it came
    this.need = 0; // payload bytes of the frame under way still to come
  }
  get between() {
    return this.ok && !this.http && this.need === 0 && this.hdr.length === 0;
  }
  // Follows `chunk` -> how many of its bytes were taken: all, or (stop) those up to the first gap between two frames
  scan(chunk, stop = false) {
    let i = 0;
    while (i < chunk.length) {
      if (stop && this.between) return i;
      if (this.http) {
        const before = this.head.length;
        this.head += chunk.toString('latin1', i);
        const end = this.head.indexOf('\r\n\r\n');
        if (end < 0) {
          if (this.head.length > 16384) this.http = false; // (not HTTP: passed on as it is)
          return chunk.length;
        }
        this.ok = /^HTTP\/1\.1 101/.test(this.head);
        this.http = false;
        i += end + 4 - before;
        this.head = '';
        continue;
      }
      if (!this.ok) return chunk.length;
      if (this.need > 0) {
        const n = Math.min(this.need, chunk.length - i);
        this.need -= n;
        i += n;
        continue;
      }
      const h = this.hdr;
      h.push(chunk[i++]);
      if (h.length < 2) continue;
      const len7 = h[1] & 0x7f;
      const size = 2 + (len7 === 126 ? 2 : len7 === 127 ? 8 : 0) + (h[1] & 0x80 ? 4 : 0);
      if (h.length < size) continue;
      let len = len7;
      if (len7 === 126) len = (h[2] << 8) | h[3];
      else if (len7 === 127) {
        len = 0;
        for (let k = 2; k < 10; k++) len = len * 256 + h[k];
      }
      this.need = len;
      this.hdr = [];
    }
    return i;
  }
}

// a close frame, server to client: code, then why (UTF-8, short)
function closeFrame(code, why) {
  const reason = Buffer.from(why).subarray(0, 120);
  return Buffer.concat([Buffer.from([0x88, 2 + reason.length, code >> 8, code & 0xff]), reason]);
}

// client: the browser's socket (the HTTP server's 'upgrade'), head: what came after its handshake. to: { addr, port }.
// headers: the handshake's, as the server is to get them. done(): the tunnel is gone. -> the tunnel, whose close(code,
// why) ends it from the proxy's side
export function tunnel(client, head, req, to, headers, done = () => {}) {
  const up = net.connect({ host: to.addr, port: to.port });
  const frames = new Frames();
  let ending = null; // { code, why }: the proxy is closing it, at the next gap between frames
  let answered = false; // the server has said something to the browser
  let ended = false;
  let gone = false;
  const finish = () => {
    if (gone) return;
    gone = true;
    up.destroy();
    client.destroy();
    done();
  };
  const endNow = () => {
    if (ended) return;
    ended = true;
    client.unpipe(up);
    up.destroy();
    if (frames.between) client.end(closeFrame(ending.code, ending.why));
    else client.end();
    setTimeout(finish, 1000).unref();
  };

  client.setNoDelay(true);
  up.setNoDelay(true);
  up.on('connect', () => {
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (const [k, v] of Object.entries(headers)) for (const one of Array.isArray(v) ? v : [v]) raw += `${k}: ${one}\r\n`;
    up.write(raw + '\r\n');
    if (head?.length) up.write(head);
    client.pipe(up);
  });
  up.on('data', (chunk) => {
    answered = true;
    if (!ending) {
      frames.scan(chunk);
      if (!client.write(chunk)) up.pause();
      return;
    }
    const n = frames.scan(chunk, true);
    if (n) client.write(chunk.subarray(0, n));
    if (frames.between || n < chunk.length) endNow();
  });
  client.on('drain', () => up.resume());
  up.on('error', () => {}); // ('close' follows)
  up.on('end', () => ended || client.end());
  up.on('close', () => {
    if (ended) return; // (the proxy is ending it: the browser's side goes once its close is out, client 'close')
    // what the server sent last goes out before the browser's side closes. Never answered: it could not be reached,
    // and the browser's handshake fails (it tries again, connection.js)
    if (!client.destroyed) client.end(answered ? undefined : 'HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    setTimeout(finish, 1000).unref();
  });
  client.on('error', finish);
  client.on('close', finish);

  return {
    to,
    close(code, why) {
      if (gone || ending) return;
      ending = { code, why };
      if (!frames.ok || frames.between) endNow();
      else setTimeout(() => !gone && endNow(), 500).unref(); // (a frame that never ends: closed as it stands)
    },
  };
}
