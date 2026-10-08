// A custom survivor's appearance (the character creator): the choices of shared/wardrobe.js, how they go on the wire,
// how they are kept, how the wardrobe's rules are applied to them and how the dice roll one. Shared: the server checks
// and canonicalises a JOIN's look with it, and every client turns it back into the same model.
//
// A look is held as values by name: { body: 'f', height: 0.99, hair: 'bun', hairColor: 'black', ... } - a pick or a
// swatch by its name, a slider by its value (always on one of its steps). By name is how a browser keeps it
// (client/ui/customs.js), so that a part being removed or renumbered loses only that part (fromNames). On the wire it
// is by id: u8 LOOK_FORMAT, u8 n, then n varu, field wire index i's value at place i (a pick's option id, a swatch's
// id, a slider's step); fields missing at the end, ids this build does not know and retired ones all become the field's
// default (decode), and a length byte goes in front of it in a message (writeLook / readLook).
import { FIELDS, PALETTES, SECTIONS, RETIRED_WIRE } from './wardrobe.js';

export const LOOK_FORMAT = 1;
const MAX_FIELDS = 160;
const MAX_BYTES = 255;

/** Everything here, for a wardrobe (the tests make their own, to remove and renumber parts in). */
export function createAppearance(fields = FIELDS, palettes = PALETTES, retiredWire = RETIRED_WIRE) {
  const byKey = new Map();
  const byWire = new Map();
  let wireLen = 0;
  for (const f of fields) {
    if (byKey.has(f.key)) throw new Error(`wardrobe: two fields called ${f.key}`);
    if (byWire.has(f.wire) || retiredWire.includes(f.wire)) throw new Error(`wardrobe: wire index ${f.wire} (${f.key}) is used twice or retired`);
    byKey.set(f.key, f);
    byWire.set(f.wire, f);
    wireLen = Math.max(wireLen, f.wire + 1);
  }
  for (const w of retiredWire) wireLen = Math.max(wireLen, w + 1);

  // each field's choices (a swatch field's: its palette's swatches, after "none" / "same" as id 0 when it has one)
  const choices = new Map(); // key -> [{ id, name, label, ...rules }]
  for (const f of fields) {
    let list;
    if (f.kind === 'pick') list = f.options;
    else if (f.kind === 'swatch') {
      const pal = palettes[f.palette];
      if (!pal) throw new Error(`wardrobe: ${f.key} names no palette ${f.palette}`);
      let sw = pal.swatches;
      if (f.only) sw = sw.filter((s) => f.only.includes(s.name));
      list = [...(f.none ? [{ id: 0, name: 'none', label: f.none }] : f.same ? [{ id: 0, name: 'same', label: f.same.label }] : []), ...sw];
    } else continue;
    const ids = new Set(), names = new Set();
    const retired = f.kind === 'swatch' ? palettes[f.palette].retired || [] : f.retired || [];
    for (const o of list) {
      if (ids.has(o.id) || names.has(o.name)) throw new Error(`wardrobe: ${f.key} has two ${o.id} / ${o.name}`);
      if (retired.includes(o.id)) throw new Error(`wardrobe: ${f.key} uses retired id ${o.id} (${o.name})`);
      ids.add(o.id);
      names.add(o.name);
    }
    choices.set(f.key, list);
  }
  const offered = (f) => choices.get(f.key).filter((o) => o.offer !== false);
  const choice = (f, name) => choices.get(f.key)?.find((o) => o.name === name) || null;
  const choiceById = (f, id) => choices.get(f.key)?.find((o) => o.id === id) || null;
  const isOffered = (f, name) => {
    const o = choice(f, name);
    return !!o && o.offer !== false;
  };
  const fallback = (f) => (isOffered(f, f.default) ? f.default : offered(f)[0]?.name ?? f.default);
  // a slider's steps: evenly from its low end to its default and on from there to its high end, so that all three are
  // exactly on a step (the roster's 1.0 is 1.0, not 0.999)
  const mid = (f) => Math.round((f.steps * (f.default - f.range[0])) / (f.range[1] - f.range[0]));
  const valueAt = (f, k) => {
    const [lo, hi] = f.range, d = mid(f), def = f.default;
    k = Math.min(f.steps, Math.max(0, k | 0));
    return +(k <= d ? (d ? lo + ((def - lo) * k) / d : def) : def + ((hi - def) * (k - d)) / (f.steps - d)).toFixed(6);
  };
  const step = (f, v) => {
    const [lo, hi] = f.range, d = mid(f), def = f.default;
    const x = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
    return x <= def ? (d && def > lo ? Math.round(((x - lo) / (def - lo)) * d) : d) : d + Math.round(((x - def) / (hi - def)) * (f.steps - d));
  };
  const quant = (f, v) => valueAt(f, step(f, v));

  /** The defaults: every field at its own. */
  function defaults() {
    const v = {};
    for (const f of fields) v[f.key] = f.kind === 'slider' ? quant(f, f.default) : fallback(f);
    return v;
  }

  /** Every field a value it may have: an offered choice, a slider on a step (anything else: the field's default). */
  function clean(values) {
    const v = {};
    for (const f of fields) {
      const x = values ? values[f.key] : undefined;
      if (f.kind === 'slider') v[f.key] = quant(f, typeof x === 'number' ? x : f.default);
      else v[f.key] = isOffered(f, x) ? x : fallback(f);
    }
    return v;
  }

  // does a name fall in a rule's list ('*': anything but none)
  const listed = (list, name) => !!list && (list.includes(name) || (list.includes('*') && name !== 'none' && name !== 'same'));
  // the other fields' choices that rule out `name` for field f (given the rest of v)
  function blockers(v, f, name) {
    const out = [];
    for (const g of fields) {
      if (g === f || g.kind === 'slider') continue;
      const o = choice(g, v[g.key]);
      if (!o) continue;
      if ((o.allow && o.allow[f.key] && !o.allow[f.key].includes(name)) || (o.excludes && listed(o.excludes[f.key], name))) out.push({ g, o });
    }
    // ...and the rules of `name` itself on the others
    const own = choice(f, name);
    if (own)
      for (const g of fields) {
        if (g === f || g.kind === 'slider') continue;
        const gv = v[g.key];
        if ((own.allow && own.allow[g.key] && !own.allow[g.key].includes(gv)) || (own.excludes && listed(own.excludes[g.key], gv))) out.push({ g, o: choice(g, gv), own: true });
      }
    return out;
  }
  const fine = (v, f, name) => blockers(v, f, name).length === 0;

  /**
   * The wardrobe's rules applied: every field an offered choice that no other choice rules out. lock: the field just
   * set (the creator), which keeps its value - the fields in its way move instead. The others move to what the choice
   * in their way asks for (its `defaults`), else their own default, else their first choice that fits.
   */
  function normalize(values, { lock = null } = {}) {
    const v = clean(values);
    const lf = lock ? byKey.get(lock) : null;
    const order = lf ? [lf, ...fields.filter((f) => f !== lf)] : fields;
    for (let pass = 0; pass < 8; pass++) {
      let moved = false;
      for (const f of order) {
        if (f.kind === 'slider') continue;
        const bad = blockers(v, f, v[f.key]);
        if (!bad.length) continue;
        if (f === lf) {
          // the locked field stays: what is in its way goes, to its default or its first choice that does not clash
          for (const { g } of bad) {
            const cands = [g.default, ...offered(g).map((o) => o.name)];
            const to = cands.find((c) => isOffered(g, c) && fine({ ...v, [g.key]: c }, f, v[f.key]) && fine({ ...v, [g.key]: c }, g, c));
            const to2 = to ?? cands.find((c) => isOffered(g, c) && fine({ ...v, [g.key]: c }, f, v[f.key]));
            if (to2 !== undefined && to2 !== v[g.key]) {
              v[g.key] = to2;
              moved = true;
            }
          }
        } else {
          const cands = [];
          for (const { o, own } of bad) if (!own && o && o.defaults && o.defaults[f.key]) cands.push(o.defaults[f.key]);
          cands.push(f.default, ...offered(f).map((o) => o.name));
          const to = cands.find((c) => isOffered(f, c) && fine(v, f, c));
          if (to !== undefined && to !== v[f.key]) {
            v[f.key] = to;
            moved = true;
          } else if (to === undefined) {
            // nothing of f fits what the others are: the first of them in its way goes back to its default
            const { g } = bad[0];
            if (g !== lf && v[g.key] !== fallback(g)) {
              v[g.key] = fallback(g);
              moved = true;
            }
          }
        }
      }
      if (!moved) break;
    }
    return v;
  }

  /** The fields a look breaks the rules in (none, after normalize). */
  function violations(values) {
    const out = [];
    for (const f of fields) if (f.kind !== 'slider' && blockers(values, f, values[f.key]).length) out.push(f.key);
    return out;
  }

  // a field's `when`: { field, in | not | has }, [all of these], or { any: [one of these] }
  function holds(values, w) {
    if (Array.isArray(w)) return w.every((x) => holds(values, x));
    if (w.any) return w.any.some((x) => holds(values, x));
    const x = values[w.field];
    if (w.in) return w.in.includes(x);
    if (w.not) return !w.not.includes(x);
    if (w.has) {
      const o = choice(byKey.get(w.field), x);
      return !!o && o[w.has] !== undefined;
    }
    return true;
  }
  /** Whether a field matters with these values (its `when`): the creator shows only those. */
  function relevant(values, f) {
    if (typeof f === 'string') f = byKey.get(f);
    return !f || !f.when || holds(values, f.when);
  }

  /** The one form of a look (for the wire and as a key): normalised, and what does not matter put back to its default. */
  function canonical(values) {
    const v = normalize(values);
    for (const f of fields) if (!relevant(v, f)) v[f.key] = f.kind === 'slider' ? quant(f, f.default) : fallback(f);
    return v;
  }

  /** For the creator: each offered choice of a field, and what picking it would change of the others. */
  function optionsFor(values, key) {
    const f = byKey.get(key);
    return offered(f).map((o) => {
      const after = normalize({ ...values, [key]: o.name }, { lock: key });
      const changes = [];
      for (const g of fields) if (g !== f && g.kind !== 'slider' && after[g.key] !== values[g.key]) changes.push({ key: g.key, label: g.label, to: choice(g, after[g.key])?.label ?? after[g.key] });
      return { ...o, changes };
    });
  }

  // ---------------------------------------------------------------- the wire
  /** The bytes of a look: u8 format, u8 n, n varu. */
  function encode(values) {
    const v = clean(values);
    const out = [LOOK_FORMAT, wireLen];
    for (let w = 0; w < wireLen; w++) {
      const f = byWire.get(w);
      let x = 0;
      if (f) x = f.kind === 'slider' ? step(f, v[f.key]) : choice(f, v[f.key])?.id ?? 0;
      while (x >= 0x80) {
        out.push((x & 0x7f) | 0x80);
        x >>>= 7;
      }
      out.push(x);
    }
    return Uint8Array.from(out);
  }

  /** A look from its bytes (cleaned, not yet normalised), or null for bytes that are not one. */
  function decode(bytes) {
    if (!bytes || bytes.length < 2 || bytes.length > MAX_BYTES || bytes[0] !== LOOK_FORMAT) return null;
    const n = bytes[1];
    if (n > MAX_FIELDS) return null;
    let i = 2;
    const raw = {};
    for (let w = 0; w < n; w++) {
      let x = 0, shift = 0, b;
      do {
        if (i >= bytes.length || shift > 14) return null;
        b = bytes[i++];
        x |= (b & 0x7f) << shift;
        shift += 7;
      } while (b & 0x80);
      const f = byWire.get(w);
      if (!f) continue; // (retired, or a field from a newer build: its default here)
      if (f.kind === 'slider') raw[f.key] = valueAt(f, x);
      else {
        const o = choiceById(f, x);
        if (o) raw[f.key] = o.name;
      }
    }
    if (i !== bytes.length) return null;
    return clean(raw);
  }

  /** writeLook(w, values | null): u8 length, then the look's bytes (0: no look). */
  function writeLook(w, values) {
    const b = values ? encode(canonical(values)) : new Uint8Array(0);
    w.u8(b.length);
    for (const x of b) w.u8(x);
  }
  /** readLook(r): the bytes writeLook wrote (null for a length of 0); throws past the end as Reader does. */
  function readLook(r) {
    const n = r.u8();
    if (!n) return null;
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = r.u8();
    return b;
  }

  // ---------------------------------------------------------------- keys and codes
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function toCode(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
      const k = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
      for (let j = 0; j < k; j++) s += B64[(n >> (18 - 6 * j)) & 63];
    }
    return s;
  }
  function fromCode(s) {
    if (typeof s !== 'string' || s.length > 400) return null;
    const out = [];
    for (let i = 0; i < s.length; i += 4) {
      let n = 0;
      const k = Math.min(4, s.length - i);
      for (let j = 0; j < 4; j++) {
        const c = j < k ? B64.indexOf(s[i + j]) : 0;
        if (c < 0) return null;
        n |= c << (18 - 6 * j);
      }
      const nb = Math.floor((k * 6) / 8);
      for (let j = 0; j < nb; j++) out.push((n >> (16 - 8 * j)) & 255);
    }
    return Uint8Array.from(out);
  }
  /** A look's code: its canonical bytes as base64url (what &look= takes, and the model cache's key after 'a:'). */
  const lookCode = (values) => toCode(encode(canonical(values)));
  /** The look of a code (canonical), or null. */
  function fromLookCode(code) {
    const v = decode(fromCode(code));
    return v ? canonical(v) : null;
  }
  const lookKey = (values) => 'a:' + lookCode(values);
  const isLookKey = (ref) => typeof ref === 'string' && ref.startsWith('a:');
  /** A canonical look's bytes as the server keeps them (a plain array: it survives a deploy's saved game). */
  const canonicalBytes = (bytes) => {
    const v = decode(bytes);
    return v ? [...encode(canonical(v))] : null;
  };

  // ---------------------------------------------------------------- kept by name
  /**
   * A look kept by name (client/ui/customs.js), against this wardrobe: a part no longer in it, or no longer offered,
   * becomes the field's default (or its first choice), a field it does not have its default, a slider is clamped to
   * the range it has now - and then the rules again, so a replacement never makes a combination they forbid.
   * -> { values, repaired: [what had to change, by label] }
   */
  function fromNames(saved) {
    const src = saved && typeof saved === 'object' ? saved : {};
    const repaired = [];
    const raw = {};
    for (const f of fields) {
      if (!(f.key in src)) continue; // (a field added since: its default, and nothing lost)
      const x = src[f.key];
      if (f.kind === 'slider') {
        raw[f.key] = typeof x === 'number' ? x : f.default;
        if (typeof x !== 'number' || x < f.range[0] - 1e-6 || x > f.range[1] + 1e-6) repaired.push(f.label);
      } else if (isOffered(f, x)) raw[f.key] = x;
      else repaired.push(f.label);
    }
    for (const k of Object.keys(src)) if (!byKey.has(k)) repaired.push(k); // (a field that was taken out)
    const before = clean(raw);
    const values = normalize(before);
    for (const f of fields) if (values[f.key] !== before[f.key] && !repaired.includes(f.label)) repaired.push(f.label);
    return { values, repaired };
  }

  // ---------------------------------------------------------------- the dice
  const TONED = new Set(['topColor', 'trouserColor', 'layerColor', 'hatColor', 'underColor']);
  /**
   * A look made up: each field in turn, from what the fields before it allow, weighted (an option's weight; a choice's
   * `roll` makes the fields after it likelier or not, a feminine body a beard unlikely), the colours of the clothes
   * mostly quiet (one bright thing at most, the trousers earthy, a hi-vis vest hi-vis), the sliders near their
   * middles. keep / only: the values to start from and the sections to roll (the creator's dice for one section).
   */
  function randomLook(rng = Math.random, { keep = null, only = null, force = null } = {}) {
    const v = keep ? clean(keep) : defaults();
    const roll = {};
    let bright = 0;
    const done = new Set();
    for (const f of fields) {
      const free = (!only || only.includes(f.section)) && !(force && f.key in force);
      if (!free) {
        if (force && f.key in force) v[f.key] = force[f.key];
        done.add(f.key);
        continue;
      }
      if (f.kind === 'slider') {
        const set = choice(byKey.get('body'), v.body)?.sets;
        const mid = set && f.key in set ? set[f.key] : f.default;
        const [lo, hi] = f.range;
        const spread = (hi - lo) * (f.key === 'age' || f.key === 'gaunt' || f.key === 'belly' ? 0.35 : 0.5);
        v[f.key] = quant(f, mid + (rng() + rng() - 1) * spread);
        done.add(f.key);
        continue;
      }
      // what the fields already decided allow (the rest are not yet chosen: they do not count)
      const decided = (g) => done.has(g.key);
      const ok = offered(f).filter((o) => {
        for (const { g } of blockers(v, f, o.name)) if (decided(g)) return false;
        return true;
      });
      if (!ok.length) {
        done.add(f.key);
        continue;
      }
      const prefer = [];
      for (const g of fields) {
        const o = done.has(g.key) && g.kind !== 'slider' ? choice(g, v[g.key]) : null;
        if (o && o.prefer && o.prefer[f.key]) prefer.push(...o.prefer[f.key]);
      }
      if (f.prefer) prefer.push(...f.prefer);
      const colours = ok.filter((o) => o.hex !== undefined).length;
      const w = ok.map((o) => {
        let x = o.weight ?? 1;
        // (a colour or none - glasses, gloves, a belt: none is noneOdds times likelier than all the colours together)
        if (f.kind === 'swatch' && o.name === 'none') x = Math.max(1, colours) * (f.noneOdds ?? 1);
        if (o.name !== 'none' && roll[f.key] !== undefined) x *= roll[f.key];
        if (f.kind === 'swatch' && o.tags) {
          if (prefer.length) x *= o.tags.some((t) => prefer.includes(t)) ? 4 : 0.15;
          if (TONED.has(f.key) && o.tags.includes('bright') && bright) x *= 0.15;
          if (TONED.has(f.key) && o.tags.includes('hivis') && !prefer.includes('hivis')) x *= 0.1;
        }
        return Math.max(0, x);
      });
      const sum = w.reduce((a, b) => a + b, 0);
      let t = rng() * sum, k = 0;
      while (k < ok.length - 1 && (t -= w[k]) > 0) k++;
      const o = ok[k];
      v[f.key] = o.name;
      if (TONED.has(f.key) && o.tags && o.tags.includes('bright')) bright++;
      if (o.roll) for (const [g, m] of Object.entries(o.roll)) roll[g] = (roll[g] ?? 1) * m;
      done.add(f.key);
    }
    return normalize(v, { lock: force ? Object.keys(force)[0] : null });
  }
  /** The look with one section rolled again (the creator's dice on a tab). */
  const rerollSection = (values, section, rng = Math.random) => randomLook(rng, { keep: values, only: [section] });

  // ---------------------------------------------------------------- for the tests and the clip sweeps
  /**
   * Looks that between them wear every offered choice of every pick field (each on a made-up body; bodies: 'extremes'
   * puts each on the smallest and the biggest of both bodies instead), plus `randoms` made up wholly. -> [{ label, values }]
   */
  function coveringLooks({ randoms = 0, seed = 1, bodies = 'random', colours = false } = {}) {
    const out = [];
    const rngOf = (s) => mulberry(s);
    const BODY = { lo: 0, hi: 1 };
    const shape = (v, b, end) => {
      const r = { ...v, body: b };
      for (const k of ['height', 'build', 'shoulders', 'arms', 'legs', 'neck', 'head']) {
        const f = byKey.get(k);
        if (f) r[k] = quant(f, f.range[end === 'lo' ? 0 : 1]);
      }
      return r;
    };
    let s = seed;
    for (const f of fields) {
      if (f.kind === 'slider' || (f.kind === 'swatch' && !colours && !f.none)) continue;
      for (const o of offered(f)) {
        if (f.kind === 'swatch' && !colours && o.name !== 'none' && o !== offered(f)[1]) continue; // (a swatch field with none: none and one colour)
        const base = randomLook(rngOf(s++), { force: { [f.key]: o.name } });
        if (base[f.key] !== o.name) continue; // (cannot be worn at all: the guard test says so)
        if (bodies === 'extremes') {
          for (const b of ['m', 'f']) for (const end of ['lo', 'hi']) out.push({ label: `${f.key}:${o.name}@${b}${end}`, values: normalize(shape(base, b, end), { lock: f.key }) });
        } else out.push({ label: `${f.key}:${o.name}`, values: base });
      }
    }
    for (let i = 0; i < randoms; i++) out.push({ label: `random:${seed + i}`, values: randomLook(rngOf(seed * 7919 + i)) });
    void BODY;
    return out;
  }

  return {
    fields, palettes, byKey, choices, offered, choice, choiceById, fallback, quant, step, valueAt, defaults, clean, normalize, violations,
    relevant, canonical, optionsFor, encode, decode, writeLook, readLook, lookCode, fromLookCode, lookKey, isLookKey,
    canonicalBytes, fromNames, randomLook, rerollSection, coveringLooks, wireLen, sections: SECTIONS, toCode, fromCode,
  };
}

// a small seeded generator (the same as client/render/models/skinning.js mulberry32: shared code may not import that)
export function mulberry(a) {
  a >>>= 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The wardrobe's own: what the game uses. */
export const APPEARANCE = createAppearance();
export const {
  defaults, clean, normalize, violations, relevant, canonical, optionsFor, encode, decode, writeLook, readLook, lookCode,
  fromLookCode, lookKey, isLookKey, canonicalBytes, fromNames, randomLook, rerollSection, coveringLooks,
} = APPEARANCE;
