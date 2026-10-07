// What a page and a server must have in common for the page to play on after a deploy without being loaded again
// (client/net/moveback.js, docs/deploys.md): the compat, a hash of
//   - the protocol version (shared/protocol.js PROTOCOL_VERSION)
//   - every .js file in shared/: the code both ends run (the valley, the movement, the rules, the message ids)
//   - the wire codec that lives outside shared/ (CODEC_FILES): how a snapshot is written and read, and how the client
//     reads every other message. A change to any of them is a change to what the two ends say to each other, even
//     without a protocol bump: a page of another compat is loaded again rather than misread the next server.
// A change to how a message is written anywhere else (server/game.js's events, chat, inventory...) is read by
// client code too - connection.js, decode.js, or client/game/game.js; the last is not hashed (most client deploys
// change it), so a change to a message it reads must bump PROTOCOL_VERSION, as any change to the protocol always has.
import { createHash } from 'node:crypto';
import { closeSync, openSync, readdirSync, readSync } from 'node:fs';
import { join } from 'node:path';

export const CODEC_FILES = ['server/snapshot.js', 'client/net/decode.js', 'client/net/connection.js'];

// root: the repository as deployed. -> 12 hex
export function compatOf(root, protocol) {
  const h = createHash('sha256').update(`protocol ${protocol}\n`);
  // (each file through one small buffer: 1 MB of files read whole would stay in the process's memory as it starts)
  const chunk = Buffer.allocUnsafe(64 * 1024);
  const file = (full) => {
    let fd;
    try {
      fd = openSync(full, 'r');
    } catch {
      return void h.update('(none)');
    }
    try {
      for (let n; (n = readSync(fd, chunk, 0, chunk.length, null)) > 0; ) h.update(chunk.subarray(0, n));
    } finally {
      closeSync(fd);
    }
  };
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full, `${rel}${e.name}/`);
      else if (e.name.endsWith('.js')) {
        h.update(`${rel}${e.name}\0`);
        file(full);
        h.update('\n');
      }
    }
  };
  walk(join(root, 'shared'), '');
  for (const f of CODEC_FILES) {
    h.update(`codec ${f}\0`);
    file(join(root, f));
    h.update('\n');
  }
  return h.digest('hex').slice(0, 12);
}
