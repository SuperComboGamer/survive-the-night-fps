// What the inventory screen says about an item: its stats, a short name for a backpack cell, its category, what it
// comes apart into. Shared by the backpack's item card (inventory.js) and the crafting panel (crafting.js).
import { ITEM, ITEM_DEFS, WEAPONS, SALVAGE, AMMO_NAMES, CONSUMABLES, THROWABLES, BURN } from '../../shared/defs.js';
import { BACKPACK_SLOTS } from '../../shared/constants.js';
import { SKYFLARE } from '../../shared/skyflare.js';
import { NK_MOVES, NK_MOVE } from '../../shared/nunchaku.js';

export const CAT_LABEL = { res: 'Material', cons: 'Consumable', throw: 'Throwable', armor: 'Armor', pack: 'Backpack', gear: 'Gear', weapon: 'Weapon', ammo: 'Ammunition', part: 'Car supply', schem: 'Schematic' };

export function statLines(id) {
  const d = ITEM_DEFS[id];
  const out = [];
  const w = WEAPONS[id];
  if (w) {
    if (w.nunchaku) {
      // a moveset, not one swing: the light chain blow by blow, the heavy attack by how long it is wound up
      const chain = [NK_MOVE.WHIP, NK_MOVE.BACKHAND, NK_MOVE.EIGHT, NK_MOVE.SMASH].map((m) => (NK_MOVES[m].hits.length > 1 ? NK_MOVES[m].hits.length + '×' : '') + NK_MOVES[m].damage);
      out.push(`Combo ${chain.join(' · ')}`, `Heavy ${[NK_MOVE.HEAVY1, NK_MOVE.HEAVY2, NK_MOVE.HEAVY3].map((m) => NK_MOVES[m].damage).join(' / ')}, wound up`, 'Every move costs stamina');
    } else if (w.melee) out.push(`Damage ${w.damage}` + (w.altDamage !== w.damage ? ` · heavy ${w.altDamage}` : ''), `Swing ${w.rate.toFixed(2)}s`);
    else if (w.rocket) out.push(`Blast ${w.damage} · ${w.rocket.radius}m radius`, `Single shot · ${AMMO_NAMES[w.ammo]}`, `Reload ${w.reload}s`);
    else if (w.flame) out.push(`Fire ${Math.round(w.damage / w.rate)}/s · ${w.range}m`, `Tank ${w.mag} · ${AMMO_NAMES[w.ammo]}`, `Sets alight: ${BURN.dps}/s for ${BURN.time}s`);
    else if (w.skyflare) out.push(`Burns ${SKYFLARE.burn}s · lights ${SKYFLARE.reach}m around`, `Single shot · ${AMMO_NAMES[w.ammo]}`, 'Pins Shades under it');
    else out.push(`Damage ${w.damage}${w.pellets > 1 ? ' × ' + w.pellets : ''}`, `Magazine ${w.mag} · ${AMMO_NAMES[w.ammo]}`, w.quiet ? 'Single shot · near-silent' : w.auto ? 'Full-auto' : 'Semi-auto');
  }
  const c = CONSUMABLES[id];
  if (c) {
    if (c.heal) out.push(`Heals ${c.heal} HP`);
    if (c.stamina) out.push('Restores stamina');
    if (c.flashlight) out.push('Recharges flashlight');
    out.push(`Use time ${c.time}s`);
  }
  const t = THROWABLES[id];
  if (t) out.push(`Radius ${t.radius}m` + (t.damage ? ` · ${t.damage} dmg` : ` · burns ${t.burnTime}s`));
  if (d && d.cat === 'armor') out.push(`${d.armor} armor · absorbs ${Math.round(d.absorb * 100)}%`);
  if (d && d.cat === 'pack') out.push(`+${BACKPACK_SLOTS} backpack slots`);
  return out;
}

// '4 Leather · 6 Cloth · 2 Rope': a cost, or what salvage gives back, in a line
export const costLine = (cost) =>
  Object.entries(cost)
    .map(([id, n]) => `${n} ${ITEM_DEFS[id].name}`)
    .join(' · ');

// what n of an item come apart into (SALVAGE), as [[item, count]]; empty when it cannot be torn down
export const salvageOf = (item, n = 1) => Object.entries(SALVAGE[item] || {}).map(([id, k]) => [+id, k * n]);

// The name under an icon in a backpack cell: the whole name where it fits (9 letters), else the word that tells it apart
const SHORT = {
  [ITEM.SCRAP]: 'Scrap',
  [ITEM.TAPE]: 'Tape',
  [ITEM.POWDER]: 'Powder',
  [ITEM.CHEM]: 'Chems',
  [ITEM.WIRE]: 'Wire',
  [ITEM.PLATE]: 'Plate',
  [ITEM.GUNPARTS]: 'Parts',
  [ITEM.PAINKILLERS]: 'Pills',
  [ITEM.TUNA]: 'Tuna',
  [ITEM.VENISON_RAW]: 'Raw meat',
  [ITEM.VENISON]: 'Venison',
  [ITEM.ENERGY_DRINK]: 'Energy',
  [ITEM.FLARE]: 'Flare',
  [ITEM.GRENADE]: 'Grenade',
  [ITEM.DECOY]: 'Noise',
  [ITEM.JACKET]: 'Jacket',
  [ITEM.KEVLAR]: 'Kevlar',
  [ITEM.WALKIE]: 'Walkie',
  [ITEM.BAT]: 'Bat',
  [ITEM.SPIKED_BAT]: 'Spiked',
  [ITEM.HUNTING_RIFLE]: 'Rifle',
  [ITEM.DB_SHOTGUN]: '2-Barrel',
  [ITEM.FLAMETHROWER]: 'Flamer',
  [ITEM.AT_RIFLE]: 'AT Rifle',
  [ITEM.CAR_BATTERY]: 'Car batt.',
  [ITEM.SPARE_TIRE]: 'Tire',
  [ITEM.SPARK_PLUGS]: 'Plugs',
  [ITEM.FAN_BELT]: 'Fan belt',
  [ITEM.SCHEM_EXPLOSIVES]: 'Explosive',
  [ITEM.SCHEM_METAL]: 'Fortify',
};
export function shortName(id) {
  const name = ITEM_DEFS[id]?.name || '';
  if (name.length <= 9) return name;
  return SHORT[id] || name.split(/[\s-]/)[0];
}
