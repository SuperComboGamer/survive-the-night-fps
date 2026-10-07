// Game content definitions shared by client and server.
// Numeric ids are part of the wire protocol - do not renumber.
import { FLASHLIGHT_MAX, STAMINA_MAX } from './constants.js';

// ---------------------------------------------------------------- items
export const ITEM = {
  NONE: 0,
  // resources
  WOOD: 1,
  STICK: 2,
  CLOTH: 3,
  SCRAP: 4,
  NAILS: 5,
  ROPE: 6,
  TAPE: 7,
  POWDER: 8,
  CHEM: 9,
  HERB: 10,
  ALCOHOL: 11,
  LEATHER: 12,
  WIRE: 13,
  PLATE: 14,
  GUNPARTS: 15,
  // (16 is no item: the mounted gun's shots and kills carry it as their weapon, MOUNTED_GUN in mountedgun.js)
  // consumables
  BANDAGE: 20,
  MEDKIT: 21,
  PAINKILLERS: 22,
  BATTERY: 23,
  TORCH: 24,
  TUNA: 25,
  // throwables
  MOLOTOV: 30,
  PIPEBOMB: 31,
  FLARE: 32,
  GRENADE: 33,
  DECOY: 34,
  // armor
  JACKET: 40,
  KEVLAR: 41,
  // gear (works from the backpack, just by being carried)
  WALKIE: 45,
  // worn in an equipment slot of its own, like armor: more slots in the backpack grid (INVENTORY_SIZE in constants.js)
  BACKPACK: 46,
  // weapons
  KNIFE: 50,
  BAT: 51,
  SPIKED_BAT: 52,
  MACHETE: 53,
  HAMMER: 54,
  PISTOL: 55,
  FLARE_GUN: 56, // a sidearm (the pistol's slot): one parachute flare at a time, up into the sky (shared/skyflare.js)
  NUNCHAKU: 57, // melee with a moveset of its own: combos, a wound-up heavy, a simulated chain (shared/nunchaku.js)
  SHOTGUN: 60,
  AK47: 61,
  HUNTING_RIFLE: 62,
  M4A1: 63,
  MP5: 64,
  DB_SHOTGUN: 65,
  CROSSBOW: 66,
  FLAMETHROWER: 67,
  RPG: 68,
  AT_RIFLE: 69,
  // ammunition (carried apart from the backpack, a reserve per calibre: state.ammo, AMMO below)
  AMMO_9MM: 70,
  AMMO_SHELLS: 71,
  AMMO_762: 72,
  AMMO_308: 73,
  AMMO_556: 74,
  AMMO_BOLTS: 75,
  AMMO_FUEL: 76,
  AMMO_ROCKET: 77,
  AMMO_145: 78,
  AMMO_FLARE: 79,
  // car parts (quest)
  CAR_BATTERY: 80,
  SPARE_TIRE: 81,
  SPARK_PLUGS: 82,
  FUEL_CAN: 83,
  FAN_BELT: 84,
  // plane parts (act 2, the mainland: shared/acts.js)
  PROPELLER: 85,
  MAGNETO: 86,
  HYDRAULIC_PUMP: 87,
  FLIGHT_RADIO: 88,
  AVGAS: 89,
  // schematics (picked up -> unlocks recipes for the whole team)
  SCHEM_SHOTGUN: 90,
  SCHEM_RIFLE: 91,
  SCHEM_KEVLAR: 92,
  SCHEM_EXPLOSIVES: 93,
  SCHEM_METAL: 94,
  // the mainland's (shared/vehicles.js): a manual found beside its broken mopeds, and what a workbench makes with it.
  // Nothing of these is on the island: the manual is not among SCHEMATICS (which the island hides in its lockers)
  SCHEM_VEHICLES: 95,
  MOPED_KIT: 96,
  BIKE_KIT: 97,
  // consumables: what a hunted deer gives (shared/deer.js)
  VENISON_RAW: 26,
  VENISON: 27,
  // consumables: refills stamina, with a key of its own (ACTION_KEYS.drink in client/game/input.js)
  ENERGY_DRINK: 28,
};

// ammo reserve indices: the rounds of a calibre a survivor carries (state.ammo). Ammunition is not kept in the
// backpack: it is carried apart, in the inventory's Ammunition panel, and goes on the ground from there (ACT.DROP_AMMO)
export const AMMO = { P9: 0, SHELL: 1, R762: 2, R308: 3, R556: 4, BOLT: 5, FUEL: 6, ROCKET: 7, R145: 8, FLARE: 9 };
export const AMMO_NAMES = ['9mm', 'Shells', '7.62', '.308', '5.56', 'Bolts', 'Fuel', 'RPG', '14.5mm', 'Flares'];
// the most of a calibre a survivor carries: a reserve that is full leaves the rest where it lies (also a ground stack's size)
export const AMMO_MAX = [150, 48, 240, 40, 180, 30, 300, 8, 10, 12];
// the item of each reserve index (same order as AMMO)
export const AMMO_ITEMS = [ITEM.AMMO_9MM, ITEM.AMMO_SHELLS, ITEM.AMMO_762, ITEM.AMMO_308, ITEM.AMMO_556, ITEM.AMMO_BOLTS, ITEM.AMMO_FUEL, ITEM.AMMO_ROCKET, ITEM.AMMO_145, ITEM.AMMO_FLARE];

// category: res | cons | throw | armor | pack | gear | weapon | ammo | part | schem
export const ITEM_DEFS = {
  [ITEM.WOOD]: { name: 'Planks', cat: 'res', stack: 20, color: 0x8a6a45, desc: 'Weathered wooden planks.' },
  [ITEM.STICK]: { name: 'Sticks', cat: 'res', stack: 20, color: 0x6b5236, desc: 'Dry branches.' },
  [ITEM.CLOTH]: { name: 'Cloth', cat: 'res', stack: 20, color: 0xb8ad94, desc: 'Torn fabric scraps.' },
  [ITEM.SCRAP]: { name: 'Scrap Metal', cat: 'res', stack: 20, color: 0x7a7d80, desc: 'Rusty sheet metal.' },
  [ITEM.NAILS]: { name: 'Nails', cat: 'res', stack: 60, color: 0x9a9fa3, desc: 'A handful of bent nails.' },
  [ITEM.ROPE]: { name: 'Rope', cat: 'res', stack: 10, color: 0xa08a5a, desc: 'Coarse hemp rope.' },
  [ITEM.TAPE]: { name: 'Duct Tape', cat: 'res', stack: 10, color: 0x9ea3a8, desc: 'Fixes everything.' },
  [ITEM.POWDER]: { name: 'Gunpowder', cat: 'res', stack: 30, color: 0x2e2e2e, desc: 'Black powder.' },
  [ITEM.CHEM]: { name: 'Chemicals', cat: 'res', stack: 10, color: 0x6fae3a, desc: 'Unlabeled chemical jugs.' },
  [ITEM.HERB]: { name: 'Herbs', cat: 'res', stack: 10, color: 0x4d7a36, desc: 'Medicinal plants.' },
  [ITEM.ALCOHOL]: { name: 'Alcohol', cat: 'res', stack: 10, color: 0xc4a35a, desc: 'Cheap whiskey. Burns well.' },
  [ITEM.LEATHER]: { name: 'Leather', cat: 'res', stack: 10, color: 0x6e4a2e, desc: 'Tanned hide.' },
  [ITEM.WIRE]: { name: 'Barbed Wire', cat: 'res', stack: 10, color: 0x8c8c8c, desc: 'Coiled razor wire.' },
  [ITEM.PLATE]: { name: 'Kevlar Plate', cat: 'res', stack: 4, color: 0x3b4a3a, desc: 'Military armor insert.' },
  [ITEM.GUNPARTS]: { name: 'Gun Parts', cat: 'res', stack: 6, color: 0x444444, desc: 'Springs, pins, a bolt.' },

  [ITEM.BANDAGE]: { name: 'Bandage', cat: 'cons', stack: 5, color: 0xe8e0d0, desc: 'Heals 25 HP.' },
  [ITEM.MEDKIT]: { name: 'Medkit', cat: 'cons', stack: 3, color: 0xc0392b, desc: 'Heals 80 HP.' },
  [ITEM.PAINKILLERS]: { name: 'Painkillers', cat: 'cons', stack: 5, color: 0xf0f0f0, desc: 'Heals 15 HP, restores stamina.' },
  [ITEM.BATTERY]: { name: 'Batteries', cat: 'cons', stack: 5, color: 0xd4b106, desc: 'Recharges your flashlight. A beam held on a Shade keeps it frozen.' },
  [ITEM.TORCH]: { name: 'Torch', cat: 'cons', stack: 10, color: 0xe07b20, desc: 'Place with the hammer [5] to light your base. Shades cannot move in its light.' },
  [ITEM.TUNA]: { name: 'Canned Tuna', cat: 'cons', stack: 5, color: 0x3f6f9a, desc: 'A tin of tuna in oil. Heals 30 HP, restores stamina.' },

  [ITEM.MOLOTOV]: { name: 'Molotov', cat: 'throw', stack: 3, color: 0xd35400, desc: 'Sets an area ablaze.' },
  [ITEM.PIPEBOMB]: { name: 'Pipe Bomb', cat: 'throw', stack: 3, color: 0x566573, desc: 'Beeps, lures the horde, then a big boom.' },
  [ITEM.FLARE]: { name: 'Road Flare', cat: 'throw', stack: 4, color: 0xe04a2a, desc: 'Burns bright red for 40s. Lights the area, pinning Shades.' },
  [ITEM.GRENADE]: { name: 'Frag Grenade', cat: 'throw', stack: 3, color: 0x4b5a32, desc: 'Bounces, rolls, and bursts two seconds after the throw. No beeping: the dead never see it coming.' },
  [ITEM.DECOY]: { name: 'Noisemaker', cat: 'throw', stack: 3, color: 0xb8402c, desc: 'A wound-up alarm clock. Rings for 15s where it lands, and the dead for 45 m around go to it. Hurts nothing.' },

  [ITEM.JACKET]: { name: 'Padded Jacket', cat: 'armor', stack: 1, color: 0x5d4e37, armor: 60, absorb: 0.3, desc: 'Absorbs 30% damage.' },
  [ITEM.KEVLAR]: { name: 'Kevlar Vest', cat: 'armor', stack: 1, color: 0x2f3b2f, armor: 120, absorb: 0.5, desc: 'Absorbs 50% damage.' },

  [ITEM.BACKPACK]: { name: 'Backpack', cat: 'pack', stack: 1, color: 0x4a4430, desc: 'Canvas and leather, made at the workbench. Wear it for more room in the backpack grid.' },

  [ITEM.WALKIE]: { name: 'Walkie-Talkie', cat: 'gear', stack: 1, color: 0x3d4a3a, desc: 'Everyone carries one in slot [6]. Take it out and hold fire to talk to every survivor over it, however far apart you are.' },

  [ITEM.KNIFE]: { name: 'Knife', cat: 'weapon', stack: 1, color: 0xaaaaaa, desc: 'Fast. Quiet.' },
  [ITEM.BAT]: { name: 'Baseball Bat', cat: 'weapon', stack: 1, color: 0x9c7a4b, desc: 'Heavy swings, knockback.' },
  [ITEM.SPIKED_BAT]: { name: 'Spiked Bat', cat: 'weapon', stack: 1, color: 0x8a5a3b, desc: 'A bat wrapped in nails and wire.' },
  [ITEM.MACHETE]: { name: 'Machete', cat: 'weapon', stack: 1, color: 0x9aa3a8, desc: 'Cleaves through the horde.' },
  [ITEM.HAMMER]: { name: 'Hammer', cat: 'weapon', stack: 1, color: 0x7a5c3a, desc: 'Build and repair structures.' },
  [ITEM.NUNCHAKU]: { name: 'Nunchucks', cat: 'weapon', stack: 1, color: 0x7a4a2a, desc: 'Two hardwood handles on a chain. Keep swinging for a four-move combo whose last blow lands hardest; hold the heavy attack to spin it up. Short reach, one target, and every move costs stamina.' },
  [ITEM.PISTOL]: { name: 'Pistol', cat: 'weapon', stack: 1, color: 0x333333, desc: 'Reliable 9mm sidearm.' },
  [ITEM.SHOTGUN]: { name: 'Shotgun', cat: 'weapon', stack: 1, color: 0x4a3a2a, desc: 'Devastating up close.' },
  [ITEM.AK47]: { name: 'AK-47', cat: 'weapon', stack: 1, color: 0x5a4632, desc: 'Full-auto 7.62 rifle.' },
  [ITEM.HUNTING_RIFLE]: { name: 'Hunting Rifle', cat: 'weapon', stack: 1, color: 0x6b4f33, desc: 'Bolt-action .308. Pierces.' },
  [ITEM.M4A1]: { name: 'M4A1', cat: 'weapon', stack: 1, color: 0x2e2f2c, desc: 'Full-auto 5.56 carbine. Accurate, soft recoil.' },
  [ITEM.MP5]: { name: 'MP5', cat: 'weapon', stack: 1, color: 0x353535, desc: 'Full-auto 9mm submachine gun. Fast and quiet.' },
  [ITEM.DB_SHOTGUN]: { name: 'Double-Barrel', cat: 'weapon', stack: 1, color: 0x5c4028, desc: 'Two barrels of buckshot back to back. Slow to reload.' },
  [ITEM.CROSSBOW]: { name: 'Crossbow', cat: 'weapon', stack: 1, color: 0x5a4a34, desc: 'One heavy bolt, almost no noise. Slow to cock.' },
  [ITEM.FLAMETHROWER]: { name: 'Flamethrower', cat: 'weapon', stack: 1, color: 0xb5651d, desc: 'A short cone of fire. Whatever it touches keeps burning.' },
  [ITEM.AT_RIFLE]: { name: 'Anti-Tank Rifle', cat: 'weapon', stack: 1, color: 0x4f5232, desc: 'Single-shot 14.5mm. Goes through a whole line of them, and hits bosses and Tanks three times as hard. A very slow reload.' },
  [ITEM.RPG]: { name: 'RPG', cat: 'weapon', stack: 1, color: 0x4b5320, desc: 'Fires one rocket grenade at a time. It bursts on impact and tears apart everything around it. Slow to reload, and very loud.' },
  [ITEM.FLARE_GUN]: { name: 'Flare Gun', cat: 'weapon', stack: 1, color: 0xe0601c, desc: 'Fires a parachute flare high into the sky. It lights the ground for a minute as it drifts back down, and Shades cannot move under it. Takes the pistol\'s place.' },

  [ITEM.AMMO_9MM]: { name: '9mm Ammo', cat: 'ammo', stack: AMMO_MAX[0], color: 0xc9a227, ammo: 0, desc: 'Pistol rounds.' },
  [ITEM.AMMO_SHELLS]: { name: 'Shotgun Shells', cat: 'ammo', stack: AMMO_MAX[1], color: 0xb03a2e, ammo: 1, desc: '12 gauge.' },
  [ITEM.AMMO_762]: { name: '7.62 Ammo', cat: 'ammo', stack: AMMO_MAX[2], color: 0xa6832a, ammo: 2, desc: 'Rifle rounds.' },
  [ITEM.AMMO_308]: { name: '.308 Ammo', cat: 'ammo', stack: AMMO_MAX[3], color: 0xd4ac0d, ammo: 3, desc: 'Hunting rounds.' },
  [ITEM.AMMO_556]: { name: '5.56 Ammo', cat: 'ammo', stack: AMMO_MAX[4], color: 0x6b7a3a, ammo: 4, desc: 'NATO carbine rounds.' },
  [ITEM.AMMO_BOLTS]: { name: 'Crossbow Bolts', cat: 'ammo', stack: AMMO_MAX[5], color: 0x9a8a62, ammo: 5, desc: 'Scrap-tipped bolts. No gunpowder needed.' },
  [ITEM.AMMO_FUEL]: { name: 'Flamethrower Fuel', cat: 'ammo', stack: AMMO_MAX[6], color: 0xc0561a, ammo: 6, desc: 'A canister of thickened fuel.' },
  [ITEM.AMMO_145]: { name: '14.5mm Ammo', cat: 'ammo', stack: AMMO_MAX[8], color: 0x9c7a2e, ammo: 8, desc: 'Anti-tank rounds as long as your hand.' },
  [ITEM.AMMO_ROCKET]: { name: 'RPG Grenade', cat: 'ammo', stack: AMMO_MAX[7], color: 0x5d6b3a, ammo: 7, desc: 'A finned warhead for the RPG. Goes off on impact.' },
  [ITEM.AMMO_FLARE]: { name: 'Flare Shells', cat: 'ammo', stack: AMMO_MAX[9], color: 0xd23a26, ammo: 9, desc: '26.5mm parachute flares for the flare gun.' },

  [ITEM.CAR_BATTERY]: { name: 'Car Battery', cat: 'part', stack: 1, color: 0x1f3a93, desc: 'Car supply. Bring it to your broken-down car on Route 9.' },
  [ITEM.SPARE_TIRE]: { name: 'Spare Tire', cat: 'part', stack: 1, color: 0x1b1b1b, desc: 'Car supply. Bring it to your broken-down car on Route 9.' },
  [ITEM.SPARK_PLUGS]: { name: 'Spark Plugs', cat: 'part', stack: 1, color: 0xd0d3d4, desc: 'Car supply. Bring it to your broken-down car on Route 9.' },
  [ITEM.FUEL_CAN]: { name: 'Jerry Can', cat: 'part', stack: 3, color: 0xb71c1c, desc: 'Fuel for the car. The tank needs three cans.' },
  [ITEM.FAN_BELT]: { name: 'Fan Belt', cat: 'part', stack: 1, color: 0x212121, desc: 'Car supply. Bring it to your broken-down car on Route 9.' },

  [ITEM.PROPELLER]: { name: 'Propeller', cat: 'part', stack: 1, color: 0x8a8f94, desc: 'Plane part: a two-blade propeller off a hangar rack. Bring it to the plane at Calder Field.' },
  [ITEM.MAGNETO]: { name: 'Magneto', cat: 'part', stack: 1, color: 0x30343a, desc: 'Plane part: the engine fires off it. Bring it to the plane at Calder Field.' },
  [ITEM.HYDRAULIC_PUMP]: { name: 'Hydraulic Pump', cat: 'part', stack: 1, color: 0xa33a22, desc: 'Plane part: without it the flaps and the brakes are dead. Bring it to the plane at Calder Field.' },
  [ITEM.FLIGHT_RADIO]: { name: 'Flight Radio', cat: 'part', stack: 1, color: 0x3a4a3c, desc: 'Plane part: the set out of a control tower. Bring it to the plane at Calder Field.' },
  [ITEM.AVGAS]: { name: 'Avgas Drum', cat: 'part', stack: 3, color: 0x2f6fb0, desc: 'Aviation fuel for the plane. The tanks need three drums.' },

  [ITEM.SCHEM_SHOTGUN]: { name: 'Shotgun Schematic', cat: 'schem', stack: 1, color: 0x6c8fb5, desc: 'Unlocks the Shotgun and the Double-Barrel at the workbench for the whole team.' },
  [ITEM.SCHEM_RIFLE]: { name: 'Rifle Schematic', cat: 'schem', stack: 1, color: 0x6c8fb5, desc: 'Unlocks the Hunting Rifle and the Anti-Tank Rifle at the workbench for the whole team.' },
  [ITEM.SCHEM_KEVLAR]: { name: 'Armor Schematic', cat: 'schem', stack: 1, color: 0x6c8fb5, desc: 'Unlocks the Kevlar Vest at the workbench for the whole team.' },
  [ITEM.SCHEM_EXPLOSIVES]: { name: 'Explosives Schematic', cat: 'schem', stack: 1, color: 0x6c8fb5, desc: 'Unlocks Pipe Bombs, Frag Grenades and the Flamethrower at the workbench for the whole team.' },
  [ITEM.SCHEM_METAL]: { name: 'Fortification Schematic', cat: 'schem', stack: 1, color: 0x6c8fb5, desc: 'Unlocks Metal Walls for the whole team.' },
  [ITEM.SCHEM_VEHICLES]: { name: 'Workshop Manual', cat: 'schem', stack: 1, color: 0xb0863a, desc: 'Unlocks building a Moped and a Bicycle at a workbench, for the whole team.' },
  [ITEM.MOPED_KIT]: { name: 'Moped', cat: 'gear', stack: 1, color: 0x9c3a2a, desc: 'Built at a workbench: it stands beside the bench when it is done, with a splash of fuel in it. Two seats.' },
  [ITEM.BIKE_KIT]: { name: 'Bicycle', cat: 'gear', stack: 1, color: 0x4a6a8a, desc: 'Built at a workbench: it stands beside the bench when it is done. Needs no fuel and makes no noise.' },

  [ITEM.VENISON_RAW]: { name: 'Raw Venison', cat: 'cons', stack: 6, color: 0x8e2f2a, desc: 'A cut off a deer. Cook it at a campfire: raw, it heals 8 HP.' },
  [ITEM.VENISON]: { name: 'Cooked Venison', cat: 'cons', stack: 6, color: 0x7a4a2c, desc: 'Venison off the fire. Heals 45 HP, restores stamina.' },
  [ITEM.ENERGY_DRINK]: { name: 'Energy Drink', cat: 'cons', stack: 5, color: 0x6fc23a, desc: 'A can of something fizzy and very sweet. Refills your stamina in one go, even on the run. Quick drink [B].' },
};

// ---------------------------------------------------------------- talking
// The voice reaches TALK_RANGE (constants.js); text chat reaches everyone. Past that range, the walkie-talkie carries
// the voice: the speaker has to have theirs keyed, and the listener has to be a survivor (everybody alive carries
// one; the dead and the turned do not).
export const radioLinked = (speakerOnRadio, listenerHasWalkie) => speakerOnRadio && listenerHasWalkie;

// ---------------------------------------------------------------- the escape
// Your car broke down on Route 9. Install every supply, start the engine and survive the final stand.
export const SUPPLIES = [ITEM.CAR_BATTERY, ITEM.SPARE_TIRE, ITEM.SPARK_PLUGS, ITEM.FAN_BELT, ITEM.FUEL_CAN];
export const SUPPLY_NEED = [1, 1, 1, 1, 3];
export const CAR_PARTS = SUPPLIES; // (legacy name)
// ...and on the mainland (act 2, shared/acts.js) the same loop with a plane: its parts are at set places, the fuel at
// the depot. The list has the car's shape - four single parts, then the fuel by threes - so the global state, the
// rumours and the objective tracker read either the same way.
export const PLANE_PARTS = [ITEM.PROPELLER, ITEM.MAGNETO, ITEM.HYDRAULIC_PUMP, ITEM.FLIGHT_RADIO, ITEM.AVGAS];
export const PLANE_NEED = [1, 1, 1, 1, 3];
// what the escape of an act takes: { items, need }
export const suppliesOf = (act) => (act === 2 ? { items: PLANE_PARTS, need: PLANE_NEED } : { items: SUPPLIES, need: SUPPLY_NEED });

// Where supply i is still worth looking for. hints: the place each hidden one is rumoured to be in (the 4 parts,
// then the 3 jerry cans; 255: none); found: a bit per hint, set once that one has been taken from its hiding place.
// -> { zones: the places left to search, found: how many have been taken }
export function supplyRumours(i, hints, found = 0) {
  const zones = [];
  let n = 0;
  (hints || []).forEach((z, k) => {
    if (Math.min(k, SUPPLIES.length - 1) !== i || z == null || z === 255) return;
    if (found & (1 << k)) n++;
    else zones.push(z);
  });
  return { zones, found: n };
}

// schematics: bit index into the team's unlock mask
export const SCHEMATICS = [ITEM.SCHEM_SHOTGUN, ITEM.SCHEM_RIFLE, ITEM.SCHEM_KEVLAR, ITEM.SCHEM_EXPLOSIVES, ITEM.SCHEM_METAL];
export const SCHEM_BIT = { [ITEM.SCHEM_SHOTGUN]: 0, [ITEM.SCHEM_RIFLE]: 1, [ITEM.SCHEM_KEVLAR]: 2, [ITEM.SCHEM_EXPLOSIVES]: 3, [ITEM.SCHEM_METAL]: 4, [ITEM.SCHEM_VEHICLES]: 5 }; // (the last: a bit of the mask, not one of SCHEMATICS)

// Where the schematics the team still lacks are rumoured to be. hints: the place each SCHEMATICS entry is hidden
// in (255: none); unlocked: the team's mask. -> [{ item, zone }]
export function schematicRumours(hints, unlocked = 0) {
  const out = [];
  SCHEMATICS.forEach((item, k) => {
    const zone = hints?.[k];
    if (zone == null || zone === 255 || unlocked & (1 << SCHEM_BIT[item])) return;
    out.push({ item, zone });
  });
  return out;
}

// ---------------------------------------------------------------- weapons
// slot: 0 primary, 1 pistol, 2 melee, 4 build (hammer)
// Firearms: damage per pellet, rate = seconds between shots, spread (radians) hip / moving penalty, recoil (what a
// burst's bloom and climb come to is playersim.js's shotSpread / shotClimb; node scripts/gun-groups.js prints the groups),
// noise = radius (m) in which the shot draws zombies (default NOISE.GUNSHOT in constants.js): the louder, the more come
// autoReload: reloads by itself once the magazine is empty; quiet: no muzzle blast (no flash, the shot is a bolt)
// rocket: no bullet - each shot is a grenade that flies at `speed` (m/s), falls at `grav` (m/s^2) and bursts on the
// first thing it strikes (or `range` metres out) for `damage` to the dead within `radius` (Combat.launch)
// flame: no bullet - each shot is a puff of fire that scorches everything in a cone (half-angle `flame.cone`, rad)
// out to `range` for `damage` and sets it alight (BURN); the magazine is the fuel tank
// bossMul: damage x this against a boss or a Tank (on top of the head multiplier)
// skyflare: no bullet - the shot is a parachute flare (PROJ.SKYFLARE) that flies up along the aim and lights the
// ground under it while it drifts back down (the flight and its numbers: shared/skyflare.js)
// Melee: altDamage / altRate = the heavy attack (RMB instead of LMB). The blow lands at once like a light one, so
// what it costs is the recovery: it must hit harder and keep up less damage per second than the light attack,
// or one of the two buttons is never worth pressing. (The hammer sits in the build slot and is never swung.)
export const WEAPONS = {
  [ITEM.KNIFE]: { slot: 2, melee: true, damage: 38, rate: 0.42, range: 2.0, altDamage: 80, altRate: 1.0, headMul: 1.6, knock: 0.5, swing: 0.12 },
  [ITEM.BAT]: { slot: 2, melee: true, damage: 60, rate: 0.72, range: 2.4, altDamage: 100, altRate: 1.3, headMul: 1.8, knock: 5, swing: 0.2 },
  [ITEM.SPIKED_BAT]: { slot: 2, melee: true, damage: 95, rate: 0.72, range: 2.4, altDamage: 155, altRate: 1.3, headMul: 1.8, knock: 5, swing: 0.2 },
  [ITEM.MACHETE]: { slot: 2, melee: true, damage: 75, rate: 0.55, range: 2.2, altDamage: 125, altRate: 1.0, headMul: 2.0, knock: 1.5, swing: 0.15 },
  // Nunchucks: a moveset, not one swing (nunchaku: true; the moves, their timing and what each costs are NK_MOVES in
  // shared/nunchaku.js). The numbers here are the opener's and the fully wound heavy's, for whatever reads a weapon's
  // row. Against the others, on one target with the whole chain landed: 198 damage in 1.68 s, 118 a second - over the
  // knife (90) and the bat (83), under the machete (136) and the spiked bat (132), which also strike two at once and
  // cost nothing. The shortest reach there is, one target, and 27 stamina a combo: three and a half combos empty a
  // full bar, and out of breath it is the opener alone at 0.7 of its damage (61 a second). The heavy: 70 on a tap,
  // 165 after a full 0.95 s wind-up (87 a second either way, under the light chain as the rule above asks).
  [ITEM.NUNCHAKU]: { slot: 2, melee: true, nunchaku: true, damage: 28, rate: 0.32, range: 1.9, altDamage: 165, altRate: 0.8, headMul: 1.7, knock: 0.6, swing: 0.1 },
  [ITEM.HAMMER]: { slot: 4, melee: true, damage: 25, rate: 0.6, range: 2.0, altDamage: 25, altRate: 0.6, headMul: 1.5, knock: 1, swing: 0.15, build: true },
  [ITEM.PISTOL]: { slot: 1, damage: 30, rate: 0.16, mag: 12, reload: 1.35, ammo: 0, pellets: 1, spread: 0.012, moveSpread: 0.02, recoil: 0.018, range: 120, headMul: 3.0, auto: false, noise: 45, sound: 'pistol' },
  [ITEM.SHOTGUN]: { slot: 0, damage: 17, rate: 0.85, mag: 6, reload: 0.55, reloadEach: true, ammo: 1, pellets: 9, spread: 0.075, moveSpread: 0.02, recoil: 0.07, range: 45, headMul: 2.0, auto: false, noise: 80, sound: 'shotgun' },
  // the AK-47: the hardest hitting automatic and the least accurate - a wider cone than the M4A1 in every stance and
  // half again its climb, tight for a first aimed round or a short burst (scripts/test-spread.js holds its groups)
  [ITEM.AK47]: { slot: 0, damage: 36, rate: 0.1, mag: 30, reload: 2.3, ammo: 2, pellets: 1, spread: 0.016, moveSpread: 0.034, recoil: 0.022, range: 150, headMul: 2.6, auto: true, sound: 'ak47' },
  [ITEM.HUNTING_RIFLE]: { slot: 0, damage: 180, rate: 1.0, mag: 5, reload: 2.6, ammo: 3, pellets: 1, spread: 0.002, moveSpread: 0.03, recoil: 0.09, range: 220, headMul: 3.0, auto: false, noise: 100, pierce: 3, sound: 'rifle' },
  [ITEM.M4A1]: { slot: 0, damage: 30, rate: 0.085, mag: 30, reload: 2.1, ammo: 4, pellets: 1, spread: 0.013, moveSpread: 0.032, recoil: 0.015, range: 170, headMul: 2.6, auto: true, sound: 'm4a1' },
  [ITEM.MP5]: { slot: 0, damage: 25, rate: 0.075, mag: 30, reload: 1.9, ammo: 0, pellets: 1, spread: 0.017, moveSpread: 0.016, recoil: 0.011, range: 90, headMul: 2.4, auto: true, noise: 35, sound: 'mp5' },
  [ITEM.DB_SHOTGUN]: { slot: 0, damage: 16, rate: 0.22, mag: 2, reload: 1.6, ammo: 1, pellets: 12, spread: 0.1, moveSpread: 0.02, recoil: 0.09, range: 38, headMul: 2.0, auto: false, noise: 90, sound: 'dbshotgun' },
  [ITEM.CROSSBOW]: { slot: 0, damage: 160, rate: 0.4, mag: 1, reload: 2.2, autoReload: true, ammo: 5, pellets: 1, spread: 0.004, moveSpread: 0.02, recoil: 0.03, range: 110, headMul: 2.5, auto: false, noise: 6, quiet: true, sound: 'crossbow' },
  [ITEM.FLAMETHROWER]: { slot: 0, damage: 6, rate: 0.08, mag: 100, reload: 2.8, ammo: 6, pellets: 1, spread: 0.02, moveSpread: 0.01, recoil: 0.003, range: 11, headMul: 1, auto: true, noise: 30, flame: { cone: 0.2 } },
  // the anti-tank rifle: one round, a long reload, made for the big ones. It goes through five, and a boss or a Tank
  // takes bossMul x of it. The loudest gun there is
  [ITEM.AT_RIFLE]: { slot: 0, damage: 400, rate: 1.0, mag: 1, reload: 6.0, autoReload: true, ammo: 8, pellets: 1, spread: 0.015, moveSpread: 0.09, recoil: 0.2, range: 260, headMul: 3.0, auto: false, noise: 150, pierce: 5, bossMul: 3, sound: 'atrifle' },
  [ITEM.RPG]: { slot: 0, damage: 360, rate: 0.5, mag: 1, reload: 3.4, autoReload: true, ammo: 7, pellets: 1, spread: 0.008, moveSpread: 0.03, recoil: 0.12, range: 200, headMul: 1, auto: false, noise: 90, sound: 'rpg', rocket: { speed: 48, grav: 3, radius: 5.5 } },
  // a break-open single shot: it hurts nothing, the flare is the point. The pop carries about as far as a pistol shot
  [ITEM.FLARE_GUN]: { slot: 1, damage: 0, rate: 0.6, mag: 1, reload: 1.7, autoReload: true, ammo: 9, pellets: 1, spread: 0.006, moveSpread: 0.02, recoil: 0.07, range: 0, headMul: 1, auto: false, noise: 50, sound: 'flaregun', skyflare: true },
};

// Burning: a status any zombie can be given (Combat.ignite) - the flamethrower and molotov fires do. It takes `dps`
// for `time` seconds after the fire that lit it; more fire tops the time back up, it does not stack.
export const BURN = { time: 5, dps: 18 };

// Player-zombie claws (not an item)
export const CLAWS = { damage: 22, rate: 0.6, range: 2.0, headMul: 1.0, leapCooldown: 4.5, leapSpeed: 12, leapUp: 5.5 };

// fuse: seconds from the throw to the bang (the flare: how long it burns). radius / damage: the blast, with the falloff
// of Combat.explode (full at the centre, 35% at the edge); it hurts the dead and player-zombies, never a survivor.
// lure: radius (m) in which the dead drop what they are doing and walk to it while it lures (the pipe bomb all
// through its fuse; the noisemaker for lureTime seconds once it has landed). noise: how far the bang carries
// (NOISE.EXPLOSION when not set). bounce: share of its fall speed it keeps off the ground; roll: rolling friction
// (m/s^2) once it stops bouncing. light: the flare's radius (m).
export const THROWABLES = {
  [ITEM.MOLOTOV]: { fuse: 0, radius: 4.5, burnTime: 8, dps: 40, speed: 17 },
  [ITEM.PIPEBOMB]: { fuse: 2.6, radius: 7, damage: 420, speed: 17, lure: 40 },
  [ITEM.FLARE]: { fuse: 40, radius: 0, speed: 16, light: 14 },
  // the frag: thrown further and faster, bursts on a short fuse wherever it has rolled to, gives itself away to nothing
  [ITEM.GRENADE]: { fuse: 2.2, radius: 5, damage: 260, speed: 19, noise: 130, bounce: 0.35, roll: 7 },
  // the noisemaker: hurts nothing, pulls the dead off a place for a quarter of a minute
  [ITEM.DECOY]: { fuse: 0, radius: 0, damage: 0, speed: 15, lure: 45, lureTime: 15 },
};
export const THROW_ITEMS = [ITEM.MOLOTOV, ITEM.PIPEBOMB, ITEM.GRENADE, ITEM.DECOY, ITEM.FLARE];

export const CONSUMABLES = {
  [ITEM.BANDAGE]: { heal: 25, time: 2.2 },
  [ITEM.MEDKIT]: { heal: 80, time: 3.5 },
  [ITEM.PAINKILLERS]: { heal: 15, stamina: 100, time: 1.0 },
  [ITEM.BATTERY]: { flashlight: 100, time: 1.0 },
  [ITEM.TUNA]: { heal: 30, stamina: 100, time: 2.5, food: true }, // food: eaten (own sounds, first-person tin)
  // meat: food that comes in no tin (1: a raw cut, 2: a cooked one, in the hands)
  [ITEM.VENISON_RAW]: { heal: 8, time: 2.5, food: true, meat: 1 },
  [ITEM.VENISON]: { heal: 45, stamina: 100, time: 2.5, food: true, meat: 2 },
  // drink: a can, cracked and downed (own sounds, first-person can tipped to the mouth); quick, to be had mid-chase
  [ITEM.ENERGY_DRINK]: { stamina: 100, time: 0.8, drink: true },
};

// Whether using consumable `item` now would be for nothing, so it is not done (Game.useItem; the client does not even
// ask): anything at all while down (only a teammate gets you up), healing at full health unless it restores stamina
// too, an energy drink at full stamina, a battery for a flashlight that is (all but) full.
// p: { hp, maxHp, battery, downed, stamina, exhausted }
export function useWasted(item, p) {
  const c = CONSUMABLES[item];
  if (p.downed) return true;
  if (c.heal && !c.stamina && p.hp >= p.maxHp) return true;
  if (c.stamina && !c.heal && p.stamina >= STAMINA_MAX - 0.5 && !p.exhausted) return true;
  return !!c.flashlight && p.battery >= FLASHLIGHT_MAX - 1;
}

// ---------------------------------------------------------------- structures
export const STRUCT = {
  BARRICADE: 1,
  WALL: 2,
  METAL_WALL: 3,
  SPIKES: 4,
  BARBED_WIRE: 5,
  TORCH: 6,
  GATE: 7,
  CAMPFIRE: 8,
  WORKBENCH: 9,
  DOOR: 10,
  GENERATOR: 11, // burns Flamethrower Fuel, feeds the floodlights round it, hums (shared/power.js)
  FLOODLIGHT: 12,
};

// sx/sy/sz = size (m). block: blocks zombies (and players unless humanPass). hp.
// light: radius (m) lit while it burns - Shades inside it are frozen.
// station: 'fire' | 'bench' crafting station. snap: 'door' snaps into building doorways. schem: required schematic item.
// metal: rings and sparks when struck, not wood. fuel: the item it burns, poured in with [E] (the item guide lists it).
// Nothing needs a base any more: build a temporary shelter wherever the team is when night falls.
export const STRUCT_DEFS = {
  [STRUCT.BARRICADE]: { name: 'Wood Barricade', sx: 3, sy: 1.15, sz: 0.4, hp: 520, block: true, cost: { [ITEM.WOOD]: 3, [ITEM.NAILS]: 2 }, desc: 'Waist-high. Survivors vault it [Space]; zombies must break it.' },
  [STRUCT.DOOR]: { name: 'Door Boards', sx: 1.5, sy: 2.25, sz: 0.22, hp: 700, block: true, humanPass: true, snap: 'door', cost: { [ITEM.WOOD]: 3, [ITEM.NAILS]: 3 }, desc: 'Snaps into a doorway. Survivors squeeze through; the dead must smash it.' },
  [STRUCT.WALL]: { name: 'Wood Wall', sx: 3, sy: 2.8, sz: 0.35, hp: 900, block: true, cost: { [ITEM.WOOD]: 5, [ITEM.NAILS]: 4 }, desc: 'Tall plank wall.' },
  [STRUCT.GATE]: { name: 'Survivor Gate', sx: 3, sy: 2.6, sz: 0.35, hp: 800, block: true, humanPass: true, cost: { [ITEM.WOOD]: 5, [ITEM.NAILS]: 4, [ITEM.SCRAP]: 1 }, desc: 'Survivors can pass through. Zombies cannot.' },
  [STRUCT.METAL_WALL]: { name: 'Metal Wall', sx: 3, sy: 2.8, sz: 0.3, hp: 2400, block: true, metal: true, schem: ITEM.SCHEM_METAL, cost: { [ITEM.SCRAP]: 5, [ITEM.NAILS]: 4, [ITEM.TAPE]: 1 }, desc: 'Scrap-metal wall. Very tough.' },
  [STRUCT.SPIKES]: { name: 'Spike Trap', sx: 2.2, sy: 0.5, sz: 2.2, hp: 45, block: false, trap: true, dps: 55, slow: 0.45, cost: { [ITEM.WOOD]: 2, [ITEM.NAILS]: 4 }, desc: 'Impales zombies that cross it. Wears out.' },
  [STRUCT.BARBED_WIRE]: { name: 'Barbed Wire', sx: 3, sy: 0.9, sz: 1.0, hp: 400, block: false, trap: true, dps: 12, slow: 0.3, cost: { [ITEM.WIRE]: 2, [ITEM.STICK]: 2 }, desc: 'Slows and shreds the horde.' },
  [STRUCT.TORCH]: { name: 'Standing Torch', sx: 0.3, sy: 1.7, sz: 0.3, hp: 60, block: false, light: 9, burn: 360, cost: { [ITEM.TORCH]: 1 }, desc: 'Lights the area for 6 minutes. Shades freeze in its light.' },
  [STRUCT.CAMPFIRE]: { name: 'Campfire', sx: 1.7, sy: 0.6, sz: 1.7, hp: 250, block: false, light: 13, station: 'fire', burn: 300, cost: { [ITEM.STICK]: 4, [ITEM.WOOD]: 1 }, desc: 'Crafting station (medicine, powder). Heals survivors resting nearby. Feed it wood [E].' },
  [STRUCT.WORKBENCH]: { name: 'Workbench', sx: 2.0, sy: 1.0, sz: 0.9, hp: 450, block: true, station: 'bench', cost: { [ITEM.WOOD]: 5, [ITEM.NAILS]: 6, [ITEM.SCRAP]: 2 }, desc: 'Crafting station: weapons, ammo, armor and explosives.' },
  // the generator and its floodlights: the numbers behind these two lines are in shared/power.js
  [STRUCT.GENERATOR]: { name: 'Generator', sx: 1.3, sy: 0.95, sz: 0.8, hp: 600, block: true, metal: true, fuel: ITEM.AMMO_FUEL, cost: { [ITEM.SCRAP]: 6, [ITEM.GUNPARTS]: 1, [ITEM.TAPE]: 2, [ITEM.WIRE]: 1 }, desc: 'Burns Flamethrower Fuel [E] and powers the floodlights within 16 m. It hums: the dead hear it from 40 m.' },
  [STRUCT.FLOODLIGHT]: { name: 'Floodlight', sx: 0.6, sy: 2.2, sz: 0.5, hp: 160, block: true, metal: true, cost: { [ITEM.SCRAP]: 3, [ITEM.BATTERY]: 1, [ITEM.WIRE]: 1 }, desc: 'Lights a wide cone 24 m long the way it faces, with a running generator within 16 m. Shades freeze in it.' },
};
export const STRUCT_ORDER = [STRUCT.BARRICADE, STRUCT.DOOR, STRUCT.WALL, STRUCT.GATE, STRUCT.METAL_WALL, STRUCT.SPIKES, STRUCT.BARBED_WIRE, STRUCT.TORCH, STRUCT.CAMPFIRE, STRUCT.WORKBENCH, STRUCT.GENERATOR, STRUCT.FLOODLIGHT];
// how near its interaction point the view ray has to pass to offer [E] on a structure (PICK_RADIUS in constants.js)
export const structPickRadius = (stype) => Math.max(0.8, STRUCT_DEFS[stype].sx * 0.5);
export const REPAIR_COST = { [ITEM.WOOD]: 1, [ITEM.NAILS]: 1 }; // per repair action (+35% hp)
export const CAMPFIRE_FUEL = { [ITEM.WOOD]: 70, [ITEM.STICK]: 22 }; // seconds of burn per item fed
export const CAMPFIRE_MAX_FUEL = 600;

// ---------------------------------------------------------------- crafting
// station: undefined = by hand anywhere, 'fire' = near a lit campfire, 'bench' = near a workbench.
// schem: the team must have found this schematic first.
export const STATION_NAMES = { fire: 'Campfire', bench: 'Workbench' };
export const RECIPES = [
  { id: 0, out: ITEM.TORCH, n: 1, cost: { [ITEM.STICK]: 1, [ITEM.CLOTH]: 1 } },
  { id: 1, out: ITEM.BANDAGE, n: 1, cost: { [ITEM.CLOTH]: 2 } },
  { id: 2, out: ITEM.MEDKIT, n: 1, cost: { [ITEM.CLOTH]: 2, [ITEM.HERB]: 2, [ITEM.ALCOHOL]: 1 }, station: 'fire' },
  { id: 3, out: ITEM.BAT, n: 1, cost: { [ITEM.WOOD]: 3 } },
  { id: 4, out: ITEM.SPIKED_BAT, n: 1, cost: { [ITEM.WOOD]: 3, [ITEM.NAILS]: 8, [ITEM.WIRE]: 1 }, station: 'bench' },
  { id: 5, out: ITEM.MACHETE, n: 1, cost: { [ITEM.SCRAP]: 4, [ITEM.LEATHER]: 1, [ITEM.TAPE]: 1 }, station: 'bench' },
  { id: 6, out: ITEM.HAMMER, n: 1, cost: { [ITEM.WOOD]: 1, [ITEM.SCRAP]: 1 } },
  { id: 7, out: ITEM.MOLOTOV, n: 1, cost: { [ITEM.ALCOHOL]: 1, [ITEM.CLOTH]: 1 } },
  { id: 8, out: ITEM.PIPEBOMB, n: 1, cost: { [ITEM.SCRAP]: 2, [ITEM.POWDER]: 4, [ITEM.TAPE]: 1 }, station: 'bench', schem: ITEM.SCHEM_EXPLOSIVES },
  { id: 9, out: ITEM.AMMO_9MM, n: 12, cost: { [ITEM.SCRAP]: 1, [ITEM.POWDER]: 2 }, station: 'bench' },
  { id: 10, out: ITEM.AMMO_SHELLS, n: 6, cost: { [ITEM.SCRAP]: 1, [ITEM.POWDER]: 3 }, station: 'bench' },
  { id: 11, out: ITEM.AMMO_762, n: 20, cost: { [ITEM.SCRAP]: 2, [ITEM.POWDER]: 4 }, station: 'bench' },
  { id: 12, out: ITEM.JACKET, n: 1, cost: { [ITEM.CLOTH]: 6, [ITEM.LEATHER]: 2, [ITEM.TAPE]: 1 }, station: 'bench' },
  { id: 13, out: ITEM.KEVLAR, n: 1, cost: { [ITEM.PLATE]: 2, [ITEM.CLOTH]: 4, [ITEM.TAPE]: 2 }, station: 'bench', schem: ITEM.SCHEM_KEVLAR },
  { id: 14, out: ITEM.HUNTING_RIFLE, n: 1, cost: { [ITEM.GUNPARTS]: 3, [ITEM.WOOD]: 2, [ITEM.TAPE]: 1 }, station: 'bench', schem: ITEM.SCHEM_RIFLE },
  { id: 15, out: ITEM.SHOTGUN, n: 1, cost: { [ITEM.GUNPARTS]: 2, [ITEM.SCRAP]: 3, [ITEM.WOOD]: 2 }, station: 'bench', schem: ITEM.SCHEM_SHOTGUN },
  { id: 16, out: ITEM.AMMO_308, n: 5, cost: { [ITEM.SCRAP]: 1, [ITEM.POWDER]: 3 }, station: 'bench' },
  { id: 17, out: ITEM.ROPE, n: 1, cost: { [ITEM.CLOTH]: 3 } },
  { id: 18, out: ITEM.WOOD, n: 1, cost: { [ITEM.STICK]: 3 } },
  { id: 19, out: ITEM.POWDER, n: 6, cost: { [ITEM.CHEM]: 1, [ITEM.STICK]: 2 }, station: 'fire' },
  { id: 20, out: ITEM.PAINKILLERS, n: 1, cost: { [ITEM.HERB]: 2, [ITEM.ALCOHOL]: 1 }, station: 'fire' },
  { id: 21, out: ITEM.NAILS, n: 10, cost: { [ITEM.SCRAP]: 1 }, station: 'bench' },
  { id: 22, out: ITEM.FLARE, n: 2, cost: { [ITEM.POWDER]: 2, [ITEM.CHEM]: 1, [ITEM.CLOTH]: 1 } },
  { id: 23, out: ITEM.BATTERY, n: 1, cost: { [ITEM.SCRAP]: 1, [ITEM.CHEM]: 1 }, station: 'bench' },
  { id: 24, out: ITEM.AMMO_556, n: 15, cost: { [ITEM.SCRAP]: 2, [ITEM.POWDER]: 3 }, station: 'bench' },
  { id: 25, out: ITEM.DB_SHOTGUN, n: 1, cost: { [ITEM.GUNPARTS]: 1, [ITEM.SCRAP]: 2, [ITEM.WOOD]: 2, [ITEM.TAPE]: 1 }, station: 'bench', schem: ITEM.SCHEM_SHOTGUN },
  { id: 26, out: ITEM.CROSSBOW, n: 1, cost: { [ITEM.ROPE]: 1, [ITEM.STICK]: 4, [ITEM.SCRAP]: 3 }, station: 'bench' },
  { id: 27, out: ITEM.AMMO_BOLTS, n: 4, cost: { [ITEM.STICK]: 2, [ITEM.SCRAP]: 1 }, station: 'bench' },
  { id: 28, out: ITEM.FLAMETHROWER, n: 1, cost: { [ITEM.GUNPARTS]: 2, [ITEM.SCRAP]: 4, [ITEM.TAPE]: 2, [ITEM.CHEM]: 1 }, station: 'bench', schem: ITEM.SCHEM_EXPLOSIVES },
  { id: 29, out: ITEM.AMMO_FUEL, n: 50, cost: { [ITEM.ALCOHOL]: 1, [ITEM.CHEM]: 1 }, station: 'bench' },
  { id: 30, out: ITEM.VENISON, n: 1, cost: { [ITEM.VENISON_RAW]: 1 }, station: 'fire' },
  { id: 31, out: ITEM.GRENADE, n: 1, cost: { [ITEM.SCRAP]: 2, [ITEM.POWDER]: 3 }, station: 'bench', schem: ITEM.SCHEM_EXPLOSIVES },
  { id: 32, out: ITEM.DECOY, n: 1, cost: { [ITEM.SCRAP]: 1, [ITEM.WIRE]: 1, [ITEM.BATTERY]: 1 }, station: 'bench' },
  // a step past the Padded Jacket: the rope is 3 cloth apiece, and the leather is a trip out (barn, cabins, lodge, trunks)
  { id: 33, out: ITEM.BACKPACK, n: 1, cost: { [ITEM.LEATHER]: 4, [ITEM.CLOTH]: 6, [ITEM.ROPE]: 2 }, station: 'bench' },
  { id: 34, out: ITEM.RPG, n: 1, cost: { [ITEM.GUNPARTS]: 3, [ITEM.SCRAP]: 5, [ITEM.TAPE]: 2 }, station: 'bench', schem: ITEM.SCHEM_EXPLOSIVES },
  { id: 35, out: ITEM.AMMO_ROCKET, n: 1, cost: { [ITEM.SCRAP]: 1, [ITEM.POWDER]: 4, [ITEM.CHEM]: 1 }, station: 'bench', schem: ITEM.SCHEM_EXPLOSIVES },
  { id: 36, out: ITEM.AT_RIFLE, n: 1, cost: { [ITEM.GUNPARTS]: 4, [ITEM.SCRAP]: 6, [ITEM.TAPE]: 2 }, station: 'bench', schem: ITEM.SCHEM_RIFLE },
  { id: 37, out: ITEM.AMMO_145, n: 2, cost: { [ITEM.SCRAP]: 2, [ITEM.POWDER]: 5 }, station: 'bench' },
  // the flare gun is a pipe and a hammer; a shell is a road flare's makings with a little chute packed on top
  { id: 38, out: ITEM.FLARE_GUN, n: 1, cost: { [ITEM.GUNPARTS]: 1, [ITEM.SCRAP]: 3, [ITEM.TAPE]: 1 }, station: 'bench' },
  { id: 39, out: ITEM.AMMO_FLARE, n: 1, cost: { [ITEM.POWDER]: 3, [ITEM.CHEM]: 1, [ITEM.CLOTH]: 1 }, station: 'bench' },
  // two turned handles, a chain cut out of scrap, tape for the grips
  { id: 40, out: ITEM.NUNCHAKU, n: 1, cost: { [ITEM.WOOD]: 2, [ITEM.SCRAP]: 2, [ITEM.TAPE]: 1 }, station: 'bench' },
  // vehicles, built (shared/vehicles.js; `vehicle`: the kind that stands beside the bench when it is made - nothing goes
  // into the pack). Mainland only, and not listed anywhere until the team has the manual (`hide`)
  { id: 41, out: ITEM.BIKE_KIT, n: 1, cost: { [ITEM.SCRAP]: 6, [ITEM.WIRE]: 2, [ITEM.TAPE]: 2, [ITEM.LEATHER]: 1 }, station: 'bench', schem: ITEM.SCHEM_VEHICLES, vehicle: 3, hide: true },
  { id: 42, out: ITEM.MOPED_KIT, n: 1, cost: { [ITEM.SCRAP]: 14, [ITEM.GUNPARTS]: 2, [ITEM.WIRE]: 3, [ITEM.TAPE]: 2, [ITEM.BATTERY]: 2 }, station: 'bench', schem: ITEM.SCHEM_VEHICLES, vehicle: 1, hide: true },
];

// The order the backpack grid is sorted in after a pickup or a drop, by category: weapons, what is worn or carried for
// what it does (armor, the backpack, the walkie-talkie), ammunition, medicine and the other consumables, throwables,
// materials, car supplies, schematics (sortInventory, server/inventory.js). Empty slots come after them, and the locked ones last of all.
export const BAG_TIER = { weapon: 0, armor: 1, pack: 1, gear: 1, ammo: 2, cons: 3, throw: 4, res: 5, part: 6, schem: 7 };

// ---------------------------------------------------------------- salvage
// What a thing comes apart into when a survivor tears it down (ACT.SALVAGE): by hand, anywhere, one at a time or
// part of a stack. Something on a recipe gives about half of what the recipe takes, and never all of it back, so
// making a thing and tearing it down again is always a loss: no round trip of the two makes anything. What nobody
// can make gives what it is plainly made of. A gun's magazine goes back into the pack as rounds besides.
// Left off: raw materials, ammunition, food and car supplies - they are what things are made of, or what the run is for.
export const SALVAGE = {
  [ITEM.BANDAGE]: { [ITEM.CLOTH]: 1 },
  [ITEM.MEDKIT]: { [ITEM.CLOTH]: 1, [ITEM.HERB]: 1 },
  [ITEM.PAINKILLERS]: { [ITEM.HERB]: 1 },
  [ITEM.TORCH]: { [ITEM.CLOTH]: 1 },
  [ITEM.MOLOTOV]: { [ITEM.ALCOHOL]: 1 },
  [ITEM.PIPEBOMB]: { [ITEM.SCRAP]: 1, [ITEM.POWDER]: 2 },
  [ITEM.FLARE]: { [ITEM.POWDER]: 1 },
  [ITEM.JACKET]: { [ITEM.CLOTH]: 3, [ITEM.LEATHER]: 1 },
  [ITEM.KEVLAR]: { [ITEM.PLATE]: 1, [ITEM.CLOTH]: 2 },
  [ITEM.WALKIE]: { [ITEM.BATTERY]: 1, [ITEM.SCRAP]: 1 },
  [ITEM.KNIFE]: { [ITEM.SCRAP]: 1, [ITEM.LEATHER]: 1 },
  [ITEM.BAT]: { [ITEM.WOOD]: 1 },
  [ITEM.SPIKED_BAT]: { [ITEM.WOOD]: 1, [ITEM.NAILS]: 4 },
  [ITEM.MACHETE]: { [ITEM.SCRAP]: 2, [ITEM.LEATHER]: 1 },
  [ITEM.HAMMER]: { [ITEM.SCRAP]: 1 },
  [ITEM.NUNCHAKU]: { [ITEM.WOOD]: 1, [ITEM.SCRAP]: 1 },
  [ITEM.PISTOL]: { [ITEM.GUNPARTS]: 1, [ITEM.SCRAP]: 1 },
  [ITEM.SHOTGUN]: { [ITEM.GUNPARTS]: 1, [ITEM.SCRAP]: 1, [ITEM.WOOD]: 1 },
  [ITEM.AK47]: { [ITEM.GUNPARTS]: 2, [ITEM.SCRAP]: 2, [ITEM.WOOD]: 1 },
  [ITEM.HUNTING_RIFLE]: { [ITEM.GUNPARTS]: 1, [ITEM.WOOD]: 1 },
  [ITEM.M4A1]: { [ITEM.GUNPARTS]: 2, [ITEM.SCRAP]: 2 },
  [ITEM.MP5]: { [ITEM.GUNPARTS]: 1, [ITEM.SCRAP]: 2 },
  [ITEM.DB_SHOTGUN]: { [ITEM.GUNPARTS]: 1, [ITEM.SCRAP]: 1 },
  [ITEM.CROSSBOW]: { [ITEM.ROPE]: 1, [ITEM.SCRAP]: 1 },
  [ITEM.FLAMETHROWER]: { [ITEM.GUNPARTS]: 1, [ITEM.SCRAP]: 2, [ITEM.TAPE]: 1 },
  [ITEM.AT_RIFLE]: { [ITEM.GUNPARTS]: 2, [ITEM.SCRAP]: 3 },
  [ITEM.RPG]: { [ITEM.GUNPARTS]: 1, [ITEM.SCRAP]: 2, [ITEM.TAPE]: 1 },
  [ITEM.FLARE_GUN]: { [ITEM.SCRAP]: 2 }, // (made of a gun part, 3 scrap and tape: the part is what is not got back)
  [ITEM.GRENADE]: { [ITEM.SCRAP]: 1, [ITEM.POWDER]: 1 },
  [ITEM.DECOY]: { [ITEM.BATTERY]: 1 },
  [ITEM.BACKPACK]: { [ITEM.LEATHER]: 2, [ITEM.CLOTH]: 3, [ITEM.ROPE]: 1 },
};
// What worn gear (armor, the backpack) taken apart from its equipment row [Shift+LMB] gives back: its SALVAGE row
// - a backpack 2 Leather, 3 Cloth and 1 Rope. -> { item: count }, or null for anything that is not worn or has none.
export function salvageOf(item) {
  const cat = ITEM_DEFS[item]?.cat;
  return ((cat === 'armor' || cat === 'pack') && SALVAGE[item]) || null;
}

// ---------------------------------------------------------------- zombies
export const ZTYPE = {
  WALKER: 0,
  RUNNER: 1,
  TANK: 2,
  SPITTER: 3,
  LEAPER: 4,
  ROPER: 5,
  BOOMER: 6,
  BAT: 7,
  BOSS_ABOMINATION: 8,
  BOSS_HIVEQUEEN: 9,
  DOG: 10,
  SHADE: 11,
  BOSS_BRUTE: 12,
  BOSS_ALPHA: 13,
  BOSS_BLOATER: 14,
};

// speed m/s, hp, dmg per hit, attack rate s, radius, height (for hitboxes), headR, headY
// common: rank-and-file (plain loot table, no killfeed line). Quadrupeds: headFwd = head sphere this far
// ahead of the body, bodyTop = top of the body cylinder (default headY - headR).
// shade: only moves in darkness; while any light is on it, it is frozen and takes litResist x damage
// legs: its legs can be shot (LEG_* in constants.js): a hit trips it, a leg can be blown off, with both gone it crawls
// minNight: the night it joins the horde. One new kind a night (Game.startNight), each said on the dawn card before it
// and on the dusk card under the clock with its introBrief (the intro in a few words); by day the further a place is
// from the car, the more of the specials it holds, whatever the night (ZombieManager.daySpecial). A boss's minNight is
// the first night it can be drawn (BOSS_POOL)
// tip: a boss's one line on how to fight it, shown when it comes (tipBrief: in a few words, for the dusk card).
// bossLoot: the rolls it drops (default 8)
export const ZOMBIE_DEFS = {
  [ZTYPE.WALKER]: { name: 'Walker', hp: 110, speed: 1.9, dmg: 11, rate: 1.1, range: 1.55, radius: 0.38, height: 1.75, headY: 1.58, headR: 0.17, structDmg: 22, loot: 0.28, common: true, minNight: 1, legs: true },
  [ZTYPE.RUNNER]: { name: 'Runner', hp: 75, speed: 5.6, dmg: 8, rate: 0.7, range: 1.5, radius: 0.34, height: 1.72, headY: 1.55, headR: 0.16, structDmg: 12, loot: 0.25, common: true, minNight: 1, legs: true },
  // a boss from night 2 (BOSS_POOL, at TANK_BOSS_HP of this health), rank-and-file in the horde from night 9. One blow
  // breaks a wood barricade
  // moveR / moveH: the body it walks and charges into the world with. Smaller than radius / height (which stay the
  // size bullets, blows and the model go by) so that it fits a doorway (1.0-1.6 m wide, the lintel 2.08 m above the
  // floor): at its full size a survivor indoors is out of its reach for good. The model does not stoop: it clips
  // the door frame on the way through
  [ZTYPE.TANK]: { name: 'Tank', hp: 2200, speed: 2.5, dmg: 38, rate: 1.6, range: 2.4, radius: 0.95, height: 2.8, headY: 2.45, headR: 0.3, moveR: 0.5, moveH: 1.9, structDmg: 520, loot: 1, knock: 11, minNight: 9, intro: 'Tanks join the horde: they charge, and no barricade holds them. Listen for their footsteps.', introBrief: 'Charge through any barricade. Listen for their steps.', tip: 'Listen for its footsteps. It charges, and it smashes straight through barricades.', tipBrief: 'Charges through any barricade. Listen for its steps.' },
  [ZTYPE.SPITTER]: { name: 'Spitter', hp: 95, speed: 2.3, dmg: 8, rate: 1.1, range: 1.5, radius: 0.36, height: 1.85, headY: 1.68, headR: 0.17, structDmg: 15, loot: 0.5, spitRange: 22, spitRate: 3.5, minNight: 3, legs: true, intro: 'Spitters join the horde: acid from 20 m that eats barricades, not walls. Shoot them first.', introBrief: 'Acid from 20 m eats barricades. Shoot them first.' },
  [ZTYPE.LEAPER]: { name: 'Leaper', hp: 90, speed: 4.2, dmg: 9, rate: 0.5, range: 1.5, radius: 0.36, height: 1.3, headY: 1.1, headR: 0.17, structDmg: 12, loot: 0.5, leapRange: 14, minNight: 5, intro: 'Leapers join the horde: they pounce and pin. Mash Space to shove one off, or stay close so someone can shoot it off you.', introBrief: 'Pounce and pin. Mash Space to shove one off.' },
  [ZTYPE.ROPER]: { name: 'Roper', hp: 150, speed: 2.1, dmg: 6, rate: 0.5, range: 1.6, radius: 0.37, height: 1.9, headY: 1.72, headR: 0.17, structDmg: 15, loot: 0.6, ropeRange: 24, minNight: 8, legs: true, intro: 'Ropers join the horde: a rope needs line of sight, so keep to cover and shoot the roper to break it.', introBrief: 'Ropes need line of sight. Keep to cover.' },
  // cannot claw at a structure: held up by one for breachHold s with a survivor within breachRange m, it swells for
  // breachWindup s and bursts against it. That piece takes breachDmg on top of the blast (with it, any wood piece
  // goes; a metal wall loses about 40%) - unless the boomer is shot first, which leaves only the blast
  [ZTYPE.BOOMER]: { name: 'Boomer', hp: 70, speed: 1.7, dmg: 0, rate: 1, range: 2.2, radius: 0.6, height: 1.8, headY: 1.62, headR: 0.2, structDmg: 0, loot: 0.6, blastRadius: 5.5, blastDmg: 45, breachHold: 0.8, breachWindup: 1.2, breachRange: 12, breachDmg: 750, minNight: 4, legs: true, intro: 'Boomers join the horde: they burst against your walls. Shoot them far off.', introBrief: 'Burst against your walls. Shoot them far off.' },
  [ZTYPE.BAT]: { name: 'Bat', hp: 28, speed: 7.5, dmg: 5, rate: 0.9, range: 1.3, radius: 0.3, height: 0.4, headY: 0.2, headR: 0.2, structDmg: 0, loot: 0.08, flying: true, common: true, minNight: 7, intro: 'Bats join the horde: they fly over every wall. Shotguns and melee.', introBrief: 'Fly over every wall. Shotguns and melee.' },
  // night bosses: hp is what one survivor faces (+ BOSS_HP_PER_PLAYER of it per extra survivor, Game.spawnBosses),
  // sized so that the rounds a survivor has left once the horde has had its share can bring one down before sunrise
  [ZTYPE.BOSS_ABOMINATION]: { name: 'The Abomination', hp: 4000, speed: 3.0, dmg: 55, rate: 1.8, range: 3.4, radius: 1.5, height: 4.2, headY: 3.7, headR: 0.5, structDmg: 600, loot: 1, knock: 16, boss: true, minNight: 4, tip: 'It slams the ground and throws boulders. Spread out and keep moving.', tipBrief: 'Slams and throws boulders. Spread out, keep moving.' },
  [ZTYPE.BOSS_HIVEQUEEN]: { name: 'The Hive Queen', hp: 3400, speed: 2.4, dmg: 35, rate: 1.4, range: 3.0, radius: 1.3, height: 3.6, headY: 3.1, headR: 0.45, structDmg: 300, loot: 1, knock: 8, boss: true, spitRange: 30, spitRate: 1.6, minNight: 5, tip: 'Acid barrages, and bats from its back. Keep to cover and shoot the bats off whoever they catch.', tipBrief: 'Acid and bats. Keep to cover, shoot the bats.' },
  // hunts in packs: dens in the thick woods by day, with the horde from night 2. sense = scent range multiplier.
  // hitRun: it bites once and breaks off before it comes in again. Held up by what the survivors built it rams it:
  // ramDmg to the piece (a metal one takes less, and gives ramRecoil back), then it reels, taking stunHurt x damage.
  // ramWindup: s it snarls before the ram (DOG_RAM_WINDUP when unset) (DOG_* in server/zombies.js)
  [ZTYPE.DOG]: { name: 'Zombie Dog', hp: 60, speed: 6.2, dmg: 7, rate: 0.7, range: 1.3, radius: 0.36, height: 0.85, headY: 0.58, headR: 0.14, headFwd: 0.5, bodyTop: 0.66, structDmg: 5, loot: 0.15, leather: 0.3, lungeRange: 6, sense: 1.5, pack: true, common: true, minNight: 2, hitRun: true, ramDmg: 180, ramRecoil: 15, stunHurt: 1.5, intro: 'Zombie dogs join the horde: they bite and run. They cannot jump a barricade, but they ram one down. Shoot them as they come in.', introBrief: 'Ram barricades down. Shoot them as they come in.' },
  [ZTYPE.SHADE]: { name: 'Shade', hp: 240, speed: 6.6, dmg: 34, rate: 0.9, range: 1.7, radius: 0.36, height: 2.0, headY: 1.82, headR: 0.17, structDmg: 30, loot: 0.8, shade: true, litResist: 0.25, minNight: 6, legs: true, intro: 'Shades join the horde: they only move in the dark. Torches, a campfire, flashlights on them.', introBrief: 'Move only in the dark. Keep a light on them.' },
  // night 1's boss: a hulking walker and nothing more, until it is badly hurt - below enrage of its health it roars and
  // comes on at enrageSpeed x its pace. Its body fits a doorway (moveR / moveH, as the Tank's)
  [ZTYPE.BOSS_BRUTE]: { name: 'The Brute', hp: 750, speed: 1.7, dmg: 24, rate: 1.5, range: 2.3, radius: 0.75, height: 2.55, headY: 2.22, headR: 0.25, moveR: 0.5, moveH: 1.9, structDmg: 240, loot: 1, bossLoot: 4, knock: 7, boss: true, minNight: 1, enrage: 0.5, enrageSpeed: 2.1, tip: 'Slow, until it is badly hurt: then it roars and comes at a run. Keep your distance.', tipBrief: 'Runs once badly hurt. Keep your distance.' },
  // a dog the size of a pony that leads a pack: it hunts as the dogs do (fans out, lunges, bites and runs, rams down
  // what was built), and howls up summon dogs into its pack every summonRate s while it has a survivor to hunt
  // (summonMax of its pack alive at once). Its ram windup stays under the 0.38 s the client's crouch takes to become
  // its howl (client/render/models/dog.js poseCrouch)
  [ZTYPE.BOSS_ALPHA]: { name: 'The Alpha', hp: 750, speed: 6.4, dmg: 20, rate: 0.9, range: 2.0, radius: 0.7, height: 1.65, headY: 1.2, headR: 0.26, headFwd: 1.0, bodyTop: 1.35, moveR: 0.5, moveH: 1.6, structDmg: 40, loot: 1, knock: 6, lungeRange: 9, sense: 2, pack: true, boss: true, minNight: 2, summon: 3, summonRate: 16, summonMax: 6, hitRun: true, ramDmg: 450, ramRecoil: 40, ramWindup: 0.35, stunHurt: 1.5, tip: 'It howls up more dogs, bites and runs, and rams down what you built. Shoot it while it reels.', tipBrief: 'Calls dogs, rams walls. Shoot it while it reels.' },
  // a boomer three times over: it claws at what you built like any of the dead (it does not burst against it), heaves
  // bile in a fan at whoever is within spewRange every spewRate s, and when it dies it bursts: blastRadius, blastDmg
  // to survivors, blastStruct to what you built. Bring it down far from the walls
  [ZTYPE.BOSS_BLOATER]: { name: 'The Bloater', hp: 2400, speed: 1.45, dmg: 22, rate: 1.4, range: 2.6, radius: 1.15, height: 2.9, headY: 2.55, headR: 0.32, moveR: 0.5, moveH: 1.9, structDmg: 160, loot: 1, knock: 6, boss: true, minNight: 3, spewRange: 13, spewRate: 7, blastRadius: 10, blastDmg: 70, blastStruct: 900, tip: 'When it dies it bursts and takes everything near it. Bring it down far from your walls.', tipBrief: 'Bursts when it dies. Kill it far from your walls.' },
};

// Overkill: a zombie killed by one heavy blow (a rifle round, a point-blank blast, an explosion) that drives it far
// below zero is blown apart instead of dropping. minHit = damage the blow has to deal, overkill = how far below zero
// it has to take the zombie, as a share of its full health.
export const GIB = { minHit: 100, overkill: 0.25 };

// zombie animation states (sent over the wire, 4 bits)
export const ZANIM = {
  IDLE: 0,
  WALK: 1,
  RUN: 2,
  ATTACK: 3,
  SPECIAL: 4, // spit / rope / leap-windup / slam
  AIRBORNE: 5, // leaping / thrown
  STAGGER: 6,
  DEAD: 7,
  EAT: 8, // idle feeding pose
  FROZEN: 9, // shade pinned by light: holds whatever pose it was caught in
  STUMBLE: 10, // shot in the leg: it trips and catches itself
  RISE: 11, // climbing out of a grave (cemetery.js): its feet are still under the ground
};

// the stray cat's animation states (sent over the wire)
export const CANIM = {
  IDLE: 0,
  WALK: 1,
  RUN: 2,
  SIT: 3,
  HELD: 4, // in a survivor's arms (its HOLDER field says whose)
  PET: 5, // ...and being stroked: it purrs
};

// ---------------------------------------------------------------- projectiles / areas
export const PROJ = {
  ACID: 1,
  ROPE: 2,
  MOLOTOV: 3,
  PIPEBOMB: 4,
  ROCK: 5,
  FLARE: 6, // road flare: lands and burns (light)
  GRENADE: 7, // frag grenade: bounces, rolls, bursts on its fuse
  DECOY: 8, // noisemaker: lands and rings, luring the dead
  ROCKET: 9, // an RPG grenade in flight: bursts on impact
  SKYFLARE: 10, // a flare gun's parachute flare: climbs, opens its chute, drifts down burning (shared/skyflare.js)
};
// the item each thrown projectile is (THROWABLES holds its numbers)
export const PROJ_ITEM = { [PROJ.MOLOTOV]: ITEM.MOLOTOV, [PROJ.PIPEBOMB]: ITEM.PIPEBOMB, [PROJ.FLARE]: ITEM.FLARE, [PROJ.GRENADE]: ITEM.GRENADE, [PROJ.DECOY]: ITEM.DECOY };
export const AREA = {
  ACID: 1,
  FIRE: 2,
};

// ---------------------------------------------------------------- events
export const SOUND = {
  NONE: 0,
  PISTOL: 1,
  SHOTGUN: 2,
  AK47: 3,
  RIFLE: 4,
  MELEE_SWING: 5,
  MELEE_HIT: 6,
  ZOMBIE_GROWL: 7,
  ZOMBIE_ATTACK: 8,
  ZOMBIE_DEATH: 9,
  ZOMBIE_PAIN: 10,
  RUNNER_SCREAM: 11,
  TANK_ROAR: 12,
  SPITTER_SPIT: 13,
  LEAPER_SCREECH: 14,
  ROPER_SHOOT: 15,
  BOOMER_GURGLE: 16,
  EXPLOSION: 17,
  BAT_SCREECH: 18,
  BOSS_ROAR: 19,
  ACID_SIZZLE: 20,
  FIRE_WHOOSH: 21,
  GLASS_BREAK: 22,
  WOOD_HIT: 23,
  WOOD_BREAK: 24,
  METAL_HIT: 25,
  BUILD: 26,
  PICKUP: 27,
  CRAFT: 28,
  RELOAD: 29,
  DRY_FIRE: 30,
  PLAYER_HURT: 31,
  PLAYER_DEATH: 32,
  HEAL: 33,
  CAR_PART: 34,
  HORDE_HORN: 35,
  DAWN: 36,
  PLANE: 37,
  CRATE_LAND: 38,
  CAMPFIRE_ADD: 39,
  FLESH_HIT: 40,
  HEADSHOT: 41,
  ZPLAYER_GROWL: 42,
  THROW: 43,
  FOOTSTEP: 44,
  LEAP: 45,
  CAR_START: 46,
  SLAM: 47,
  SWITCH: 48,
  CHOP: 49,
  SALVAGE: 50,
  SEARCH: 51,
  PING: 52,
  ENGINE_CRANK: 53,
  REVIVE: 54,
  DOWNED: 55,
  FLARE_BURN: 56,
  M4A1: 57,
  MP5: 58,
  DB_SHOTGUN: 59,
  CAT_MEOW: 60,
  DOG_BARK: 61,
  DOG_HOWL: 62,
  DOG_SNARL: 63,
  DOG_YELP: 64,
  CROSSBOW: 65,
  CROSSBOW_COCK: 66,
  EAT: 67,
  SHADE_WHISPER: 68, // a shade stalking in the dark
  SHADE_FREEZE: 69, // light catches it
  SHADE_SHRIEK: 70, // the light is gone
  ZOMBIE_MOAN: 71, // an idle or wandering zombie (client-side vocalisation; a chasing one growls)
  BODY_FALL: 72, // a killed zombie hitting the ground (client-side, timed to the fall)
  BELL_TOLL: 73, // the chapel bell: heard all over the valley, from the chapel
  BELL_ROPE: 74, // the rope taken up and hauled on
  RADIO_TUNE: 75, // the Relay Station's radio keyed up
  RADIO_CALL: 76, // ...and the call for a supply drop going out
  GRAVE_STIR: 111, // the earth of a grave heaving: something under it is on its way up (client-side, from EVT.GRAVE)
  GRAVE_BURST: 112, // ...and breaking through
  MOUNTED_GUN: 91, // a round from the mounted gun (client-side, from its EVT.SHOT)
  GUN_FEED: 92, // rounds going into its belt
  GUN_MAN: 93, // someone takes its grips
  DEER_SNORT: 79, // a deer blows through its nose: the group has seen, heard or smelt something, and bolts
  DEER_BLEAT: 80, // a deer hit, or brought down
  DEER_HOOF: 81, // a hoof coming down at a run (client-side, timed to the bound)
  FAIR_START: 97, // the fair's generator catching
  FAIR_STOP: 98, // ...and winding down
  FAIR_FUEL: 99, // fuel going into its drum
  RIDE_BOARD: 100, // a survivor getting onto a ride
  GEN_START: 85, // the built generator: the cord pulled, it catches
  GEN_STOP: 86, // it coughs and dies (switched off, run dry)
  GEN_FUEL: 87, // fuel going into its tank
  FLOOD_SWITCH: 88, // a floodlight's lamp coming on or going out (client-side, from its replicated state)
  RPG: 113, // an RPG grenade leaving the tube
  AT_RIFLE: 118, // the anti-tank rifle's shot
  AT_RELOAD: 119, // ...and its bolt worked to feed it another round
  TREE_FALL: 120, // a felled tree creaking over and crashing down (client-side, from EVT.FELL)
  DRINK: 121, // a can cracked open and gulped down (an energy drink)
  FLARE_GUN: 122, // a flare gun's shot (client-side, from EVT.SHOT)
  FLARE_POP: 123, // a parachute flare bursting alight at the top of its climb (client-side, from its flight)
  DEER_SCREAM: 124, // an undead deer (the mainland's): a rotten-throated bellow as it lowers its antlers, is hit, or dies
  CAT_PURR: 125, // the stray cat purring while it is stroked (client-side, from its CANIM.PET)
  // vehicles (shared/vehicles.js)
  VEH_START: 130, // an engine turned over and caught (somebody at the wheel of one that runs)
  VEH_STOP: 131, // ...and switched off, or run dry
  VEH_FIX: 132, // a part fitted: a ratchet, a clank
  VEH_FUEL: 133, // fuel glugging into a tank
  VEH_CRASH: 134, // sheet metal into something solid
  VEH_THUMP: 135, // a body struck by one
  VEH_BREAK: 136, // one breaking down: a bang under the bonnet, steam
  VEH_DOOR: 137, // a car door shut (somebody getting in or out)
  SIPHON: 138, // fuel drawn out of a wreck's tank
  VEH_GLASS: 139, // a car's windows going in (the dead getting at who is inside)
  BIKE_BELL: 140, // a bicycle's bell
  VEH_MOUNT: 141, // somebody swinging a leg over a moped or a bicycle
  VEH_SKID: 142, // tyres letting go (client-side, from the vehicle's replicated state)
};

export const EVT = {
  SOUND: 1, // sound u8, x,y,z (i16)
  SHOT: 2, // shooterId u16, weapon u8, yaw u16, pitch i16, seed u16, spread u8, recoil pitch u8 (1/500 rad)
  IMPACT: 3, // kind u8, x,y,z, (blood/dirt/wood/metal/spark/acid)
  HITMARK: 4, // flags u8 (1 headshot, 2 kill) - private to shooter
  DAMAGE: 5, // amount u8, fromX,fromZ i16 - private to victim
  KILLFEED: 6, // killerKind u8, killerId u16, victimId u16, weapon u8, flags
  NOTIFY: 7, // msg u8, arg u16, text?
  EXPLOSION: 8, // x,y,z, radius u8
  MELEE: 9, // attackerId u16 (for third-person swing anims)
  PICKUP: 10, // item u8, count u16 (private)
  ZOMBIE_DIE: 11, // zombie id u16, ragdoll impulse dir u8 (yaw), flags (1 headshot, 2 burnt, 4 exploded, 8 gibbed)
  STRUCT_BREAK: 12, // x,y,z, type u8
  THROW: 13, // throwerId
  PING: 14, // playerId u16, kind u8, x,y,z (i16)
  SUMMARY: 15, // night u8, kills u16, structuresLost u8, downs u8, deaths u8, revives u8
  GATHER: 16, // kind u8 (1 chop, 2 salvage), x,y,z (i16) - private to the gatherer (feedback)
  FLYOVER: 17, // supply plane: x,y,z (i16) of the plane's origin at release, heading u16, eta u16 (ms until release)
  ZOMBIE_LEG: 18, // zombie id u16, legs blown off by this hit u8 (bit 0 left, bit 1 right), impulse dir u8 (yaw)
  PONG: 19, // answer to an IN_PING command packet: u8 ms the server sat on it before this snapshot left - private
  STRIPPED: 20, // u8 n, then n trees / wrecks by their collider's x, y0, z (i16): nothing left to gather from them
  REGROWN: 21, // every stripped tree and wreck gives again (dawn)
  FELL: 22, // a tree chopped to its last: its collider's x, y0, z (i16), the way it falls u8 (yaw). Out of the world until dawn
  // a melee swing that struck the world (not a body): attackerId u16, u8 the BLOW (shared/surfaces.js; +8: the heavy
  // swing), x,y,z (i16), the way the blow went (i8 x 3, unit / 127). Clients work out what it struck - the surface,
  // the mark it leaves, the bits and the sound - from their own copy of the world
  STRIKE: 23,
  // a wreck's record (shared/wrecks.js): u8 flags (WRECKF), u8 n, then n x [its collider's x, y0, z (i16), u8 salvage
  // hits left in it, u8 m, m x (x,y,z i16, yaw u8, pitch i8, u8 bits: HITF)]. Without REPLAY the hits are new ones,
  // added to what is known; with it they are the whole record (to a client that joins)
  WRECK: 24,
  WRECK_ALARM: 25, // a wreck's alarm: its collider's x, y0, z (i16), u8 what (ALARM_SAY), u8 seconds it will ring for
  GRAVE: 35, // grave u8 (index into world.cemetery.graves): its earth heaves, and CEMETERY.STIR later one of the dead climbs out
  // (private) achievements (shared/achievements.js): u8 flags (ACHF), u8 n, n x (u8 stat, varu count to add), u8 m,
  // m x u8 achievement number. A guest's: counts and feats for the browser to keep; an account's (ACHF.ACCOUNT): unlocks
  ACHIEVE: 36,
  // (private) the bestiary (shared/bestiary.js): u8 flags (BESTF), u16 mask of ZTYPEs - the whole record (BESTF.ALL)
  // or the kinds just seen
  BESTIARY: 37,
};

export const IMPACT = { BLOOD: 1, DIRT: 2, WOOD: 3, METAL: 4, ACID: 5, GREEN_BLOOD: 6, SPARK: 7 };

export const NOTIFY = {
  NIGHT_FALLS: 1,
  DAWN: 2,
  HORDE_SOON: 3,
  BOSS: 4, // arg = zombie type
  SUPPLY_DROP: 5,
  CAR_PART: 6, // arg = item
  CAR_READY: 7,
  CAMPFIRE_LOW: 8,
  CAMPFIRE_OUT: 9,
  PLAYER_JOINED: 10, // arg = player id
  PLAYER_LEFT: 11,
  YOU_DIED: 12,
  FINAL_NIGHT: 13,
  VICTORY: 14,
  GAME_OVER: 15,
  NEED_STATION: 16,
  CANT_BUILD_HERE: 17,
  NOT_ENOUGH: 18,
  INVENTORY_FULL: 19, // arg = the item that was walked over and left lying for want of room (0 = no item to name)
  NEW_GAME: 20,
  PLAYER_DIED: 21, // arg = player id
  CAMPFIRE_LIT: 22,
  DOWNED: 23, // arg = player id
  REVIVED: 24, // arg = player id
  SUPPLY_FOUND: 25, // arg = item (someone picked up a car supply)
  SCHEMATIC: 26, // arg = schematic item (unlocked for the team)
  ENGINE_START: 27, // the final stand begins
  ESCAPE_READY: 28, // engine is warm: get to the car
  WAVE: 29, // arg = wave number (1-based)
  NEED_FIRE: 30,
  NEED_BENCH: 31,
  LOCKED: 32, // arg = schematic item needed
  STRUCT_CAP: 33,
  SEARCH_EMPTY: 34,
  SUPPLIES_DONE: 35, // every supply installed: start the engine when ready
  NEED_SUPPLIES: 36,
  DOOR_ONLY: 37, // door boards must go in a doorway
  CAR_ALARM: 38,
  SHADE: 39, // the first shade of the night is out there
  HERD: 40, // the wandering herd is onto you (sent to the survivor it noticed). arg = how many of them
  RETURNED: 41, // arg = player id: dead (or a player-zombie) since the last sunrise, a survivor again at this one
  BELL: 42, // the chapel bell is ringing. arg = seconds until the rope can be pulled again
  BELL_WAIT: 43, // (to whoever pulled the rope too soon) arg = seconds until it can be
  RADIO_CALL: 44, // arg = player id: they called a supply drop on the Relay Station's radio
  RADIO_NO: 45, // (to whoever tried the radio) arg = why not (RADIO_NO in shared/fixtures.js)
  GRAVES: 61, // the cemetery has woken: part of tonight's horde is coming up out of its graves (sent to the survivors near it)
  FAIR_ON: 55, // arg = player id: the fair's generator is running (lights, music, the rides)
  FAIR_OFF: 56, // arg = player id: shut off again
  FAIR_DRY: 57, // it has run out of fuel
  FAIR_FULL: 58, // (to the survivor at the drum) the tank takes no more
  GEN_LOW: 48, // a generator nearby has a minute of fuel left (sent to the survivors round it)
  GEN_OUT: 49, // ...it has run dry: its floodlights are out
  POCKETS: 62, // (to whoever tried) the backpack cannot come off while its extra slots hold anything
  UNDO_GONE: 63, // (to whoever asked for an undo, ACT.UNDO_DROP) arg = why nothing came back (UNDO_NO in protocol.js)
  NEED_HAMMER: 64, // (to whoever tried) a repair needs the hammer in hand
  // the two acts (shared/acts.js)
  CROSSING: 65, // the car is away: the crossing to the mainland has begun (the cutscene). arg = the driver's id
  ARRIVED: 66, // the team is on the mainland. arg = how many the checkpoint at the bridge brought back from the dead
  CACHE: 67, // (to one survivor) what the bridgehead cache gave them. arg = a CACHE_GAVE bitmask
  STAND_STAGE: 68, // the runway stand moves on. arg = 1: the tanks are full, the engines are warming; 2: warm, get in
  RUNWAY_BLOCKED: 69, // (to whoever tried to take off) the dead are on the runway. arg = how many
  // (70 was CHECKPOINT: a wipe on the mainland used to start again from the bridgehead; now it ends the run)
  // vehicles (shared/vehicles.js)
  VEH_FIXED: 71, // a vehicle runs. arg = the player who fitted the last part
  VEH_BROKE: 72, // (to who is in it) it has broken down
  VEH_WRECKED: 73, // (to who is in it) it is burnt out
  SIPHONED: 74, // (to whoever drew it) arg = the Fuel that came out of the wreck's tank; 0: it was dry
  VEH_NEED: 75, // (to whoever tried) arg = VEH_NO: why nothing could be done to it
  VEH_OFF: 76, // (to the rider) arg = VEH_OFF: what took them off it
};

// NOTIFY.VEH_NEED / VEH_OFF: why
export const VEH_NO = { FULL: 1, NO_FUEL: 2, NO_PARTS: 3, FINE: 4, SEATS: 5, BROKEN: 6, WRECK: 7, NO_ROOM: 8, NOT_HERE: 9 };
export const VEH_OFFS = { THROWN: 1, PULLED: 2, KNOCKED: 3 };

// killer kinds for killfeed
export const KILLER = { PLAYER: 1, ZOMBIE: 2, WORLD: 3 };

// ---------------------------------------------------------------- zones & loot
export const ZONE = {
  CAMP: 0, // the breakdown: your car on Route 9 (start)
  BARN: 1,
  DOCK: 2,
  GAS: 3,
  RANGER: 4,
  CABINS: 5,
  MILITARY: 6,
  CHURCH: 7,
  FOREST: 8,
  MOTEL: 9,
  SAWMILL: 10,
  TRAILERS: 11,
  VILLAGE: 12,
  CAMPGROUND: 13,
  CHECKPOINT: 14,
  QUARRY: 15,
  RELAY: 16,
  ROADSIDE: 17, // loot flavour for roadside wrecks / sites (not a place)
  SCRAPYARD: 18,
  SUMMERCAMP: 19,
  MINE: 20,
  LODGE: 21,
  DRIVEIN: 22,
  STATION: 23, // the depot on the railway
  CEMETERY: 24, // the graveyard behind St. Agnes
  CLINIC: 25,
  FAIR: 26,
  // the mainland (shared/mainland.js)
  BRIDGEHEAD: 27, // where the bridge comes ashore: act 2 starts here
  CITY: 28, // Port Calder, downtown
  INDUSTRIAL: 29, // Kessler Ironworks
  TERMINAL: 30, // Calder Field: the terminal and its tower
  HANGARS: 31, // ...its hangars, and the plane
  FUEL_DEPOT: 32, // ...its fuel depot
  SUBURB: 33, // Eastgate: the houses on the city's far side
  TRUCKSTOP: 34, // a truck stop on the road out to the airfield
  // ...and what lies about it, out over the plain (shared/mainland-places.js)
  QUARANTINE: 35, // a tent city behind wire, where the mainland's evacuees were held
  ROADBLOCK: 36, // the army's last line on Route 9, between the bridge and the city
  SUBSTATION: 37,
  WATERWORKS: 38, // a pump house under a water tower
  MARINA: 39, // on the lake
  TRAILERPARK: 40,
  SALVAGE: 41, // a breaker's yard
  MALL: 42, // a big-box store and its car park
  SCHOOL: 43,
  MAST: 44, // a radio station under its mast, on high ground
  MOTORINN: 45, // a motel on the highway
  GRAVEYARD: 46,
  LOGGING: 47,
  CRASH: 48, // an airliner that came down short of the runway
  WESTGATE: 49, // houses on the city's seaward side
  CONTAINERS: 50, // a freight yard of shipping containers
  FARM_A: 51,
  FARM_B: 52,
  // ...and more of it (the third pass)
  BOATWORKS: 53, // on the river's far bank, across from the city
  DRIVEIN_M: 54,
  FIREHOUSE: 55,
  GRAIN: 56, // a grain elevator
  DINER_M: 57,
  CARLOT: 58,
  STORAGE: 59, // rows of lock-ups
  EVAC: 60, // where the buses were to take the city's people from
  NURSERY: 61,
  MOTORPOOL: 62, // the Guard's trucks
  HELIPAD: 63,
  AGGREGATES: 64, // a gravel works
};
export const MAINLAND_ZONES = [27, 64]; // the first and the last of the mainland's places
// NOTIFY.CACHE: what the bridgehead cache handed a survivor (acts.js BRIDGEHEAD)
export const CACHE_GAVE = { PISTOL: 1, AMMO: 2, BANDAGE: 4, MELEE: 8, BUILD: 16 };

export const ZONE_NAMES = [
  'The Breakdown',
  'Miller Farm',
  'Blackwater Dock',
  'Route 9 Gas Station',
  'Ranger Lookout',
  'Hunting Cabins',
  'Crash Site',
  'St. Agnes Chapel',
  'The Woods',
  'Pinewood Motel',
  'Harlan Sawmill',
  'Shady Pines Trailers',
  'Hollow Creek',
  'Lakeside Campground',
  'Army Checkpoint',
  'Granite Quarry',
  'Relay Station',
  'Roadside',
  "Dutch's Salvage",
  'Camp Tamarack',
  'Blackrock Mine',
  'Elk Ridge Lodge',
  'Starlite Drive-In',
  'Whitlock Depot',
  'St. Agnes Cemetery',
  'Mercy Clinic',
  'Tri-County Fair',
  'The Bridgehead',
  'Port Calder',
  'Kessler Ironworks',
  'Calder Field Terminal',
  'Calder Field Hangars',
  'Calder Fuel Depot',
  'Eastgate',
  'Mile 9 Truck Stop',
  'Camp Hollis Quarantine',
  'Route 9 Checkpoint',
  'Calder Substation',
  'Calder Waterworks',
  'Lake Morrow Marina',
  'Sunset Acres',
  "Benny's Auto Salvage",
  'Gateway Plaza',
  'Calder Elementary',
  'WKCL Radio Mast',
  'Starlight Motor Inn',
  'Hillside Cemetery',
  'Dunmore Logging Camp',
  'Flight 212',
  'Westgate',
  'Calder Freight Yard',
  'Hale Farm',
  'Pruitt Farm',
  'Calder Boat Works',
  'Calder Drive-In',
  'Engine Company 9',
  'Halvorsen Grain',
  'Mile 4 Diner',
  "Honest Al's Autos",
  'U-Store Calder',
  'Evacuation Point Bravo',
  'Greenacre Nursery',
  'Guard Motor Pool',
  'Landing Zone Kilo',
  'Calder Aggregates',
];

// weighted loot tables per zone: [item, weight, min, max]
export const LOOT_TABLES = {
  [ZONE.CAMP]: [[ITEM.CLOTH, 6, 2, 3], [ITEM.STICK, 4, 2, 4], [ITEM.WOOD, 3, 1, 3]],
  [ZONE.FOREST]: [[ITEM.STICK, 8, 2, 5], [ITEM.WOOD, 4, 1, 3], [ITEM.CLOTH, 7, 1, 3], [ITEM.HERB, 3, 1, 2], [ITEM.SCRAP, 1, 1, 2], [ITEM.AMMO_9MM, 1, 6, 12]],
  [ZONE.BARN]: [[ITEM.WOOD, 8, 2, 5], [ITEM.NAILS, 8, 4, 10], [ITEM.ROPE, 4, 1, 2], [ITEM.CLOTH, 5, 1, 3], [ITEM.WIRE, 4, 1, 2], [ITEM.LEATHER, 3, 1, 2], [ITEM.AMMO_SHELLS, 3, 4, 8], [ITEM.BAT, 1, 1, 1], [ITEM.ALCOHOL, 2, 1, 1], [ITEM.HAMMER, 1, 1, 1], [ITEM.DB_SHOTGUN, 1, 1, 1]],
  [ZONE.DOCK]: [[ITEM.ROPE, 6, 1, 3], [ITEM.SCRAP, 5, 1, 3], [ITEM.CLOTH, 4, 1, 3], [ITEM.TAPE, 4, 1, 2], [ITEM.ALCOHOL, 4, 1, 2], [ITEM.BATTERY, 3, 1, 1], [ITEM.AMMO_SHELLS, 3, 4, 8], [ITEM.CHEM, 2, 1, 2], [ITEM.NAILS, 3, 3, 8], [ITEM.TUNA, 4, 1, 2], [ITEM.AMMO_FLARE, 3, 1, 3], [ITEM.FLARE_GUN, 1, 1, 1]],
  [ZONE.GAS]: [[ITEM.SCRAP, 7, 2, 4], [ITEM.TAPE, 5, 1, 2], [ITEM.CHEM, 5, 1, 2], [ITEM.ALCOHOL, 4, 1, 2], [ITEM.BATTERY, 4, 1, 2], [ITEM.PAINKILLERS, 3, 1, 2], [ITEM.AMMO_9MM, 4, 8, 16], [ITEM.NAILS, 3, 4, 10], [ITEM.PISTOL, 1, 1, 1], [ITEM.TUNA, 3, 1, 2], [ITEM.AMMO_FUEL, 3, 20, 40], [ITEM.ENERGY_DRINK, 4, 1, 2]],
  [ZONE.RANGER]: [[ITEM.GUNPARTS, 4, 1, 1], [ITEM.AMMO_308, 5, 3, 6], [ITEM.AMMO_9MM, 4, 8, 16], [ITEM.BATTERY, 4, 1, 2], [ITEM.BANDAGE, 4, 1, 2], [ITEM.ROPE, 3, 1, 2], [ITEM.POWDER, 3, 2, 5], [ITEM.MEDKIT, 1, 1, 1], [ITEM.HUNTING_RIFLE, 1, 1, 1], [ITEM.AMMO_BOLTS, 3, 2, 5], [ITEM.AMMO_FLARE, 2, 1, 2], [ITEM.FLARE_GUN, 1, 1, 1]],
  [ZONE.CABINS]: [[ITEM.LEATHER, 6, 1, 3], [ITEM.CLOTH, 6, 2, 4], [ITEM.ALCOHOL, 4, 1, 2], [ITEM.HERB, 4, 1, 3], [ITEM.AMMO_SHELLS, 5, 4, 8], [ITEM.POWDER, 4, 2, 6], [ITEM.GUNPARTS, 2, 1, 1], [ITEM.MACHETE, 1, 1, 1], [ITEM.SHOTGUN, 1, 1, 1], [ITEM.DB_SHOTGUN, 1, 1, 1], [ITEM.AMMO_BOLTS, 3, 2, 5], [ITEM.CROSSBOW, 1, 1, 1], [ITEM.TUNA, 3, 1, 2]],
  [ZONE.MILITARY]: [[ITEM.AMMO_762, 7, 15, 30], [ITEM.PLATE, 4, 1, 1], [ITEM.GUNPARTS, 4, 1, 2], [ITEM.POWDER, 5, 3, 8], [ITEM.WIRE, 4, 1, 3], [ITEM.MEDKIT, 3, 1, 1], [ITEM.PIPEBOMB, 2, 1, 1], [ITEM.GRENADE, 1, 1, 2], [ITEM.SCRAP, 3, 2, 4], [ITEM.AMMO_556, 5, 20, 40], [ITEM.AK47, 1, 1, 1], [ITEM.M4A1, 1, 1, 1], [ITEM.KEVLAR, 1, 1, 1], [ITEM.AMMO_FUEL, 3, 30, 60], [ITEM.FLAMETHROWER, 1, 1, 1], [ITEM.AMMO_ROCKET, 2, 1, 2], [ITEM.RPG, 1, 1, 1], [ITEM.AMMO_145, 2, 2, 4], [ITEM.AT_RIFLE, 1, 1, 1]],
  [ZONE.CHURCH]: [[ITEM.CLOTH, 6, 2, 4], [ITEM.HERB, 5, 1, 3], [ITEM.ALCOHOL, 5, 1, 2], [ITEM.BANDAGE, 4, 1, 2], [ITEM.MEDKIT, 2, 1, 1], [ITEM.PAINKILLERS, 4, 1, 2], [ITEM.TORCH, 3, 1, 2], [ITEM.AMMO_9MM, 2, 6, 12]],
  [ZONE.CEMETERY]: [[ITEM.CLOTH, 6, 1, 3], [ITEM.TORCH, 4, 1, 2], [ITEM.HERB, 4, 1, 2], [ITEM.ALCOHOL, 3, 1, 1], [ITEM.ROPE, 2, 1, 1], [ITEM.AMMO_SHELLS, 2, 2, 5]],
  [ZONE.MOTEL]: [[ITEM.CLOTH, 7, 2, 4], [ITEM.ALCOHOL, 5, 1, 2], [ITEM.PAINKILLERS, 4, 1, 2], [ITEM.BANDAGE, 4, 1, 2], [ITEM.BATTERY, 4, 1, 2], [ITEM.AMMO_9MM, 4, 8, 16], [ITEM.TAPE, 3, 1, 1], [ITEM.CHEM, 3, 1, 1], [ITEM.PISTOL, 1, 1, 1], [ITEM.FLARE, 2, 1, 2], [ITEM.TUNA, 3, 1, 1], [ITEM.ENERGY_DRINK, 3, 1, 2], [ITEM.DECOY, 1, 1, 1]],
  [ZONE.SAWMILL]: [[ITEM.WOOD, 10, 3, 6], [ITEM.NAILS, 8, 6, 12], [ITEM.STICK, 5, 3, 6], [ITEM.ROPE, 3, 1, 2], [ITEM.SCRAP, 4, 1, 3], [ITEM.TAPE, 2, 1, 1], [ITEM.WIRE, 3, 1, 2], [ITEM.HAMMER, 1, 1, 1], [ITEM.MACHETE, 1, 1, 1]],
  [ZONE.TRAILERS]: [[ITEM.CLOTH, 6, 1, 3], [ITEM.ALCOHOL, 5, 1, 2], [ITEM.CHEM, 4, 1, 2], [ITEM.AMMO_SHELLS, 4, 4, 8], [ITEM.AMMO_9MM, 4, 6, 12], [ITEM.TAPE, 3, 1, 1], [ITEM.SCRAP, 4, 1, 2], [ITEM.PAINKILLERS, 3, 1, 1], [ITEM.BAT, 1, 1, 1], [ITEM.MOLOTOV, 1, 1, 1], [ITEM.DB_SHOTGUN, 1, 1, 1], [ITEM.TUNA, 4, 1, 2], [ITEM.ENERGY_DRINK, 3, 1, 1], [ITEM.DECOY, 1, 1, 1]],
  [ZONE.VILLAGE]: [[ITEM.CLOTH, 6, 2, 4], [ITEM.BANDAGE, 4, 1, 2], [ITEM.MEDKIT, 2, 1, 1], [ITEM.ALCOHOL, 4, 1, 2], [ITEM.BATTERY, 4, 1, 2], [ITEM.AMMO_9MM, 5, 8, 16], [ITEM.AMMO_SHELLS, 3, 4, 8], [ITEM.TAPE, 3, 1, 2], [ITEM.NAILS, 4, 4, 10], [ITEM.CHEM, 3, 1, 2], [ITEM.HERB, 2, 1, 2], [ITEM.FLARE, 2, 1, 2], [ITEM.PISTOL, 1, 1, 1], [ITEM.SHOTGUN, 1, 1, 1], [ITEM.MP5, 1, 1, 1], [ITEM.TUNA, 3, 1, 2], [ITEM.ENERGY_DRINK, 3, 1, 2], [ITEM.DECOY, 1, 1, 1]],
  [ZONE.CLINIC]: [[ITEM.BANDAGE, 7, 1, 3], [ITEM.PAINKILLERS, 6, 1, 2], [ITEM.MEDKIT, 4, 1, 1], [ITEM.ALCOHOL, 5, 1, 2], [ITEM.CHEM, 4, 1, 2], [ITEM.CLOTH, 5, 2, 4], [ITEM.HERB, 2, 1, 2], [ITEM.BATTERY, 3, 1, 2], [ITEM.TAPE, 2, 1, 1]],
  [ZONE.CAMPGROUND]: [[ITEM.CLOTH, 6, 2, 4], [ITEM.ROPE, 5, 1, 2], [ITEM.ALCOHOL, 4, 1, 2], [ITEM.HERB, 4, 1, 3], [ITEM.STICK, 4, 2, 5], [ITEM.BATTERY, 3, 1, 1], [ITEM.FLARE, 3, 1, 2], [ITEM.BANDAGE, 3, 1, 2], [ITEM.AMMO_SHELLS, 2, 4, 6], [ITEM.KNIFE, 1, 1, 1], [ITEM.AMMO_BOLTS, 2, 2, 4], [ITEM.TUNA, 4, 1, 2], [ITEM.ENERGY_DRINK, 2, 1, 1]],
  [ZONE.CHECKPOINT]: [[ITEM.AMMO_762, 6, 15, 30], [ITEM.AMMO_9MM, 5, 10, 20], [ITEM.WIRE, 5, 1, 3], [ITEM.POWDER, 4, 2, 6], [ITEM.MEDKIT, 2, 1, 1], [ITEM.PLATE, 2, 1, 1], [ITEM.GUNPARTS, 3, 1, 1], [ITEM.FLARE, 3, 1, 2], [ITEM.PIPEBOMB, 1, 1, 1], [ITEM.GRENADE, 1, 1, 1], [ITEM.JACKET, 1, 1, 1], [ITEM.AMMO_556, 5, 15, 30], [ITEM.M4A1, 1, 1, 1], [ITEM.MP5, 1, 1, 1], [ITEM.AMMO_FUEL, 2, 20, 40], [ITEM.AMMO_145, 1, 2, 3], [ITEM.ENERGY_DRINK, 2, 1, 2], [ITEM.AMMO_FLARE, 2, 1, 2], [ITEM.FLARE_GUN, 1, 1, 1]],
  [ZONE.STATION]: [[ITEM.SCRAP, 7, 2, 4], [ITEM.NAILS, 5, 4, 10], [ITEM.WOOD, 5, 2, 4], [ITEM.ROPE, 4, 1, 2], [ITEM.TAPE, 3, 1, 2], [ITEM.BATTERY, 3, 1, 2], [ITEM.CHEM, 3, 1, 2], [ITEM.AMMO_9MM, 3, 8, 16], [ITEM.FLARE, 3, 1, 2], [ITEM.TUNA, 2, 1, 2], [ITEM.HAMMER, 1, 1, 1], [ITEM.ENERGY_DRINK, 2, 1, 1]],
  [ZONE.QUARRY]: [[ITEM.SCRAP, 8, 2, 4], [ITEM.POWDER, 6, 3, 8], [ITEM.CHEM, 4, 1, 2], [ITEM.WIRE, 4, 1, 2], [ITEM.TAPE, 3, 1, 2], [ITEM.NAILS, 4, 4, 10], [ITEM.BATTERY, 3, 1, 2], [ITEM.HAMMER, 1, 1, 1], [ITEM.AMMO_FUEL, 2, 20, 40]],
  [ZONE.RELAY]: [[ITEM.BATTERY, 6, 1, 2], [ITEM.WIRE, 5, 1, 3], [ITEM.SCRAP, 5, 1, 3], [ITEM.TAPE, 4, 1, 2], [ITEM.GUNPARTS, 3, 1, 1], [ITEM.AMMO_308, 3, 3, 6], [ITEM.AMMO_556, 2, 10, 20], [ITEM.CHEM, 3, 1, 2], [ITEM.FLARE, 2, 1, 2], [ITEM.AMMO_FLARE, 2, 1, 2]],
  [ZONE.ROADSIDE]: [[ITEM.SCRAP, 6, 1, 2], [ITEM.CLOTH, 8, 2, 3], [ITEM.TAPE, 3, 1, 1], [ITEM.ALCOHOL, 3, 1, 1], [ITEM.BATTERY, 3, 1, 1], [ITEM.AMMO_9MM, 4, 6, 12], [ITEM.AMMO_SHELLS, 2, 3, 6], [ITEM.BANDAGE, 3, 1, 1], [ITEM.PAINKILLERS, 2, 1, 1], [ITEM.NAILS, 3, 3, 8], [ITEM.FLARE, 2, 1, 1], [ITEM.CHEM, 2, 1, 1], [ITEM.TUNA, 2, 1, 1], [ITEM.ENERGY_DRINK, 2, 1, 1]],
  [ZONE.FAIR]: [[ITEM.CLOTH, 6, 2, 4], [ITEM.ALCOHOL, 5, 1, 2], [ITEM.TUNA, 4, 1, 2], [ITEM.BATTERY, 4, 1, 2], [ITEM.TAPE, 3, 1, 2], [ITEM.SCRAP, 4, 1, 3], [ITEM.ROPE, 3, 1, 2], [ITEM.FLARE, 3, 1, 2], [ITEM.AMMO_FUEL, 3, 20, 40], [ITEM.PAINKILLERS, 2, 1, 1], [ITEM.BAT, 1, 1, 1], [ITEM.ENERGY_DRINK, 4, 1, 2]],
  [ZONE.SCRAPYARD]: [[ITEM.SCRAP, 10, 2, 5], [ITEM.WIRE, 5, 1, 3], [ITEM.TAPE, 4, 1, 2], [ITEM.BATTERY, 4, 1, 2], [ITEM.NAILS, 4, 4, 10], [ITEM.CHEM, 3, 1, 2], [ITEM.PLATE, 1, 1, 1], [ITEM.GUNPARTS, 1, 1, 1], [ITEM.ALCOHOL, 2, 1, 1], [ITEM.HAMMER, 1, 1, 1], [ITEM.BAT, 1, 1, 1]],
  [ZONE.SUMMERCAMP]: [[ITEM.CLOTH, 7, 2, 4], [ITEM.BANDAGE, 5, 1, 2], [ITEM.ROPE, 4, 1, 2], [ITEM.HERB, 4, 1, 3], [ITEM.STICK, 3, 2, 5], [ITEM.FLARE, 3, 1, 2], [ITEM.BATTERY, 3, 1, 2], [ITEM.PAINKILLERS, 3, 1, 2], [ITEM.AMMO_BOLTS, 4, 2, 5], [ITEM.TUNA, 5, 1, 2], [ITEM.KNIFE, 1, 1, 1], [ITEM.CROSSBOW, 1, 1, 1], [ITEM.MEDKIT, 1, 1, 1], [ITEM.NUNCHAKU, 1, 1, 1]],
  [ZONE.MINE]: [[ITEM.POWDER, 8, 3, 8], [ITEM.SCRAP, 6, 2, 4], [ITEM.WIRE, 5, 1, 3], [ITEM.NAILS, 4, 4, 10], [ITEM.BATTERY, 4, 1, 2], [ITEM.ROPE, 3, 1, 2], [ITEM.TAPE, 3, 1, 2], [ITEM.CHEM, 3, 1, 2], [ITEM.FLARE, 3, 1, 2], [ITEM.TORCH, 2, 1, 2], [ITEM.PIPEBOMB, 1, 1, 1], [ITEM.HAMMER, 1, 1, 1]],
  [ZONE.LODGE]: [[ITEM.LEATHER, 6, 1, 3], [ITEM.AMMO_308, 5, 3, 6], [ITEM.AMMO_SHELLS, 5, 4, 8], [ITEM.AMMO_BOLTS, 3, 2, 5], [ITEM.ALCOHOL, 4, 1, 2], [ITEM.TUNA, 4, 1, 2], [ITEM.GUNPARTS, 3, 1, 1], [ITEM.ROPE, 3, 1, 2], [ITEM.HERB, 3, 1, 2], [ITEM.POWDER, 3, 2, 5], [ITEM.JACKET, 1, 1, 1], [ITEM.MACHETE, 1, 1, 1], [ITEM.HUNTING_RIFLE, 1, 1, 1], [ITEM.CROSSBOW, 1, 1, 1]],
  [ZONE.DRIVEIN]: [[ITEM.CLOTH, 6, 2, 4], [ITEM.ALCOHOL, 5, 1, 2], [ITEM.TUNA, 4, 1, 2], [ITEM.BATTERY, 4, 1, 2], [ITEM.TAPE, 4, 1, 2], [ITEM.SCRAP, 4, 1, 3], [ITEM.PAINKILLERS, 3, 1, 2], [ITEM.AMMO_9MM, 4, 8, 16], [ITEM.CHEM, 3, 1, 2], [ITEM.FLARE, 2, 1, 2], [ITEM.BAT, 1, 1, 1], [ITEM.PISTOL, 1, 1, 1], [ITEM.ENERGY_DRINK, 4, 1, 2]],
  // The mainland (act 2). The island is looted by about night 3: this is where the run restocks, so its tables are
  // heavier on ammunition, medicine and gun parts than the island's places. First-pass numbers, not played.
  [ZONE.BRIDGEHEAD]: [[ITEM.CLOTH, 6, 2, 3], [ITEM.STICK, 3, 2, 4], [ITEM.WOOD, 4, 2, 4], [ITEM.NAILS, 3, 4, 8], [ITEM.AMMO_9MM, 3, 8, 14], [ITEM.BANDAGE, 2, 1, 1]],
  [ZONE.CITY]: [[ITEM.AMMO_9MM, 6, 10, 20], [ITEM.AMMO_SHELLS, 4, 4, 8], [ITEM.AMMO_556, 3, 15, 30], [ITEM.AMMO_762, 3, 15, 30], [ITEM.BANDAGE, 5, 1, 2], [ITEM.MEDKIT, 2, 1, 1], [ITEM.PAINKILLERS, 4, 1, 2], [ITEM.TUNA, 5, 1, 2], [ITEM.ENERGY_DRINK, 4, 1, 2], [ITEM.BATTERY, 4, 1, 2], [ITEM.TAPE, 4, 1, 2], [ITEM.CLOTH, 5, 2, 4], [ITEM.ALCOHOL, 4, 1, 2], [ITEM.CHEM, 3, 1, 2], [ITEM.NAILS, 4, 4, 10], [ITEM.GUNPARTS, 3, 1, 2], [ITEM.POWDER, 4, 3, 6], [ITEM.FLARE, 2, 1, 2], [ITEM.DECOY, 1, 1, 1], [ITEM.PISTOL, 1, 1, 1], [ITEM.MP5, 1, 1, 1], [ITEM.SHOTGUN, 1, 1, 1]],
  [ZONE.SUBURB]: [[ITEM.CLOTH, 6, 2, 4], [ITEM.TUNA, 5, 1, 2], [ITEM.BANDAGE, 4, 1, 2], [ITEM.PAINKILLERS, 4, 1, 2], [ITEM.ALCOHOL, 4, 1, 2], [ITEM.BATTERY, 4, 1, 2], [ITEM.AMMO_9MM, 4, 8, 16], [ITEM.AMMO_SHELLS, 4, 4, 8], [ITEM.AMMO_308, 2, 3, 6], [ITEM.NAILS, 4, 4, 10], [ITEM.WOOD, 3, 2, 4], [ITEM.TAPE, 3, 1, 2], [ITEM.HERB, 3, 1, 2], [ITEM.POWDER, 3, 2, 4], [ITEM.BAT, 1, 1, 1], [ITEM.DB_SHOTGUN, 1, 1, 1], [ITEM.HUNTING_RIFLE, 1, 1, 1]],
  [ZONE.INDUSTRIAL]: [[ITEM.SCRAP, 9, 2, 5], [ITEM.NAILS, 6, 6, 14], [ITEM.WIRE, 5, 1, 3], [ITEM.TAPE, 5, 1, 2], [ITEM.CHEM, 4, 1, 2], [ITEM.POWDER, 5, 3, 8], [ITEM.GUNPARTS, 4, 1, 2], [ITEM.PLATE, 2, 1, 1], [ITEM.BATTERY, 3, 1, 2], [ITEM.ROPE, 3, 1, 2], [ITEM.AMMO_FUEL, 3, 30, 60], [ITEM.AMMO_SHELLS, 3, 4, 8], [ITEM.HAMMER, 1, 1, 1], [ITEM.MACHETE, 1, 1, 1]],
  [ZONE.TERMINAL]: [[ITEM.BANDAGE, 5, 1, 2], [ITEM.PAINKILLERS, 4, 1, 2], [ITEM.MEDKIT, 2, 1, 1], [ITEM.TUNA, 5, 1, 2], [ITEM.ENERGY_DRINK, 5, 1, 2], [ITEM.BATTERY, 5, 1, 2], [ITEM.CLOTH, 4, 2, 4], [ITEM.ALCOHOL, 3, 1, 2], [ITEM.AMMO_9MM, 5, 10, 20], [ITEM.AMMO_556, 3, 15, 30], [ITEM.FLARE, 3, 1, 2], [ITEM.AMMO_FLARE, 3, 1, 3], [ITEM.TAPE, 3, 1, 2], [ITEM.FLARE_GUN, 1, 1, 1], [ITEM.JACKET, 1, 1, 1]],
  [ZONE.HANGARS]: [[ITEM.SCRAP, 7, 2, 4], [ITEM.TAPE, 5, 1, 2], [ITEM.WIRE, 4, 1, 3], [ITEM.GUNPARTS, 4, 1, 2], [ITEM.NAILS, 4, 4, 10], [ITEM.BATTERY, 4, 1, 2], [ITEM.AMMO_556, 5, 15, 30], [ITEM.AMMO_762, 4, 15, 30], [ITEM.AMMO_FUEL, 3, 30, 60], [ITEM.PLATE, 2, 1, 1], [ITEM.POWDER, 3, 3, 6], [ITEM.FLARE, 3, 1, 2], [ITEM.MEDKIT, 1, 1, 1]],
  [ZONE.FUEL_DEPOT]: [[ITEM.AMMO_FUEL, 7, 30, 60], [ITEM.CHEM, 6, 1, 3], [ITEM.ALCOHOL, 4, 1, 2], [ITEM.TAPE, 4, 1, 2], [ITEM.SCRAP, 5, 2, 4], [ITEM.CLOTH, 4, 2, 3], [ITEM.FLARE, 3, 1, 2], [ITEM.BATTERY, 3, 1, 2], [ITEM.MOLOTOV, 2, 1, 1], [ITEM.AMMO_9MM, 3, 8, 16]],
  [ZONE.TRUCKSTOP]: [[ITEM.TUNA, 6, 1, 2], [ITEM.ENERGY_DRINK, 6, 1, 2], [ITEM.SCRAP, 5, 1, 3], [ITEM.TAPE, 4, 1, 2], [ITEM.CHEM, 4, 1, 2], [ITEM.ALCOHOL, 4, 1, 2], [ITEM.BATTERY, 4, 1, 2], [ITEM.AMMO_9MM, 4, 8, 16], [ITEM.AMMO_SHELLS, 3, 4, 8], [ITEM.PAINKILLERS, 3, 1, 2], [ITEM.POWDER, 3, 2, 4], [ITEM.AMMO_FUEL, 3, 20, 40], [ITEM.PISTOL, 1, 1, 1]],
  // the places out over the plain: each is worth the walk for something of its own (first-pass numbers, not played)
  // medicine, behind the wire
  [ZONE.QUARANTINE]: [[ITEM.BANDAGE, 8, 1, 3], [ITEM.MEDKIT, 4, 1, 1], [ITEM.PAINKILLERS, 6, 1, 2], [ITEM.CHEM, 4, 1, 2], [ITEM.CLOTH, 5, 2, 4], [ITEM.TUNA, 4, 1, 2], [ITEM.BATTERY, 3, 1, 2], [ITEM.AMMO_556, 3, 15, 30], [ITEM.JACKET, 1, 1, 1]],
  // the army's ammunition
  [ZONE.ROADBLOCK]: [[ITEM.AMMO_556, 7, 20, 40], [ITEM.AMMO_762, 6, 15, 30], [ITEM.AMMO_9MM, 4, 10, 20], [ITEM.WIRE, 4, 1, 3], [ITEM.PLATE, 3, 1, 1], [ITEM.GUNPARTS, 4, 1, 2], [ITEM.GRENADE, 2, 1, 1], [ITEM.FLARE, 3, 1, 2], [ITEM.MEDKIT, 2, 1, 1], [ITEM.M4A1, 1, 1, 1], [ITEM.AMMO_145, 1, 2, 3]],
  // wire, batteries and scrap: what a generator and its floodlights are built of
  [ZONE.SUBSTATION]: [[ITEM.WIRE, 8, 1, 3], [ITEM.BATTERY, 7, 1, 3], [ITEM.SCRAP, 6, 2, 4], [ITEM.TAPE, 5, 1, 2], [ITEM.GUNPARTS, 2, 1, 1], [ITEM.CHEM, 3, 1, 2], [ITEM.NAILS, 3, 4, 10]],
  [ZONE.WATERWORKS]: [[ITEM.CHEM, 7, 1, 3], [ITEM.SCRAP, 6, 2, 4], [ITEM.TAPE, 5, 1, 2], [ITEM.ROPE, 4, 1, 2], [ITEM.NAILS, 4, 4, 10], [ITEM.BATTERY, 3, 1, 2], [ITEM.AMMO_SHELLS, 3, 4, 8], [ITEM.HAMMER, 1, 1, 1]],
  [ZONE.MARINA]: [[ITEM.ROPE, 7, 1, 3], [ITEM.AMMO_FLARE, 5, 1, 3], [ITEM.FLARE, 4, 1, 2], [ITEM.TUNA, 6, 1, 3], [ITEM.ALCOHOL, 4, 1, 2], [ITEM.TAPE, 4, 1, 2], [ITEM.AMMO_FUEL, 4, 20, 40], [ITEM.BATTERY, 3, 1, 2], [ITEM.AMMO_SHELLS, 3, 4, 8], [ITEM.FLARE_GUN, 1, 1, 1], [ITEM.CROSSBOW, 1, 1, 1]],
  [ZONE.TRAILERPARK]: [[ITEM.CLOTH, 6, 1, 3], [ITEM.ALCOHOL, 5, 1, 2], [ITEM.AMMO_SHELLS, 6, 4, 8], [ITEM.AMMO_9MM, 4, 6, 12], [ITEM.TUNA, 5, 1, 2], [ITEM.CHEM, 4, 1, 2], [ITEM.POWDER, 4, 2, 4], [ITEM.PAINKILLERS, 3, 1, 1], [ITEM.MOLOTOV, 2, 1, 1], [ITEM.DB_SHOTGUN, 1, 1, 1], [ITEM.BAT, 1, 1, 1]],
  [ZONE.SALVAGE]: [[ITEM.SCRAP, 10, 2, 5], [ITEM.GUNPARTS, 4, 1, 2], [ITEM.WIRE, 5, 1, 3], [ITEM.TAPE, 4, 1, 2], [ITEM.BATTERY, 4, 1, 2], [ITEM.NAILS, 4, 4, 10], [ITEM.PLATE, 2, 1, 1], [ITEM.AMMO_FUEL, 3, 20, 40], [ITEM.SPIKED_BAT, 1, 1, 1]],
  // a bit of everything, by the shelf
  [ZONE.MALL]: [[ITEM.TUNA, 7, 1, 3], [ITEM.ENERGY_DRINK, 6, 1, 3], [ITEM.CLOTH, 6, 2, 4], [ITEM.BATTERY, 6, 1, 3], [ITEM.TAPE, 5, 1, 2], [ITEM.BANDAGE, 5, 1, 2], [ITEM.PAINKILLERS, 4, 1, 2], [ITEM.NAILS, 5, 6, 14], [ITEM.ROPE, 3, 1, 2], [ITEM.AMMO_SHELLS, 4, 4, 8], [ITEM.AMMO_9MM, 4, 10, 20], [ITEM.AMMO_308, 3, 3, 6], [ITEM.POWDER, 4, 3, 6], [ITEM.BAT, 1, 1, 1], [ITEM.MACHETE, 1, 1, 1], [ITEM.HUNTING_RIFLE, 1, 1, 1], [ITEM.JACKET, 1, 1, 1]],
  [ZONE.SCHOOL]: [[ITEM.CLOTH, 6, 2, 4], [ITEM.BANDAGE, 6, 1, 2], [ITEM.TUNA, 6, 1, 2], [ITEM.ENERGY_DRINK, 4, 1, 2], [ITEM.BATTERY, 5, 1, 2], [ITEM.TAPE, 5, 1, 2], [ITEM.PAINKILLERS, 4, 1, 2], [ITEM.CHEM, 3, 1, 2], [ITEM.MEDKIT, 1, 1, 1], [ITEM.BAT, 1, 1, 1], [ITEM.NUNCHAKU, 1, 1, 1]],
  [ZONE.MAST]: [[ITEM.BATTERY, 7, 1, 3], [ITEM.WIRE, 6, 1, 3], [ITEM.GUNPARTS, 4, 1, 2], [ITEM.AMMO_308, 5, 3, 6], [ITEM.AMMO_556, 3, 10, 20], [ITEM.TAPE, 4, 1, 2], [ITEM.FLARE, 3, 1, 2], [ITEM.AMMO_FLARE, 3, 1, 3], [ITEM.HUNTING_RIFLE, 1, 1, 1]],
  [ZONE.MOTORINN]: [[ITEM.CLOTH, 7, 2, 4], [ITEM.ALCOHOL, 6, 1, 2], [ITEM.PAINKILLERS, 5, 1, 2], [ITEM.BANDAGE, 5, 1, 2], [ITEM.AMMO_9MM, 5, 8, 16], [ITEM.BATTERY, 4, 1, 2], [ITEM.TUNA, 4, 1, 2], [ITEM.ENERGY_DRINK, 3, 1, 2], [ITEM.POWDER, 3, 2, 4], [ITEM.PISTOL, 1, 1, 1], [ITEM.MP5, 1, 1, 1], [ITEM.DECOY, 1, 1, 1]],
  [ZONE.GRAVEYARD]: [[ITEM.CLOTH, 6, 1, 3], [ITEM.TORCH, 5, 1, 2], [ITEM.HERB, 5, 1, 3], [ITEM.ALCOHOL, 3, 1, 1], [ITEM.ROPE, 3, 1, 1], [ITEM.AMMO_SHELLS, 3, 3, 6], [ITEM.MEDKIT, 1, 1, 1]],
  [ZONE.LOGGING]: [[ITEM.WOOD, 10, 3, 6], [ITEM.STICK, 6, 3, 6], [ITEM.NAILS, 7, 6, 12], [ITEM.ROPE, 5, 1, 2], [ITEM.AMMO_FUEL, 4, 20, 40], [ITEM.LEATHER, 3, 1, 2], [ITEM.AMMO_308, 3, 3, 6], [ITEM.MACHETE, 1, 1, 1], [ITEM.HAMMER, 1, 1, 1]],
  // what two hundred people were carrying
  [ZONE.CRASH]: [[ITEM.CLOTH, 8, 2, 4], [ITEM.PAINKILLERS, 6, 1, 2], [ITEM.BANDAGE, 5, 1, 2], [ITEM.ALCOHOL, 5, 1, 2], [ITEM.BATTERY, 5, 1, 2], [ITEM.TUNA, 4, 1, 2], [ITEM.ENERGY_DRINK, 4, 1, 2], [ITEM.TAPE, 3, 1, 1], [ITEM.MEDKIT, 2, 1, 1], [ITEM.AMMO_9MM, 3, 8, 16], [ITEM.FLARE, 3, 1, 2], [ITEM.PISTOL, 1, 1, 1], [ITEM.KEVLAR, 1, 1, 1]],
  [ZONE.CONTAINERS]: [[ITEM.SCRAP, 7, 2, 4], [ITEM.NAILS, 6, 6, 14], [ITEM.WOOD, 5, 2, 5], [ITEM.TAPE, 5, 1, 2], [ITEM.ROPE, 4, 1, 2], [ITEM.TUNA, 5, 1, 3], [ITEM.CHEM, 4, 1, 2], [ITEM.POWDER, 4, 3, 6], [ITEM.WIRE, 3, 1, 3], [ITEM.GUNPARTS, 3, 1, 1], [ITEM.PLATE, 1, 1, 1]],
};
LOOT_TABLES[ZONE.WESTGATE] = LOOT_TABLES[ZONE.SUBURB]; // (houses are houses)
// (the third pass's places: each has what a place like it has)
LOOT_TABLES[ZONE.BOATWORKS] = LOOT_TABLES[ZONE.MARINA];
LOOT_TABLES[ZONE.DRIVEIN_M] = LOOT_TABLES[ZONE.DRIVEIN];
LOOT_TABLES[ZONE.FIREHOUSE] = LOOT_TABLES[ZONE.TERMINAL];
LOOT_TABLES[ZONE.GRAIN] = LOOT_TABLES[ZONE.BARN];
LOOT_TABLES[ZONE.DINER_M] = LOOT_TABLES[ZONE.TRUCKSTOP];
LOOT_TABLES[ZONE.CARLOT] = LOOT_TABLES[ZONE.SALVAGE];
LOOT_TABLES[ZONE.STORAGE] = LOOT_TABLES[ZONE.CONTAINERS];
LOOT_TABLES[ZONE.EVAC] = LOOT_TABLES[ZONE.QUARANTINE];
LOOT_TABLES[ZONE.NURSERY] = LOOT_TABLES[ZONE.BARN];
LOOT_TABLES[ZONE.MOTORPOOL] = LOOT_TABLES[ZONE.HELIPAD] = LOOT_TABLES[ZONE.ROADBLOCK];
LOOT_TABLES[ZONE.AGGREGATES] = LOOT_TABLES[ZONE.INDUSTRIAL];
LOOT_TABLES[ZONE.FARM_A] = LOOT_TABLES[ZONE.FARM_B] = LOOT_TABLES[ZONE.BARN];

// ---------------------------------------------------------------- searchable containers
// Every place (and many roadside / woodland sites) has containers: hold [E] to search.
// table: loot table (null = the zone's table), rolls: [min, max] items, schem: may hold a schematic on top of its loot.
export const CONT = { CRATE: 1, AMMO_BOX: 2, TRUNK: 3, DUFFEL: 4, LOCKER: 5, CABINET: 6, TOOLBOX: 7, SHELF: 8, DUMPSTER: 9, LOGPILE: 10, FRIDGE: 11, STRONGBOX: 12, FREIGHT: 13, CASKET: 15 };
// Mercy Clinic's own (shared/clinic.js): the cabinets of its pharmacy and wards, and the one drug locker of a map
CONT.MEDICINE = 16;
CONT.DRUG_LOCKER = 17;
// A place's own table only reaches its floor loot, crates and shelves, so whatever a recipe or an ammo type depends on
// needs a container table too: ammo crates hold the AK-47 next to the 7.62 they are full of (as rare as the M4A1) and
// kevlar plates by the pair (a vest takes two), trunks and duffels hold leather. A new entry thins every other one in
// its table, so these went in at weight 1 and the plates grew in count, not in weight. First-pass numbers.
export const CONT_TABLES = {
  military: [[ITEM.AMMO_762, 6, 15, 30], [ITEM.AMMO_556, 5, 15, 30], [ITEM.AMMO_9MM, 4, 10, 20], [ITEM.AMMO_SHELLS, 3, 4, 8], [ITEM.POWDER, 4, 3, 6], [ITEM.PLATE, 2, 2, 2], [ITEM.GUNPARTS, 3, 1, 2], [ITEM.MEDKIT, 2, 1, 1], [ITEM.PIPEBOMB, 1, 1, 1], [ITEM.GRENADE, 1, 1, 1], [ITEM.FLARE, 3, 1, 2], [ITEM.WIRE, 2, 1, 2], [ITEM.M4A1, 1, 1, 1], [ITEM.AK47, 1, 1, 1], [ITEM.AMMO_FUEL, 2, 30, 60], [ITEM.FLAMETHROWER, 1, 1, 1], [ITEM.AMMO_ROCKET, 1, 1, 2], [ITEM.RPG, 1, 1, 1], [ITEM.AMMO_145, 2, 2, 4], [ITEM.AT_RIFLE, 1, 1, 1], [ITEM.AMMO_FLARE, 2, 1, 3], [ITEM.FLARE_GUN, 1, 1, 1]],
  trunk: [[ITEM.SCRAP, 5, 1, 2], [ITEM.TAPE, 4, 1, 1], [ITEM.BATTERY, 3, 1, 1], [ITEM.CLOTH, 7, 2, 3], [ITEM.ALCOHOL, 3, 1, 1], [ITEM.FLARE, 4, 1, 2], [ITEM.AMMO_9MM, 3, 6, 12], [ITEM.AMMO_SHELLS, 2, 3, 6], [ITEM.ROPE, 2, 1, 1], [ITEM.NAILS, 2, 3, 6], [ITEM.BAT, 1, 1, 1], [ITEM.TUNA, 2, 1, 1], [ITEM.LEATHER, 1, 1, 2], [ITEM.ENERGY_DRINK, 2, 1, 1], [ITEM.AMMO_FLARE, 1, 1, 2]],
  duffel: [[ITEM.BANDAGE, 5, 1, 2], [ITEM.CLOTH, 7, 2, 3], [ITEM.AMMO_9MM, 5, 8, 16], [ITEM.AMMO_SHELLS, 3, 4, 8], [ITEM.PAINKILLERS, 3, 1, 1], [ITEM.BATTERY, 3, 1, 1], [ITEM.MOLOTOV, 2, 1, 1], [ITEM.FLARE, 2, 1, 1], [ITEM.MEDKIT, 1, 1, 1], [ITEM.KNIFE, 1, 1, 1], [ITEM.JACKET, 1, 1, 1], [ITEM.TUNA, 3, 1, 1], [ITEM.LEATHER, 1, 1, 2], [ITEM.ENERGY_DRINK, 2, 1, 1], [ITEM.NUNCHAKU, 1, 1, 1]],
  locker: [[ITEM.AMMO_9MM, 4, 10, 20], [ITEM.AMMO_308, 3, 3, 6], [ITEM.AMMO_SHELLS, 3, 4, 8], [ITEM.GUNPARTS, 4, 1, 1], [ITEM.JACKET, 2, 1, 1], [ITEM.BATTERY, 3, 1, 2], [ITEM.BANDAGE, 3, 1, 2], [ITEM.FLARE, 2, 1, 2], [ITEM.PISTOL, 1, 1, 1], [ITEM.MP5, 1, 1, 1], [ITEM.ENERGY_DRINK, 2, 1, 1], [ITEM.AMMO_FLARE, 1, 1, 2]],
  cabinet: [[ITEM.BANDAGE, 5, 1, 2], [ITEM.PAINKILLERS, 5, 1, 2], [ITEM.ALCOHOL, 5, 1, 2], [ITEM.CHEM, 4, 1, 2], [ITEM.HERB, 3, 1, 2], [ITEM.CLOTH, 4, 1, 3], [ITEM.MEDKIT, 1, 1, 1], [ITEM.BATTERY, 2, 1, 1], [ITEM.TUNA, 3, 1, 2]],
  toolbox: [[ITEM.NAILS, 8, 6, 14], [ITEM.SCRAP, 5, 1, 3], [ITEM.TAPE, 5, 1, 2], [ITEM.WIRE, 3, 1, 2], [ITEM.GUNPARTS, 1, 1, 1], [ITEM.HAMMER, 1, 1, 1]],
  dumpster: [[ITEM.CLOTH, 8, 2, 4], [ITEM.SCRAP, 5, 1, 2], [ITEM.CHEM, 3, 1, 1], [ITEM.ALCOHOL, 3, 1, 1], [ITEM.STICK, 3, 2, 4], [ITEM.TAPE, 2, 1, 1], [ITEM.BATTERY, 1, 1, 1]],
  logpile: [[ITEM.WOOD, 8, 3, 6], [ITEM.STICK, 5, 3, 6], [ITEM.NAILS, 2, 3, 6]],
  fridge: [[ITEM.ALCOHOL, 6, 1, 2], [ITEM.CHEM, 3, 1, 1], [ITEM.HERB, 3, 1, 2], [ITEM.PAINKILLERS, 2, 1, 1], [ITEM.BANDAGE, 2, 1, 1], [ITEM.TUNA, 5, 1, 2], [ITEM.ENERGY_DRINK, 4, 1, 2]],
  // the one strongbox of a map, in the deepest room of the mine: one roll, and every row is a gun worth the trip
  strongbox: [[ITEM.M4A1, 1, 1, 1], [ITEM.AK47, 1, 1, 1], [ITEM.FLAMETHROWER, 1, 1, 1], [ITEM.RPG, 1, 1, 1], [ITEM.AT_RIFLE, 1, 1, 1]],
  // the casket in the crypt of St. Agnes Cemetery: what somebody who meant to sit the nights out in there left behind
  crypt: [[ITEM.AMMO_SHELLS, 5, 4, 8], [ITEM.TORCH, 4, 2, 3], [ITEM.FLARE, 3, 1, 2], [ITEM.ALCOHOL, 3, 1, 2], [ITEM.BANDAGE, 3, 1, 2], [ITEM.MEDKIT, 2, 1, 1], [ITEM.GUNPARTS, 2, 1, 1], [ITEM.DB_SHOTGUN, 1, 1, 1]],
  // freight that never got where it was going (the boxcars of the stalled train, the depot's freight shed): what a
  // shelter is built of, by the crate
  freight: [[ITEM.WOOD, 8, 3, 6], [ITEM.NAILS, 7, 6, 14], [ITEM.SCRAP, 6, 2, 4], [ITEM.ROPE, 4, 1, 2], [ITEM.TAPE, 4, 1, 2], [ITEM.WIRE, 3, 1, 3], [ITEM.TUNA, 4, 1, 3], [ITEM.CHEM, 3, 1, 2], [ITEM.POWDER, 3, 2, 5], [ITEM.BATTERY, 3, 1, 2], [ITEM.ALCOHOL, 2, 1, 2], [ITEM.GUNPARTS, 1, 1, 1]],
};
// what a clinic keeps under lock: the one table where a medkit is a likely find and not a lucky one
CONT_TABLES.medical = [[ITEM.BANDAGE, 7, 1, 3], [ITEM.PAINKILLERS, 6, 1, 2], [ITEM.MEDKIT, 4, 1, 1], [ITEM.ALCOHOL, 4, 1, 2], [ITEM.CHEM, 3, 1, 2]];
export const CONT_DEFS = {
  [CONT.CRATE]: { name: 'Crate', table: null, rolls: [2, 3] },
  [CONT.AMMO_BOX]: { name: 'Ammo Crate', table: 'military', rolls: [2, 3], schem: true },
  [CONT.TRUNK]: { name: 'Car Trunk', table: 'trunk', rolls: [1, 3] },
  [CONT.DUFFEL]: { name: 'Duffel Bag', table: 'duffel', rolls: [2, 3] },
  [CONT.LOCKER]: { name: 'Locker', table: 'locker', rolls: [2, 3], schem: true },
  [CONT.CABINET]: { name: 'Cabinet', table: 'cabinet', rolls: [1, 3] },
  [CONT.TOOLBOX]: { name: 'Toolbox', table: 'toolbox', rolls: [2, 3], schem: true },
  [CONT.SHELF]: { name: 'Shelves', table: null, rolls: [1, 3] },
  [CONT.DUMPSTER]: { name: 'Dumpster', table: 'dumpster', rolls: [1, 2] },
  [CONT.LOGPILE]: { name: 'Log Pile', table: 'logpile', rolls: [1, 2] },
  [CONT.FRIDGE]: { name: 'Fridge', table: 'fridge', rolls: [1, 2] },
  // also: what is always in it besides the rolls, [item, count]. loaded: a weapon rolled from it comes with this many
  // magazines of its ammunition (loadedAmmo). once: it is not refilled at sunrise. guide: what the item tooltips call
  // it as a place to find things (there is one to a map, so not "strongboxes").
  [CONT.STRONGBOX]: { name: 'Strongbox', table: 'strongbox', rolls: [1, 1], also: [[ITEM.PIPEBOMB, 2]], loaded: 2, once: true, guide: "the mine's strongbox" },
  [CONT.CASKET]: { name: 'Casket', table: 'crypt', rolls: [3, 4], guide: 'the casket in the crypt' },
  [CONT.FREIGHT]: { name: 'Freight Crate', table: 'freight', rolls: [2, 4] },
};
// Mercy Clinic. The drug locker stands in its deepest ward and is filled once a game, as the strongbox is: what makes
// the walk into the dark worth it
CONT_DEFS[CONT.MEDICINE] = { name: 'Medicine Cabinet', table: 'medical', rolls: [2, 3] };
CONT_DEFS[CONT.DRUG_LOCKER] = { name: 'Drug Locker', table: 'medical', rolls: [1, 1], also: [[ITEM.MEDKIT, 2], [ITEM.PAINKILLERS, 3], [ITEM.BANDAGE, 4]], once: true, guide: "the clinic's drug locker" };
// the ammunition that comes with weapon `item` out of a container whose weapons are loaded: [ammo item, count], or
// null for anything that takes none
export function loadedAmmo(item, mags) {
  const w = WEAPONS[item];
  return w && !w.melee && w.mag > 0 && AMMO_ITEMS[w.ammo] !== undefined ? [AMMO_ITEMS[w.ammo], w.mag * mags] : null;
}

// zombie loot drops: [item, weight, min, max]
export const ZOMBIE_LOOT = [[ITEM.CLOTH, 8, 1, 2], [ITEM.AMMO_9MM, 5, 4, 10], [ITEM.SCRAP, 3, 1, 1], [ITEM.AMMO_SHELLS, 2, 2, 4], [ITEM.AMMO_762, 2, 6, 15], [ITEM.AMMO_556, 2, 6, 15], [ITEM.HERB, 2, 1, 1], [ITEM.NAILS, 3, 2, 6], [ITEM.BANDAGE, 1, 1, 1], [ITEM.POWDER, 4, 1, 3], [ITEM.BATTERY, 1, 1, 1]];
export const SPECIAL_LOOT = [[ITEM.AMMO_762, 4, 15, 30], [ITEM.AMMO_556, 4, 15, 30], [ITEM.AMMO_SHELLS, 4, 4, 8], [ITEM.MEDKIT, 2, 1, 1], [ITEM.POWDER, 3, 3, 6], [ITEM.GUNPARTS, 2, 1, 1], [ITEM.PLATE, 1, 1, 1], [ITEM.TAPE, 3, 1, 2], [ITEM.CHEM, 2, 1, 2], [ITEM.AMMO_145, 1, 1, 3], [ITEM.GRENADE, 1, 1, 1]];

// Gunpowder where an ordinary day's looting goes (issue #89). It used to be kept only by the mine, the quarry, the
// military places, the hunters' (lookout, cabins, lodge), ammo crates and freight crates: a day of seven searches in
// three other places found none nine days in ten, whatever POWDER_MORE made of a find. A gun locker is the likeliest
// place for it, a toolbox, a duffel or a car trunk less so; the places get it on their own table (their crates and
// shelves, and what lies about), all but the farm, the woods, the camps, the church, the cemetery and the clinic. The
// dead drop it twice as often too (ZOMBIE_LOOT, weight 2 -> 4). Written like every other row, so POWDER_MORE below
// scales these as well. First-pass numbers.
const POWDER_IN = [
  [CONT_TABLES.locker, 5, 2, 4],
  [CONT_TABLES.toolbox, 3, 2, 3],
  [CONT_TABLES.duffel, 3, 2, 3],
  [CONT_TABLES.trunk, 3, 1, 2],
  [LOOT_TABLES[ZONE.GAS], 4, 2, 3],
  [LOOT_TABLES[ZONE.TRAILERS], 4, 2, 3],
  [LOOT_TABLES[ZONE.VILLAGE], 4, 2, 3],
  [LOOT_TABLES[ZONE.STATION], 4, 2, 3],
  [LOOT_TABLES[ZONE.SCRAPYARD], 4, 2, 3],
  [LOOT_TABLES[ZONE.FAIR], 4, 2, 3],
  [LOOT_TABLES[ZONE.RELAY], 3, 1, 3],
  [LOOT_TABLES[ZONE.DRIVEIN], 3, 1, 3],
  [LOOT_TABLES[ZONE.DOCK], 3, 1, 3],
  [LOOT_TABLES[ZONE.ROADSIDE], 3, 1, 2],
  [LOOT_TABLES[ZONE.MOTEL], 3, 1, 2],
];
for (const [t, weight, min, max] of POWDER_IN) t.push([ITEM.POWDER, weight, min, max]);

// More gunpowder (issue #89: ammunition was too scarce to craft). Every row of it in the tables above - the places',
// the containers', the dead's - gives POWDER_MORE times as much as it was written with: its count, not its weight,
// so no other find in the table gets rarer for it (the low end rounded down, the high end to the nearest, which keeps
// each row's average close to POWDER_MORE times). With the campfire's 6 to a chemical (recipe 19, from 4).
export const POWDER_MORE = 1.5;
for (const t of [...Object.values(LOOT_TABLES), ...Object.values(CONT_TABLES), ZOMBIE_LOOT, SPECIAL_LOOT]) {
  for (const row of t) {
    if (row[0] !== ITEM.POWDER) continue;
    row[2] = Math.floor(row[2] * POWDER_MORE);
    row[3] = Math.round(row[3] * POWDER_MORE);
  }
}

export function isFirearm(item) {
  const w = WEAPONS[item];
  return !!(w && !w.melee);
}
export function slotForItem(item) {
  const w = WEAPONS[item];
  if (w) return w.slot;
  if (THROW_ITEMS.includes(item)) return 3;
  return -1;
}
export function isThrowable(item) {
  return THROW_ITEMS.includes(item);
}
