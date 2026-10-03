// Installs the whole procedural sound library into a Library (see library.js).
import * as foley from './foley.js';
import * as impacts from './impacts.js';
import * as voices from './voices.js';
import * as ui from './ui.js';
import * as vehicles from './vehicles.js';
import * as events from './events.js';

export function installAll(lib) {
  lib._installing = true; // defs created now are reproducible by name inside synthesis workers (remote: {fn:'lib'})
  try { foley.install(lib); impacts.install(lib); voices.install(lib); ui.install(lib); vehicles.install(lib); events.install(lib); } finally { lib._installing = false; }
  return lib;
}
