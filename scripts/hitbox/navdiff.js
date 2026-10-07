// Did a change to the colliders change where the dead can walk? (docs/hitboxes.md) The nav grid (server/nav.js) of
// the same valley as this tree builds it and as another does, compared cell by cell: cells that were open and are
// shut, cells that were shut and are open, and - what matters - every cell the dead could walk to from the survivors'
// start that they no longer can, and every container, loot point, part spot, doorway and spawn point that was within
// reach of such a cell and no longer is. Also: nothing a game starts or puts down stands inside a collider.
// usage: node scripts/hitbox/navdiff.js --before <tree> [--seeds 1-12] [--world island|mainland|both]
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, REPO } from '../clip/lib.js';

const args = parseArgs(process.argv.slice(2), { seeds: '1-12', world: 'both' });
const [s0, s1] = String(args.seeds).split('-').map(Number);
const load = async (tree) => {
  const imp = (p) => import(pathToFileURL(join(tree, p)).href);
  return { worldFor: (await imp('shared/worlds.js')).worldFor, Nav: (await imp('server/nav.js')).Nav, col: await imp('shared/collision.js') };
};
const A = await load(REPO);
const B = args.before ? await load(resolve(String(args.before))) : null;

const NDI = [1, -1, 0, 0, 1, 1, -1, -1], NDJ = [0, 0, 1, -1, 1, -1, 1, -1];
function reach(nav, x, z) {
  const S = nav.size;
  const seen = new Uint8Array(S * S);
  const queue = new Int32Array(S * S);
  let tail = 0;
  const start = nav._cellIndex(x, z);
  seen[start] = 1;
  queue[tail++] = start;
  for (let head = 0; head < tail; head++) {
    const k = queue[head];
    const i = k % S, j = (k - i) / S;
    for (let n = 0; n < 8; n++) {
      const ni = i + NDI[n], nj = j + NDJ[n];
      if (ni < 0 || nj < 0 || ni >= S || nj >= S) continue;
      const nk = nj * S + ni;
      if (seen[nk] || nav.blocked[nk] || nav.edge[k] & (1 << n)) continue;
      if (n >= 4 && (nav.blocked[k + NDI[n]] || nav.blocked[k + NDJ[n] * S])) continue;
      seen[nk] = 1;
      queue[tail++] = nk;
    }
  }
  return seen;
}
const nearSeen = (nav, seen, x, z, r) => {
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    const i = Math.floor(x + nav.half) + di, j = Math.floor(z + nav.half) + dj;
    if (i >= 0 && j >= 0 && i < nav.size && j < nav.size && seen[j * nav.size + i]) return true;
  }
  return false;
};
// is (x, z) at height y inside something that stops a body?
const inside = (T, w, x, z, y) => {
  const pos = { x, y, z };
  return !!T.col.resolveBody(w, pos, 0.2, 1.7) && Math.hypot(pos.x - x, pos.z - z) > 0.19;
};

let fail = 0;
const tot = { shut: 0, opened: 0, lost: 0, gained: 0, things: 0, thingsLost: 0, buried: 0 };
for (const [map, act] of [['island', 1], ['mainland', 2]]) {
  if (args.world !== 'both' && args.world !== map) continue;
  for (let seed = s0; seed <= (s1 || s0); seed++) {
    const wa = A.worldFor(seed, act);
    const na = new A.Nav(wa);
    const sp = wa.spawnPoints[0];
    const ra = reach(na, sp.x, sp.z);
    const things = [...wa.containers.map((o) => ['container', o]), ...wa.lootSpawns.map((o) => ['loot', o]), ...wa.partSpots.map((o) => ['part spot', o]), ...wa.openings.map((o) => ['doorway', o]), ...wa.spawnPoints.map((o) => ['spawn point', o]), ...(wa.resourceSpawns || []).map((o) => ['woodland loot', o])];
    // nothing that is started or picked up stands in a collider (a container is in or against its prop by design)
    let buried = 0;
    const why = [];
    for (const [name, o] of things) {
      if (name === 'container' || name === 'doorway') continue;
      if (inside(A, wa, o.x, o.z, o.y ?? wa.heightAt(o.x, o.z))) {
        buried++;
        if (why.length < 3) why.push(`${name} /tp ${o.x.toFixed(1)} ${o.z.toFixed(1)}`);
      }
    }
    let line = `${map} ${seed}: ${things.length} things`;
    let buriedBefore = 0;
    if (B) {
      const wb = B.worldFor(seed, act);
      const nb = new B.Nav(wb);
      const rb = reach(nb, sp.x, sp.z);
      let shut = 0, opened = 0, lost = 0, gained = 0;
      for (let k = 0; k < na.blocked.length; k++) {
        if (na.blocked[k] && !nb.blocked[k]) shut++;
        if (!na.blocked[k] && nb.blocked[k]) opened++;
        if (rb[k] && !ra[k]) lost++;
        if (ra[k] && !rb[k]) gained++;
      }
      let thingsLost = 0;
      const which = [];
      for (const [name, o] of things) {
        if (nearSeen(nb, rb, o.x, o.z, 3) && !nearSeen(na, ra, o.x, o.z, 3)) {
          thingsLost++;
          if (which.length < 3) which.push(`${name} /tp ${o.x.toFixed(1)} ${o.z.toFixed(1)}`);
        }
      }
      for (const [name, o] of things) if (name !== 'container' && name !== 'doorway' && inside(B, wb, o.x, o.z, o.y ?? wb.heightAt(o.x, o.z))) buriedBefore++;
      tot.shut += shut;
      tot.opened += opened;
      tot.lost += lost;
      tot.gained += gained;
      tot.thingsLost += thingsLost;
      line += `; nav cells shut ${shut}, opened ${opened}; walked to before and not now ${lost}, now and not before ${gained}; things no longer walked to ${thingsLost}${which.length ? ' (' + which.join('; ') + ')' : ''}`;
      if (thingsLost) fail++;
    }
    tot.things += things.length;
    tot.buried += buried;
    line += `; inside a collider ${buried}${B ? ` (before: ${buriedBefore})` : ''}${why.length ? ' (' + why.join('; ') + ')' : ''}`;
    if (buried > buriedBefore) fail++;
    console.log(line);
  }
}
console.log(`\ntotal: ${tot.things} things; ${tot.thingsLost} no longer walked to; ${tot.buried} inside a collider; nav cells shut ${tot.shut}, opened ${tot.opened}; cells walked to before and not now ${tot.lost}, now and not before ${tot.gained}`);
process.exitCode = fail ? 1 : 0;
