# T-033 — Throwing items: improvised throws, Thrown weapons land, lit torches stay lit

- **Status:** done
- **Foundry:** test
- **Owner:** Alivas
- **Area:** engine

## Goal
Any carried item can be thrown, at a creature (an attack) or at a space (no roll), within limits set by its weight and
the thrower's Strength and size. The thrown item lands on the map as a loot pile (Item Piles). A lit torch lands lit.
Weapons with the Thrown property land the same way after a thrown attack.

## Sources
- 2024 PHB (5etools `book/book-xphb.json`, `variantrules.json`, `items-base.json`):
  - Improvised Weapons (p. 369): no Proficiency Bonus; 1d4 of a type the DM picks; thrown range 20/60; Weapon
    Equivalents (the DM may treat the object as a similar weapon).
  - Thrown property (p. 214); Attack Roll Abilities table (p. 12): a ranged attack with a weapon uses Dexterity.
  - Carrying Capacity (p. 362): Str × 15 lb (Small/Medium), halved for Tiny, doubled per size above Medium.
  - Torch (p. 229): melee attack, 1 Fire damage. Greatclub: 10 lb, Two-Handed, 1d8.
  - Tavern Brawler (feats): proficiency with improvised weapons.
  - Oil / Alchemist's Fire / Acid: "replace one of your attacks with throwing".
- dnd5e 6.1.1 (`systems/dnd5e/dnd5e.mjs`):
  - weapon type `improv` is proficient with `flags.dnd5e.tavernBrawlerFeat`;
  - `ChatMessage5e#getAssociatedItem` falls back to `system.deltas.deleted` (or the originating card's) when the item is
    gone; `flags.dnd5e.item.data` is dropped by 6.1's message model;
  - `AttackActivity#rollAttack` lowers a weapon's quantity by 1 on a thrown-mode attack unless it has the Returning
    property `ret` (after the `dnd5e.rollAttackV2` hook);
  - long range isn't checked for any attack.

## Rulings (maintainer, 2026-11-26)
1. **Weight bands**, per unit, Strength score S, size factor m (Tiny ½, Small/Medium 1, Large 2, Huge 4, Gargantuan 8 —
   the Carrying Capacity table's pattern):
   - up to S × 0.5 × m lb: one hand, range 20/60;
   - up to S × 2 × m lb: two hands, range 10/30;
   - heavier: can't be thrown.
2. **Damage by absolute weight**, not by band: under 10 lb 1d4, 10 lb or more 1d8 (Weapon Equivalents: Greatclub).
3. **Torch:** always Bludgeoning, plus its melee Fire damage (1) when lit.
4. **Landing:** hit or miss, a random free square adjacent to the target. A destroyed item is deleted by the DM.
5. **Throw at a space:** the thrower picks the square. Within normal range it lands there; beyond it (to long range) in
   a random free square adjacent to it. No roll.
6. **Cost:** a throw at a space replaces one attack of the Attack action, like a throw at a creature.
7. **Ability:** Dexterity for attack and damage (rules as written). Tavern Brawler adds proficiency.
8. **Thrown weapons** land the same way; a returning weapon doesn't (dnd5e's own Returning property is used for that).

## Design
- New `alivas-engine-of-triggers/scripts/throw.mjs` (its header documents everything).
- Item context menu "Throw…" (any owned weapon, equipment, consumable, tool, loot or container not inside a container):
  a dialog with the weight, band, hands, range and damage; buttons "At <target>" (exactly one target) and "At a space".
- At a creature, improvised: a temporary stand-in weapon (type `improv`, Dex, the band's range, the rulings' damage,
  activation Action, unequipped) is created on the thrower and its attack used through the normal dnd5e + Engine
  workflow (reactions, cover, Extra Attack). It's removed when the attack resolves, at the next throw, or after 10 min.
  Beyond normal range: Disadvantage; beyond long range: refused (stand-ins only).
- At a creature, Thrown weapon: its own attack. dnd5e lowers the quantity; a copy of one unit lands
  (`Loot.dropItems` new option `keep`). Not when it has Returning, or had quantity 0.
- Landing: Engine hook `alivasTriggers.attackResolved({ activity, roll, targets, landed })`, new in `main.mjs`, fired after
  hits, reactions, damage and onHit; the item goes to `scatterSpot` (trade.mjs, now exported) of the target.
- Chat cards of stand-ins and Thrown weapons store the item in `system.deltas.deleted`; damage cards without an origin
  are pointed at that card, so card buttons work after the item left.
- `createToken` (main.mjs): a new token whose actor holds a lit item gets the light (an Item Piles pile).
- Settings (Trading section): throwItems, throwLightPerStr (0.5), throwHeavyPerStr (2), throwHeavyDieLb (10).
- Item setting (reactions editor → Item settings): "Damage type when thrown" (flag `throwDamageType`, default
  Bludgeoning).
- Also: `Loot` GM relay `lootDrop` now passes `skipTiming`, `quiet` and `keep` through.

## Done
Live-tested 2026-11-26 on Foundry 14.370, dnd5e 6.1.1, Item Piles 3.3.4 (+ socketlib 1.1.4, libWrapper 1.13.5.1), on a
throwaway ZZ scene (cleaned up). Str 10 / Dex 14 Medium thrower:
- Bands: torch and dagger (1 lb) light 20/60; 15-lb block heavy 10/30; 30-lb boulder refused ("can throw up to 20 lb").
- Lit torch at a creature: attack `1d20 + 2 + 0` (Dex, no PB), damage `1d4 + 2` Bludgeoning + `1` Fire; the stand-in
  is removed; the torch lands next to the target as a pile lit 20/40; the thrower goes dark. Usage, attack and damage
  cards all still find the item afterwards.
- 15-lb block: `1d8 + 2`; at 25 ft `2d20dis`; at 35 ft refused. With "Damage type when thrown" Piercing (set and saved in
  the editor, reopened showing Piercing): `1d8 + 2 piercing`.
- Dagger ×3, thrown-mode attack: 2 left in the inventory, a pile of 1 next to the target. With Returning: nothing
  lands, quantity unchanged. At quantity 0: no pile. Melee mode: nothing lands.
- At a space (placement stubbed): 15 ft lands in the square; 40 ft (torch) lands a square off, still lit; 70 ft
  refused. In a started combat the Action is marked.
- Sheet menu: "Throw…" is listed and visible; the dialog shows the right numbers.

Also fixed (T-032 follow-up): `torch-phb-2024-229.json` **v2** also matches the torches inside the Explorer's Pack
(`PKHfz87DirOHUBHn`) and Dungeoneer's Pack (`gYKSyS7STTresmnS`) in dnd5e 6.1.1's `equipment24`; live: all three get
Light.

## Left
- **Item Piles needs its dnd5e set-up.** Without the "Item Piles: D&D 5e" add-on (`itempilesdnd5e`) or the system
  settings (actor type `npc`, quantity `system.quantity`, …) Item Piles can't create piles at all. The local test world
  used hand-entered settings, not the add-on.
- Hands (one or two) are shown, not checked.
- Powerful Build doesn't change the bands (it applies to carrying capacity; the bands are a separate table ruling).
- Thrown weapons get no range check (dnd5e checks none); only improvised throws do.
- A space throw in combat marks the Action only if it's unused; it never refuses (no per-attack tracking exists).
- A stand-in whose attack is never rolled stays on the sheet until the next throw or 10 minutes.
- Not run with a player client (all tests as GM).

## Log
- 2026-11-26 — Claude (Opus 5.5): rulings collected with the maintainer; built and live-tested; switched "returns" to
  dnd5e's Returning property and stopped double-counting thrown weapons after the test showed dnd5e consumes them;
  torch patch v2.
