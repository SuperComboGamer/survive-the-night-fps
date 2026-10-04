// Zombie navigation: a 1 m global walkability grid (static colliders + deep water) plus a
// structure cost overlay, and per-survivor local Dijkstra flow fields. Player-built structures are
// expensive-but-passable so hordes route around bases when a gap exists, or break through walls.
// Building walls are thinner than a cell, so a wall rarely covers a cell center: besides blocked cells,
// every cell-to-cell step that crosses a static collider is cut (edge mask), and near walls the first
// step from a survivor or zombie is checked against the real geometry (a cell center can sit on the
// far side of the wall from whoever is standing in that cell).
// A deck over the lake (the pier) is a second level the flat grid has to be told about: its cells are
// walkable, the steps over its sides are cut where the ground is more than a step below the planks, and
// flowDir takes the height of the feet to tell who is on it from who is in the water beside it.
// The grid has to stop the dead where their bodies stop: a collider is a wall when its top is more than a step
// above the ground (the physics' own STEP_HEIGHT) and its underside lower than a body is tall, and a gap between two
// walls too narrow for a body is closed by a bridge (an invisible wall of the grid's own, never of the physics).
// Without them the field leads into a slot a body cannot get through, and whoever follows it stands there all night.
// A gap that narrow between a survivor's structure and the static world is priced like the structure itself:
// the way through it is to claw the piece down. And a crowd costs: the field is solved with every cell that
// holds more of the dead than fit in it made dearer, so a horde jammed at one corner of a barricade spreads
// along it instead of queueing behind the few at the front.
import { STEP_HEIGHT } from '../shared/constants.js';
import { COL, BOX, CYL, ColliderGrid, groundAt, footprintContains, overlapBoxes } from '../shared/collision.js';

const FIELD = 144; // flow field window size (cells): the horde spawns ~60-85 m out, inside the window
const HALF_FIELD = FIELD / 2;
const PW = FIELD + 2; // padded window: a 1-cell blocked border replaces per-neighbor bounds checks
const INF = 0x7fffffff;
const STRUCT_COST = 14; // extra cost to cross a structure cell (x10 units)
const EDGE_PAD = 0.03; // clearance a step keeps from a wall (small, so 1.1 m back doors stay open)
const NEAR_WALL = 1.5; // cells within this of a wall check first steps against the real geometry
const PERCH = 512; // source mask: the field starts from the ground around what the survivor stands on (this.seeds)
const PERCH_R = 4; // how far (cells) from the survivor that ground is looked for: wider than half a bus or a tent
const PERCH_W = PERCH_R * 2 + 1;
const PERCH_RING = 10; // ...and how much further off than the nearest of it still starts the field (x10 units; under a step's cost)
const SLAB = 0.45; // a box thinner than this is a floor, a deck or a ceiling (the pier's planks are 0.22)
const DECK_HEADROOM = 1.9; // a slab with less room than this under it is walked on, not under (a walker is 1.75 m, a lintel hangs at 2.2)
const HEADROOM = 1.7; // what a body needs under something to walk beneath it (a walker is 1.75 m: anything lower stops it)
const GAP = 0.76; // a gap between walls narrower than this takes no walker (radius 0.38) through: the grid closes it
const CROWD_COST = 30; // extra cost (x10 units: 3 m) of a cell for each of the dead in it past the first...
const CROWD_MAX = 5; // ...counting this many at most

export class Nav {
  constructor(world) {
    this.world = world;
    this.half = world.half; // the grid covers the world it was made for: 1 m cells, this.size a side
    this.size = world.size;
    this.blocked = new Uint8Array(this.size * this.size);
    this.edge = new Uint8Array(this.size * this.size); // bit n: the step toward neighbor n crosses a static collider
    this.nearWall = new Uint8Array(this.size * this.size);
    this.solid = new Set(); // static colliders the grid treats as walls (for exact segment checks)
    this.bridges = new Set(); // its own walls across gaps too narrow for a body (_bridge), in bridgeGrid
    this.bridgeGrid = new ColliderGrid(this.half);
    this.decks = new Set(); // slabs that are a level of their own to walk on (a pier over the lake)
    this.deck = new Map(); // cell whose centre is under the planks of one -> their height
    this.rim = new Map(); // cell of the ground or water beside one, too far below to step up -> the deck's height
    this.deckBox = { i0: this.size, j0: this.size, i1: -1, j1: -1 }; // the cells all of that lies in (flowDir looks no further)
    this.structCost = new Uint16Array(this.size * this.size);
    this.structRef = new Map(); // cell -> count
    this.crowd = new Uint8Array(this.size * this.size); // how many of the dead stand in each cell (setCrowd)
    this.crowdCells = []; // the cells counted in it
    this.crowdVer = 0; // bumped whenever the count is taken again (a field solved with the crowd before is stale)
    this.jammed = false; // some cell held more than one at the last count
    this._q = [];
    this._qb = [];
    this._buildStatic();
    this.fields = new Map(); // playerId -> field
    this.structVer = 0; // bumped whenever structure costs change (fields computed before are stale)
    this.maxStructCost = 0; // highest structure cost any cell has had (bounds the edge cost)
    // scratch for the solver (padded window): walkability, step mask, entry cost, distance, bucket queue
    this.pBlocked = new Uint8Array(PW * PW);
    this.pEdge = new Uint8Array(PW * PW);
    this.pCost = new Int32Array(PW * PW);
    this.pDist = new Int32Array(PW * PW);
    this.bucketHead = new Int32Array(0);
    this.entryIdx = new Int32Array(FIELD * FIELD * 8 + 1); // a cell is queued once per improvement: <= 8 per cell
    this.entryNext = new Int32Array(FIELD * FIELD * 8 + 1);
    this.seeds = new Int32Array(PERCH_W * PERCH_W); // source cells of a PERCH field: cell in the PERCH_W window << 8 | cost
    this.seedN = 0;
  }

  _cellIndex(x, z) {
    const i = Math.floor(x + this.half);
    const j = Math.floor(z + this.half);
    if (i < 0 || j < 0 || i >= this.size || j >= this.size) return -1;
    return j * this.size + i;
  }

  _raster(c, fn, expand) {
    const r = c.r + expand;
    const i0 = Math.max(0, Math.floor(c.x - r + this.half));
    const i1 = Math.min(this.size - 1, Math.floor(c.x + r + this.half));
    const j0 = Math.max(0, Math.floor(c.z - r + this.half));
    const j1 = Math.min(this.size - 1, Math.floor(c.z + r + this.half));
    for (let j = j0; j <= j1; j++) {
      const cz = j - this.half + 0.5;
      for (let i = i0; i <= i1; i++) {
        const cx = i - this.half + 0.5;
        const dx = cx - c.x;
        const dz = cz - c.z;
        let inside;
        if (c.type === CYL) {
          const rr = c.r + expand;
          inside = dx * dx + dz * dz <= rr * rr;
        } else {
          const lx = c.c * dx - c.s * dz;
          const lz = c.s * dx + c.c * dz;
          inside = Math.abs(lx) <= c.hx + expand && Math.abs(lz) <= c.hz + expand;
        }
        if (inside) fn(j * this.size + i);
      }
    }
  }

  _buildStatic() {
    const w = this.world;
    const grid = w.staticGrid;
    const seen = new Set();
    const slabs = [];
    const floors = [];
    const walls = []; // everything that stops a body, trees too (the gaps between them: _bridgeGaps)
    for (const cell of grid.cells) {
      for (const c of cell) {
        if (seen.has(c)) continue;
        seen.add(c);
        if (c.flags & COL.NOBLOCK) continue;
        const gy = w.heightAt(c.x, c.z);
        if (c.type === BOX && c.y1 - c.y0 < SLAB && !(c.flags & COL.TREE)) {
          // a thin slab off the ground (a pier deck, a ceiling) is never a wall: whether it is a level
          // the dead walk on is settled in _markDecks
          if (c.y1 >= gy + 0.5) {
            slabs.push(c);
            continue;
          }
          // low floors: walkable
          floors.push(c);
          continue;
        }
        // something up off the ground that a body walks under (a lintel, an awning); lower than that it stops one
        if (c.y0 > gy + HEADROOM) continue;
        // a wall when its top is more than a step above the ground (the physics' own step: a 0.5 m kerb stops a body)
        if (c.y1 <= gy + STEP_HEIGHT) continue;
        // thin building walls expand less so 1.3 m doorways stay open to the dead
        const thin = c.type === BOX && Math.min(c.hx, c.hz) < 0.2;
        this._raster(c, (k) => (this.blocked[k] = 1), c.flags & COL.TREE ? 0.05 : thin ? 0.06 : 0.25);
        walls.push(c);
        if (c.flags & COL.TREE) continue;
        this.solid.add(c);
        this._cutEdges(c);
        this._raster(c, (k) => (this.nearWall[k] = 1), NEAR_WALL);
      }
    }
    this._bridgeGaps(walls);
    this._markDecks(slabs, floors);
    for (let j = 0; j < this.size; j++) {
      for (let i = 0; i < this.size; i++) {
        const x = i - this.half + 0.5;
        const z = j - this.half + 0.5;
        // decks over water stay walkable
        if (w.isDeepWater(x, z) && !this.deck.has(j * this.size + i)) this.blocked[j * this.size + i] = 1;
      }
    }
    // inside a portal of the mine the ground is not there to walk on: the decline under it is the workings' own
    // level (minenav.js), and what is on this one walks in at the mouth
    for (const p of w.mine?.portals || []) {
      for (let j = Math.max(0, Math.floor(p.z - 14 + this.half)); j <= Math.min(this.size - 1, Math.floor(p.z + 14 + this.half)); j++) {
        for (let i = Math.max(0, Math.floor(p.x - 14 + this.half)); i <= Math.min(this.size - 1, Math.floor(p.x + 14 + this.half)); i++) {
          if (w.mine.inHole(i - this.half + 0.5, j - this.half + 0.5)) this.blocked[j * this.size + i] = 1;
        }
      }
    }
    // a deck is walked onto where the ground comes up to it, never over a side that stands more than a
    // step above the ground beside it: cut those steps, or the field leads the horde into the water under
    // the pier. A step from the ground stays only where all the ground it can be taken from (the cell
    // beside the deck, and what the deck leaves uncovered of its own cell) is within reach of the planks.
    // (Steps to blocked cells are left alone: nothing enters them anyway, and a field seeded from a
    // survivor in one, at the very edge of the deck, still has to flow onto it.)
    const box = this.deckBox;
    for (const [k, top] of this.deck) {
      const i = k % this.size;
      const j = (k - i) / this.size;
      box.i0 = Math.min(box.i0, i - 1);
      box.j0 = Math.min(box.j0, j - 1);
      box.i1 = Math.max(box.i1, i + 1);
      box.j1 = Math.max(box.j1, j + 1);
      const open = this._lowest(k, true);
      for (let n = 0; n < 8; n++) {
        const ni = i + NDI[n];
        const nj = j + NDJ[n];
        if (ni < 0 || nj < 0 || ni >= this.size || nj >= this.size) continue;
        const nk = nj * this.size + ni;
        if (this.blocked[nk] || this.deck.has(nk)) continue;
        if (top - Math.min(open, this._lowest(nk, true)) <= STEP_HEIGHT) continue;
        this.edge[k] |= 1 << n;
        this.edge[nk] |= 1 << OPP[n];
        this.rim.set(nk, top);
      }
    }
  }

  // Close every gap between two walls that a body cannot get through. Two walls that touch leave none; a doorway
  // (1.1 m and up) is left open. Between boxes every corner of one is measured to the other, so two walls side by side
  // the whole way (a slot) are closed at both ends.
  _bridgeGaps(walls) {
    this.walls = new Set(walls);
    const grid = this.world.staticGrid;
    const index = new Map(walls.map((c, k) => [c, k]));
    const q = [];
    for (let k = 0; k < walls.length; k++) {
      const a = walls[k];
      grid.query(a.x, a.z, a.r + GAP, q);
      for (const b of q) {
        if (!(index.get(b) > k)) continue; // (each pair once; b is a wall)
        gapsBetween(a, b, (x0, z0, x1, z1) => this._bridge(x0, z0, x1, z1));
      }
    }
  }
  // a wall of the grid's own along (x0,z0)-(x1,z1), across a gap too narrow for a body
  _bridge(x0, z0, x1, z1) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = Math.atan2(-(z1 - z0), x1 - x0); // (makeBox's frame: local +x runs along (cos yaw, -sin yaw))
    const hx = len / 2 + 0.05;
    const hz = 0.04;
    const c = { type: BOX, x: (x0 + x1) / 2, z: (z0 + z1) / 2, y0: 0, y1: 0, hx, hz, c: Math.cos(yaw), s: Math.sin(yaw), yaw, r: Math.hypot(hx, hz), flags: COL.STATIC, id: 0, stamp: 0, cells: null };
    this.bridges.add(c);
    this.bridgeGrid.add(c);
    this._cutEdges(c);
    this._raster(c, (k) => (this.nearWall[k] = 1), NEAR_WALL);
  }
  // the walls near (x,z) to test a step against: the static world's (filter by solid) and the grid's own bridges
  _wallsNear(x, z, r, bridges = true) {
    const q = this.world.staticGrid.query(x, z, r, this._q);
    if (bridges) for (const b of this.bridgeGrid.query(x, z, r, this._qb)) q.push(b);
    return q;
  }

  // is (x,z) under the planks of a deck
  _decked(x, z) {
    for (const d of this.decks) if (footprintContains(d, x, z)) return true;
    return false;
  }

  // lowest terrain in cell k, sampled at its centre and corners; open: only where no deck is overhead
  _lowest(k, open) {
    const cx = (k % this.size) - this.half + 0.5;
    const cz = Math.floor(k / this.size) - this.half + 0.5;
    let low = Infinity;
    for (let n = 0; n < 5; n++) {
      const x = cx + CELL_X[n];
      const z = cz + CELL_Z[n];
      if (!open || !this._decked(x, z)) low = Math.min(low, this.world.heightAt(x, z));
    }
    return low;
  }

  // Decks: slabs that are a level of their own to walk on, as a pier is all the way out from the shore.
  // Fills this.decks (the slabs) and this.deck (every cell whose centre is under their planks).
  _markDecks(slabs, floors) {
    const w = this.world;
    const add = (c) => {
      this.decks.add(c);
      this._raster(c, (k) => this.deck.set(k, Math.max(c.y1, this.deck.get(k) ?? c.y1)), 0);
    };
    for (const c of slabs) {
      // a deck where the lake is under it or it hangs too low to walk beneath (a ceiling does neither), and
      // it stands more than a step above the ground
      let deck = false;
      this._raster(c, (k) => {
        const x = (k % this.size) - this.half + 0.5;
        const z = Math.floor(k / this.size) - this.half + 0.5;
        deck = deck || ((c.y0 < w.heightAt(x, z) + DECK_HEADROOM || w.isDeepWater(x, z)) && c.y1 - this._lowest(k, false) > STEP_HEIGHT);
      }, 0);
      if (deck) add(c);
    }
    // a pier's planks nearest the shore lie low enough at their centre to pass for a floor: whatever
    // joins a deck at its own height is deck as well, back to where the ground meets it
    for (let grew = true; grew; ) {
      grew = false;
      for (const c of floors) {
        if (this.decks.has(c)) continue;
        let joined = false;
        for (const d of this.decks) joined = joined || (Math.abs(d.y1 - c.y1) < 0.01 && Math.hypot(d.x - c.x, d.z - c.z) < d.r + c.r);
        if (!joined) continue;
        add(c);
        grew = true;
      }
    }
  }

  // cut every cell-to-cell step (center to center) that passes through collider c
  _cutEdges(c) {
    const r = c.r + 1.5;
    const i0 = Math.max(0, Math.floor(c.x - r + this.half));
    const i1 = Math.min(this.size - 1, Math.floor(c.x + r + this.half));
    const j0 = Math.max(0, Math.floor(c.z - r + this.half));
    const j1 = Math.min(this.size - 1, Math.floor(c.z + r + this.half));
    for (let j = j0; j <= j1; j++) {
      const az = j - this.half + 0.5;
      for (let i = i0; i <= i1; i++) {
        const ax = i - this.half + 0.5;
        for (const n of HALF_DIRS) {
          const ni = i + NDI[n];
          const nj = j + NDJ[n];
          if (ni < 0 || nj < 0 || ni >= this.size || nj >= this.size) continue;
          if (!segHits(c, ax, az, ax + NDI[n], az + NDJ[n], EDGE_PAD)) continue;
          this.edge[j * this.size + i] |= 1 << n;
          this.edge[nj * this.size + ni] |= 1 << OPP[n];
        }
      }
    }
  }

  // straight 2D line (x0,z0)->(x1,z1) misses every static wall the grid knows about and does not go up or
  // down the side of a deck (player structures, trees and terrain are not considered)
  segClear(x0, z0, x1, z1) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const q = this._wallsNear((x0 + x1) / 2, (z0 + z1) / 2, len / 2 + 0.1);
    if (!this._clearAmong(q, x0, z0, x1, z1)) return false;
    for (let i = 0; i < q.length; i++) if (this.decks.has(q[i]) && this._deckSide(q[i], x0, z0, x1, z1, len)) return false;
    return true;
  }
  // does the walk (x0,z0)->(x1,z1) cross an edge of deck c where the ground outside it is a step or more
  // below (the lake, the shallows beside a pier)? The end of a deck that meets the ground is fine.
  _deckSide(c, x0, z0, x1, z1, len) {
    const n = Math.ceil(len / 0.25);
    let px = x0;
    let pz = z0;
    let on = footprintContains(c, x0, z0);
    for (let i = 1; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const z = z0 + ((z1 - z0) * i) / n;
      // (whoever stands at the far end may be on the very edge: feet hold on a little past it)
      const now = footprintContains(c, x, z, i === n ? 0.25 : 0);
      // the sample off the deck: what is underfoot there for feet at deck height
      if (now !== on && c.y1 - groundAt(this.world, on ? x : px, on ? z : pz, c.y1, 0, false) > STEP_HEIGHT) return true;
      on = now;
      px = x;
      pz = z;
    }
    return false;
  }
  // (the bridges in the list count as walls: _wallsNear leaves them out where they must not)
  _clearAmong(list, x0, z0, x1, z1) {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if ((this.solid.has(c) || this.bridges.has(c)) && segHits(c, x0, z0, x1, z1, EDGE_PAD)) return false;
    }
    return true;
  }
  // Is the step from cell k toward neighbor n one up or down the side of a deck that the grid has cut? Beside a
  // wall a step is tested against the real walls instead of the grid's mask (_clearAmong), and the side of a
  // deck is no wall: without this the dead in the cut beside a boxcar, or on the track under a platform with a
  // post near its edge, are sent up a drop they cannot climb.
  _deckStep(k, n) {
    return (this.edge[k] & (1 << n)) !== 0 && this.deck.has(k) !== this.deck.has(k + NDJ[n] * this.size + NDI[n]);
  }

  // which cells a flow field starts from for a survivor at (x,z): bit 0 their own cell, bit n+1 neighbor n.
  // Away from walls just the own cell; beside one, every nearby cell center the survivor can actually walk to.
  // PERCH when there is none (they stand on top of something): the cells are in this.seeds, see _perch.
  _sources(x, z) {
    const i = Math.floor(x + this.half);
    const j = Math.floor(z + this.half);
    if (i < 1 || j < 1 || i >= this.size - 1 || j >= this.size - 1 || !this.nearWall[j * this.size + i]) return 1;
    // (no bridges: a survivor squeezed into a slot is still got at from either end of it, as near as a body comes)
    const q = this._wallsNear(x, z, 2, false);
    const cx = i - this.half + 0.5;
    const cz = j - this.half + 0.5;
    let m = this._clearAmong(q, x, z, cx, cz) ? 1 : 0;
    for (let n = 0; n < 8; n++) {
      if (this.blocked[(j + NDJ[n]) * this.size + i + NDI[n]]) continue;
      if (this._deckStep(j * this.size + i, n)) continue; // (the ground under the side of the deck they stand on is no way to them)
      if (this._clearAmong(q, x, z, cx + NDI[n], cz + NDJ[n])) m |= 2 << n;
    }
    if (!m && this._perch(x, z, i, j)) return PERCH;
    return m || 1;
  }

  // A survivor standing on something (a car roof, a dumpster, a table): no cell center around can be walked to from
  // there, every step crosses what they stand on, so a field started at their own cell reaches nothing and the horde
  // has no path. Start it from the ground around the perch instead: the walkable cells with a straight line to the
  // survivor that crosses no wall but the one under their feet, the nearest of them and those within a step further
  // (the dead close in on every side they can get near from, and walk round to it from the others). The same goes
  // for a survivor wedged between two props. Fills this.seeds; false if there is no such cell.
  _perch(x, z, i, j) {
    // the walls that can be in the way: every one in reach of the window but those under the survivor's feet
    const q = this.world.staticGrid.query(x, z, PERCH_R * 1.5 + 1.5, this._q);
    let n = 0;
    for (let k = 0; k < q.length; k++) if (this.solid.has(q[k]) && !segHits(q[k], x, z, x, z, EDGE_PAD)) q[n++] = q[k];
    q.length = n;
    let near = INF;
    n = 0;
    // nearest first (measured between cell centers: the field stays the same while the survivor stays in their cell)
    for (let k = 0; k < PERCH_CELLS.length; k++) {
      const [di, dj, d] = PERCH_CELLS[k];
      if (d > near + PERCH_RING) break;
      const gi = i + di;
      const gj = j + dj;
      if (gi < 0 || gj < 0 || gi >= this.size || gj >= this.size || this.blocked[gj * this.size + gi]) continue;
      if (!this._clearAmong(q, x, z, gi - this.half + 0.5, gj - this.half + 0.5)) continue;
      if (near === INF) near = d;
      this.seeds[n++] = (((dj + PERCH_R) * PERCH_W + di + PERCH_R) << 8) | (d - near);
    }
    this.seedN = n;
    return n > 0;
  }

  addStructure(c) {
    if (c.flags & COL.NOBLOCK) return;
    for (const k of this._structCells(c)) {
      const v = (this.structCost[k] += STRUCT_COST);
      if (v > this.maxStructCost) this.maxStructCost = v;
    }
    this.structVer++;
  }
  removeStructure(c) {
    if (c.flags & COL.NOBLOCK) return;
    for (const k of this._structCells(c)) this.structCost[k] = Math.max(0, this.structCost[k] - STRUCT_COST);
    this.structVer++;
  }
  // The cells a structure makes dear: its own, and those of any gap too narrow for a body between it and the static
  // world (a gate put up a hand's breadth from the end of a fence). Through such a gap the field would lead the dead
  // to wedge against the fence, where there is nothing to claw at; priced like the piece, it is the piece they go
  // for. (The static world never changes, so removing a structure finds the same cells again.)
  _structCells(c) {
    const cells = new Set();
    const add = (k) => cells.add(k);
    this._raster(c, add, 0.35);
    for (const o of this.world.staticGrid.query(c.x, c.z, c.r + GAP, this._q)) {
      if (!this.walls.has(o) || o.y1 <= c.y0 || o.y0 >= c.y1) continue; // (not on another level: over a drift of the mine)
      gapsBetween(c, o, (x0, z0, x1, z1) => {
        const len = Math.hypot(x1 - x0, z1 - z0);
        const yaw = Math.atan2(-(z1 - z0), x1 - x0);
        const s = { type: BOX, x: (x0 + x1) / 2, z: (z0 + z1) / 2, hx: len / 2, hz: 0.01, c: Math.cos(yaw), s: Math.sin(yaw), r: len / 2 + 0.01 };
        this._raster(s, add, 0.35);
      });
    }
    return cells;
  }

  isBlocked(x, z) {
    const k = this._cellIndex(x, z);
    return k < 0 || this.blocked[k] === 1;
  }

  // The dead on the valley's ground, counted per cell (each of list has x, z): what a crowded cell costs a field solved
  // with crowd (computeField). Fields only go stale when some cell holds more than one, now or at the last count.
  setCrowd(list) {
    for (const k of this.crowdCells) this.crowd[k] = 0;
    this.crowdCells.length = 0;
    let jam = false;
    for (const e of list) {
      const k = this._cellIndex(e.x, e.z);
      if (k < 0) continue;
      if (!this.crowd[k]) this.crowdCells.push(k);
      else jam = true;
      if (this.crowd[k] < 255) this.crowd[k]++;
    }
    if (jam || this.jammed) this.crowdVer++;
    this.jammed = jam;
  }

  // (re)compute a flow field centered on (x,z) for playerId; crowd: crowded cells cost extra (setCrowd)
  computeField(playerId, x, z, crowd = false) {
    let f = this.fields.get(playerId);
    if (!f) {
      f = { dist: new Int32Array(FIELD * FIELD), ox: 0, oz: 0, cx: x, cz: z, t: 0, ver: -1, cver: -1, src: 0, seeds: null };
      this.fields.set(playerId, f);
    }
    const cver = crowd ? this.crowdVer : -1;
    // standing where they stood, nothing built since: the field is the one already there
    if (f.ver === this.structVer && f.cver === cver && f.cx === x && f.cz === z) return f;
    const ox = Math.floor(x + this.half) - HALF_FIELD; // global cell origin
    const oz = Math.floor(z + this.half) - HALF_FIELD;
    const src = this._sources(x, z);
    f.cx = x;
    f.cz = z;
    // a field only depends on the survivor's cell (and which neighbors they can step to) and the
    // walkability / structure / crowd grids: when none changed since it was computed it is still exact
    if (f.ver === this.structVer && f.cver === cver && f.ox === ox && f.oz === oz && f.src === src && (src !== PERCH || this._sameSeeds(f.seeds))) return f;
    f.ox = ox;
    f.oz = oz;
    f.ver = this.structVer;
    f.cver = cver;
    f.src = src;
    if (src === PERCH) f.seeds = this.seeds.slice(0, this.seedN);
    this._solve(f.dist, ox, oz, src, crowd);
    return f;
  }
  _sameSeeds(seeds) {
    if (seeds.length !== this.seedN) return false;
    for (let k = 0; k < seeds.length; k++) if (seeds[k] !== this.seeds[k]) return false;
    return true;
  }

  // Dijkstra from the window center over 8-connected cells (10 straight, 14 diagonal, plus the entered
  // cell's structure cost, and its crowd's; no corner cutting, no step through a wall). Edge costs are small integers,
  // so the priority queue is a circular bucket queue (Dial's algorithm): O(1) push/pop, same distances as a heap.
  _solve(out, ox, oz, srcMask, crowd) {
    const blocked = this.blocked;
    const edge = this.edge;
    const scost = this.structCost;
    const ccount = crowd ? this.crowd : null;
    const pb = this.pBlocked;
    const pe = this.pEdge;
    const pc = this.pCost;
    const dist = this.pDist;
    // padded window: border cells and cells outside the map are blocked
    for (let pj = 0; pj < PW; pj++) {
      const gj = oz + pj - 1;
      const rowIn = pj > 0 && pj < PW - 1 && gj >= 0 && gj < this.size;
      for (let pi = 0; pi < PW; pi++) {
        const p = pj * PW + pi;
        const gi = ox + pi - 1;
        if (rowIn && pi > 0 && pi < PW - 1 && gi >= 0 && gi < this.size) {
          const gk = gj * this.size + gi;
          pb[p] = blocked[gk];
          pe[p] = edge[gk];
          pc[p] = scost[gk] * 10;
          if (ccount && ccount[gk] > 1) pc[p] += CROWD_COST * Math.min(CROWD_MAX, ccount[gk] - 1);
        } else {
          pb[p] = 1;
          pe[p] = 0;
          pc[p] = 0;
        }
      }
    }
    dist.fill(INF);
    let nb = 16;
    while (nb <= 14 + this.maxStructCost * 10 + (crowd ? CROWD_COST * CROWD_MAX : 0)) nb *= 2; // every pending cost fits in [cur, cur + nb)
    if (this.bucketHead.length < nb) this.bucketHead = new Int32Array(nb);
    const head = this.bucketHead;
    head.fill(-1, 0, nb);
    const mask = nb - 1;
    const eIdx = this.entryIdx;
    const eNext = this.entryNext;
    const center = (HALF_FIELD + 1) * PW + HALF_FIELD + 1;
    let en = 0;
    let pending = 0;
    // seed, survivor on a perch: the ground cells around it (walkable, picked by _perch), the nearest at 0 and
    // the rest at up to PERCH_RING (less than a step, so the bucket bound above still holds)
    for (let k = srcMask === PERCH ? this.seedN - 1 : -1; k >= 0; k--) {
      const v = this.seeds[k] >> 8;
      const q = center + (((v / PERCH_W) | 0) - PERCH_R) * PW + (v % PERCH_W) - PERCH_R;
      const c = this.seeds[k] & 255;
      dist[q] = c;
      eIdx[en] = q;
      eNext[en] = head[c];
      head[c] = en++;
      pending++;
    }
    // seed: the survivor's own cell at 0 and any extra source neighbors at their step cost
    for (let n = -1; n < 8; n++) {
      if (!(srcMask & (1 << (n + 1)))) continue;
      const q = n < 0 ? center : center + NOFF[n];
      const c = n < 0 ? 0 : NCOST[n];
      if (pb[q] && n >= 0) continue;
      dist[q] = c;
      eIdx[en] = q;
      eNext[en] = head[c];
      head[c] = en++;
      pending++;
    }
    for (let cur = 0; pending > 0; cur++) {
      const b = cur & mask;
      let e = head[b];
      if (e < 0) continue;
      head[b] = -1; // anything pushed while draining costs at least cur + 10: other buckets
      while (e >= 0) {
        const p = eIdx[e];
        e = eNext[e];
        pending--;
        if (dist[p] !== cur) continue; // superseded by a cheaper entry
        const cut = pe[p];
        for (let n = 0; n < 8; n++) {
          const q = p + NOFF[n];
          if (pb[q] || cut & (1 << n)) continue;
          // diagonal: disallow corner cutting
          if (n >= 4 && (pb[p + NDI[n]] || pb[p + NDJ[n] * PW])) continue;
          const nc = cur + NCOST[n] + pc[q];
          if (nc < dist[q]) {
            dist[q] = nc;
            const nbk = nc & mask;
            eIdx[en] = q;
            eNext[en] = head[nbk];
            head[nbk] = en++;
            pending++;
          }
        }
      }
    }
    for (let lj = 0; lj < FIELD; lj++) out.set(dist.subarray((lj + 1) * PW + 1, (lj + 1) * PW + 1 + FIELD), lj * FIELD);
  }

  removeField(playerId) {
    this.fields.delete(playerId);
  }

  // Direction (writes out.x,out.z normalized) following the field of playerId from (x,z).
  // Returns false if outside the field window, unreachable, or already in the survivor's cell.
  // y (optional): the height of the feet there, which tells a deck from the water under it.
  flowDir(playerId, x, z, out, y) {
    const f = this.fields.get(playerId);
    if (!f) return false;
    const gi = Math.floor(x + this.half);
    const gj = Math.floor(z + this.half);
    const li = gi - f.ox;
    const lj = gj - f.oz;
    if (li < 1 || lj < 1 || li >= FIELD - 1 || lj >= FIELD - 1) return false;
    const gk = gj * this.size + gi;
    // along the side of a deck two levels share a cell and the grid holds one of them. Feet on the other
    // (on the planks over a cell that belongs to the water beside them: 1, too far under a cell that belongs
    // to the deck to step up: -1) follow the field through cells of their own level only.
    let lvl = 0;
    const box = this.deckBox;
    if (y !== undefined && gi >= box.i0 && gi <= box.i1 && gj >= box.j0 && gj <= box.j1) {
      const top = this.deck.get(gk);
      if (top !== undefined) lvl = y < top - STEP_HEIGHT ? -1 : 0;
      else if (y > this.rim.get(gk) - 0.1) lvl = 1;
    }
    // beside a wall the cell center may be on the other side of it: test the actual steps from (x,z)
    const q = this.nearWall[gk] ? this._wallsNear(x, z, 2) : null;
    const cx = gi - this.half + 0.5;
    const cz = gj - this.half + 0.5;
    const d0 = f.dist[lj * FIELD + li];
    let best = INF;
    let bi = -2;
    if (!lvl && d0 < INF && (!q || this._clearAmong(q, x, z, cx, cz))) {
      best = d0;
      bi = -1;
    }
    for (let n = 0; n < 8; n++) {
      const d = f.dist[(lj + NDJ[n]) * FIELD + li + NDI[n]];
      if (d >= best) continue;
      if (lvl) {
        if (this.deck.has(gk + NDJ[n] * this.size + NDI[n]) !== lvl > 0) continue;
      } else if (q) {
        if (this._deckStep(gk, n) || !this._clearAmong(q, x, z, cx + NDI[n], cz + NDJ[n])) continue;
      } else if (this.edge[gk] & (1 << n) || (n >= 4 && (this.blocked[gk + NDI[n]] || this.blocked[gk + NDJ[n] * this.size]))) continue;
      best = d;
      bi = n;
    }
    // Beside a wall, off the middle of its cell, every way on can be round a corner from where it stands while the
    // field (which steps from middle to middle) still runs on from this cell: to the middle first. Without it, it
    // stops here and walks straight at whoever it is after, into the wall. (Not in the cells the field starts from.)
    if (bi === -1 && q && d0 > 14) {
      const l = Math.hypot(cx - x, cz - z);
      if (l > 0.1) {
        out.x = (cx - x) / l;
        out.z = (cz - z) / l;
        out.cost = d0;
        return true;
      }
    }
    // -1: the own cell is already the lowest (at the survivor); -2: nothing reachable from here
    if (bi < 0) return false;
    // aim at the center of the best neighbor cell
    const tx = cx + NDI[bi];
    const tz = cz + NDJ[bi];
    const dx = tx - x;
    const dz = tz - z;
    const l = Math.hypot(dx, dz) || 1;
    out.x = dx / l;
    out.z = dz / l;
    out.cost = d0;
    return true;
  }
}

// does segment (x0,z0)->(x1,z1) pass through collider c's footprint expanded by e
function segHits(c, x0, z0, x1, z1, e) {
  let dx = x0 - c.x;
  let dz = z0 - c.z;
  if (c.type === CYL) {
    const ux = x1 - x0;
    const uz = z1 - z0;
    const ll = ux * ux + uz * uz;
    const t = ll > 0 ? Math.max(0, Math.min(1, -(dx * ux + dz * uz) / ll)) : 0;
    const px = dx + ux * t;
    const pz = dz + uz * t;
    const rr = c.r + e;
    return px * px + pz * pz <= rr * rr;
  }
  // box: clip the segment against the slabs of the local frame
  const ax = c.c * dx - c.s * dz;
  const az = c.s * dx + c.c * dz;
  dx = x1 - c.x;
  dz = z1 - c.z;
  const ux = c.c * dx - c.s * dz - ax;
  const uz = c.s * dx + c.c * dz - az;
  let t0 = 0;
  let t1 = 1;
  const hx = c.hx + e;
  const hz = c.hz + e;
  if (Math.abs(ux) < 1e-9) {
    if (Math.abs(ax) > hx) return false;
  } else {
    let ta = (-hx - ax) / ux;
    let tb = (hx - ax) / ux;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  if (Math.abs(uz) < 1e-9) return Math.abs(az) <= hz;
  let ta = (-hz - az) / uz;
  let tb = (hz - az) / uz;
  if (ta > tb) [ta, tb] = [tb, ta];
  return Math.max(t0, ta) <= Math.min(t1, tb);
}

// Every gap too narrow for a body (GAP) between the footprints of colliders a and b: fn(x0, z0, x1, z1) from a point of
// one to the nearest point of the other. Nothing where they touch or overlap. Box to box: from each corner of either.
const _np = { x: 0, z: 0 };
function gapsBetween(a, b, fn) {
  if (a.type === CYL && b.type === CYL) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dz);
    const gap = d - a.r - b.r;
    if (gap > 0 && gap < GAP) fn(a.x + (dx / d) * a.r, a.z + (dz / d) * a.r, b.x - (dx / d) * b.r, b.z - (dz / d) * b.r);
    return;
  }
  if (a.type === CYL) [a, b] = [b, a];
  if (b.type === CYL) {
    nearestOnBox(a, b.x, b.z, _np);
    const dx = b.x - _np.x;
    const dz = b.z - _np.z;
    const d = Math.hypot(dx, dz);
    if (d - b.r > 0 && d - b.r < GAP) fn(_np.x, _np.z, b.x - (dx / d) * b.r, b.z - (dz / d) * b.r);
    return;
  }
  if (overlapBoxes(a, b)) return;
  for (const [p, o] of [[a, b], [b, a]]) {
    for (let n = 1; n < 5; n++) {
      const la = CELL_X[n] * 2 * p.hx;
      const lb = CELL_Z[n] * 2 * p.hz;
      const x = p.x + p.c * la + p.s * lb;
      const z = p.z - p.s * la + p.c * lb;
      nearestOnBox(o, x, z, _np);
      const gap = Math.hypot(_np.x - x, _np.z - z);
      if (gap > 0.001 && gap < GAP) fn(x, z, _np.x, _np.z);
    }
  }
}
// the point of box c's footprint nearest (x,z) (itself, inside it)
function nearestOnBox(c, x, z, out) {
  const dx = x - c.x;
  const dz = z - c.z;
  const lx = Math.max(-c.hx, Math.min(c.hx, c.c * dx - c.s * dz));
  const lz = Math.max(-c.hz, Math.min(c.hz, c.s * dx + c.c * dz));
  out.x = c.x + c.c * lx + c.s * lz;
  out.z = c.z - c.s * lx + c.c * lz;
  return out;
}

const NDI = [1, -1, 0, 0, 1, 1, -1, -1];
const NDJ = [0, 0, 1, -1, 1, -1, 1, -1];
const NCOST = [10, 10, 10, 10, 14, 14, 14, 14];
const OPP = [1, 0, 3, 2, 7, 6, 5, 4]; // index of the reverse step
const HALF_DIRS = [0, 2, 4, 5]; // one of each step pair (+x, +z, +x+z, +x-z)
const CELL_X = [0, -0.5, 0.5, -0.5, 0.5]; // a cell's centre and corners
const CELL_Z = [0, -0.5, -0.5, 0.5, 0.5];
const NOFF = NDI.map((di, n) => NDJ[n] * PW + di); // neighbor offsets in the padded window
// the cells of the PERCH_W x PERCH_W window around a survivor, nearest first: [di, dj, distance (x10 units)]
const PERCH_CELLS = [];
for (let dj = -PERCH_R; dj <= PERCH_R; dj++) for (let di = -PERCH_R; di <= PERCH_R; di++) PERCH_CELLS.push([di, dj, Math.round(Math.hypot(di, dj) * 10)]);
PERCH_CELLS.sort((a, b) => a[2] - b[2]);
