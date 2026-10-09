# Loadout item balance

Loadout items are permanent, personal collectibles. A survivor can equip three, so each item should feel useful without replacing the perk tree or making a stacked loadout solve a night by itself.

Rules used by the catalog:

- Keep most single passives at about 1-6%. Three equipped items are capped to at most 15% on normal multiplicative stats, which is below a perk branch's capped 25%.
- Additive survivability stays smaller than perks: loadouts cap at +15 max health, +2 health per kill, +4 stamina per kill, and +15% extra-find/gather chance.
- Weapon variants grant existing weapons only. Their special stats apply only while that marked loadout copy is equipped.
- Special ammo applies by caliber and stacks through the same modest combat caps: at most +10% damage, +8% headshot damage, +12% boss/Tank damage, one extra pierce, and 12% ignite chance.
- Once-per-night triggers are small recovery or ammo bumps on the first kill of a night. They reset at day/night phase changes and do not fire while downed or turned.
- Boss signature items use the boss as their source so boss drops prefer that boss's own themed pool.

Catalog ids are persisted. Append new rows; do not reuse or renumber old ids.

## Dead Hand wagers

Permanent loadout items can be wagered in Dead Hand at both lobby tables and in-run teammate tables. Cards remain a
separate Dead Hand collection: item wagers move only loadout item instances.

- Each player may offer zero or more owned loadout item copies. Both sides must confirm the shown stakes before a
  staked match is dealt, and changing either side's item list clears both confirmations. A match with no item stakes
  still deals without the stake confirmation step.
- Confirmed stakes are locked for the match. Locked items are hidden from normal loadout inventory, cannot be equipped
  into slots, traded, listed on the auction house, or wagered at another table. Active auction listings and already
  locked items cannot be added as stakes.
- Match settlement moves locked items in one loadout-store transaction. A win, forfeit, or timeout pays all wagered
  items to the winner. A true draw or server-side abort unlocks the items back to their original owners.
- Guests can wager items through the same browser-owner key used by loadouts and item trading. Auction account-only
  rules do not apply to Dead Hand wagers.
- If a player loses an equipped loadout item, its in-run granted copy is removed cleanly from weapons, armor,
  backpack, or inventory without dropping on the ground.
