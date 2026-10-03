# T-021 — Pact of the Blade family, Sacred Weapon, damage type choice, unseen attackers, Alert 2014/2024, Misty Step

- **Status:** needs-live-test
- **Foundry:** test
- **Owner:**
- **Area:** engine, editor, box

## Goal
Close the gaps found while reviewing Pact of the Blade, Blind Fighting, Alert and Fey-Touched (2026-10-03):
- Pact of the Blade:
  - conjure a weapon;
  - bond rules (a new bond ends the old one; the bond ends after 1 minute more than 5 ft away, or when you die);
  - the Spellcasting Attack uses the Warlock's ability on multiclass characters;
  - the invocations Thirsting Blade, Eldritch Smite and Lifedrinker.
- Unseen attackers and targets (2024 rules), so Blindsight, Truesight and Invisible matter on attack rolls.
- 2014 Alert: +5 initiative whatever the world's rules version, and no advantage for unseen attackers.
- 2024 Alert: also match dnd5e's SRD copy.
- Misty Step: Plutonium's copy is a plain utility activity; it now teleports.
- Sacred Weapon (XPHB p. 113):
  - using it again ends the earlier one;
  - it ends when the paladin isn't carrying the weapon;
  - the light follows the weapon and ends with it.
- Choosing a damage type when the engine rolls damage by itself. dnd5e's dialog, which normally offers the choice, is
  skipped, so before this the Radiant option of Sacred Weapon and Pact Weapon was never offered.

## Sources
- 5etools `optionalfeatures.json`, XPHB: Pact of the Blade p. 156, Thirsting Blade p. 157, Eldritch Smite p. 155,
  Lifedrinker p. 156.
- 5etools `spells-xphb.json` Misty Step p. 299. `feats.json`: Alert (PHB p. 165; XPHB p. 200).
- dnd5e `packs/_source/classes24/warlock/eldritch-invocation-options/*.yml`, `feats24/origin-feats/alert.yml` and
  `spells24/2nd-level/misty-step.yml`: base data, activity and effect structure.
- dnd5e 6.0.5 `dnd5e.mjs`:
  - `initiativeAlert` follows the world's rulesVersion, not the feat (lines ~10041/10064);
  - `EnchantActivity#applyEnchantment` creates compendium items on the actor;
  - effect `system.origin.activity`.

## Done (offline)
Engine:
- **Setting `unseenAttacks`** (Cover and vision group, default on), in `main.mjs`, `dnd5e.preRollAttackV2`.
  Disadvantage if the attacker can't see the target, advantage if the target can't see the attacker
  (`Creatures.canSee`). The effect rule `noUnseenAdvantage` on the target cancels the advantage.
- **Activity flag `castingAbility: { class } | { spell }`** (`main.mjs` `castingAbilityFor`). It overrides
  `spellcastingAbility` on every dnd5e activity class. The Box's weapon-option override (T-020) chains on top.
- **Bonds** (`main.mjs` "Bonds"; `Creatures.bondOf` / `bondsOf` / `itemFilterData`). The enchantment flag `bond`:
  - `single`: on create, ends the bonder's other bonds of the same id;
  - `away` / `range`: the lead GM checks on `updateWorldTime` and stores `awaySince` on the enchantment;
  - `endOnDeath`: triggered by the Dead status;
  - a `conjured` item is deleted when its bond ends (guarded: dnd5e may already delete it through `dependentOn`).
- **Action `conjureItem`** `{ pack, itemType, categories, enchant }`: shows a list picker (`HANDLERS.pickFromList`),
  then calls `enchant.applyEnchantment(profile, compendiumItem)` and flags the new item `conjured` and equipped.
- **Bond option `carried`**: the bond ends as soon as the item turns up in another inventory, checked on
  `createItem` and as world time passes.
- **Light on enchantments**: the `light` rule on an enchantment makes whoever holds the item shed the light.
  `refreshLight` also reads the enchantments on held items; `createItem`/`deleteItem` move the light with the item.
- **Setting `damageTypeChoice`** (default on; the "Attacks" group, formerly "Cover"), `workflow.mjs`
  `chooseDamageTypes`. Before an automatic attack or save damage roll, each damage part with 2+ types asks the roller.
  The answer goes into dnd5e's own `flags.dnd5e.last.<activity>.damageType.<i>`, which its roll then uses.
- **`extraAttack.item`**: a weapon filter. Both the triggering attack and the follow-up weapons must match.
- **Reactions:**
  - the hitting window's data has `item` (`identifier`, `name`, `type`, `bonds`, `properties`);
  - `after.ask` asks a yes/no question before the follow-up step.

Editor:
- activity setting "spellcasting ability comes from";
- effect rules: bond, noUnseenAdvantage, and the extra-attack weapon filter (presets: any / pact weapon / custom);
- action tile "Conjure an item";
- a reaction follow-up's "Ask first";
- filter keys: your weapon's bonds and identifier, the target's size (new kind `listText`).

Box (packed):

| File | Version | `_id` |
|---|---|---|
| `pact-of-the-blade-phb-2024.json` | v1 | 4U4KVgFb9aaraat9 |
| `thirsting-blade-phb-2024.json` | v1 | NcGpjcUUuGcXRRFP |
| `eldritch-smite-phb-2024.json` | v1 | YO2aZTL41b1Oo5If |
| `lifedrinker-phb-2024.json` | v1 | UFeEr8P5HXrkgTsO |
| `misty-step-phb-2024.json` | v1 | 200G5D1Aw6zowoom |
| `alert-phb-2014-165.json` | v1 | TwI931RxNrxITtdM |
| `alert-phb-2024-200.json` | v2: identifier and SRD keys added | nHy9HtIKzF7N5NZP |
| `sacred-weapon-phb-2024.json` | v2: the enchantment carries `bond { id: "sacred-weapon", single, carried }` and the `light`; the separate "Sacred Weapon (Light)" effect and its onUse are removed | — |

Stage (`sources.mjs`):
- an applied enchantment animates on the item's holder;
- `effectItem` resolves an enchantment to the item that enchanted it, so presets match;
- `deleteItem` ends the loops of the item's enchantments;
- the `Sacred Weapon (Light)` preset is removed from `presets/box.json`.

- The invocations match `{ type: feat, identifier, book: "PHB 2024" }` and the SRD `compendiumSource`.
- Built with a one-off script from the SRD YAML. The IDs above are fixed now; edit the JSON directly from here on.

## Assumptions to verify
- Plutonium labels 2014 PHB items `book: "PHB"`. The patch also accepts `"PHB 2014"`. No 2014 item was in the world
  dump to confirm it.
- Plutonium's invocation items have `system.identifier` = `pact-of-the-blade` / `thirsting-blade` /
  `eldritch-smite` / `lifedrinker`.
- `target.traits.size` is in the hitting window's target roll data (it's the actor's roll data).
- `Creatures.canSee` returns "can see" for tokens without vision. NPC tokens with vision switched off therefore never
  take the unseen penalty.

## Acceptance (live) — throwaway ZZ scene, token vision on
1. **Unseen attacks.**
   - An Invisible ZZ Fighter attacks a ZZ Goblin that has no special senses: advantage.
   - The Goblin attacks the Fighter: disadvantage.
   - Give the Goblin Blindsight 10 ft, adjacent: neither applies.
   - Turn the setting off: nothing applies.
2. **2014 Alert** (import a PHB 2014 Alert with Plutonium; confirm the match): initiative +5 in both legacy and modern
   worlds, with no proficiency-based bonus. An Invisible attacker gets no advantage against the Alert creature.
3. **2024 Alert, SRD copy** (dragged from dnd5e's feats compendium): Review & apply offers it, and Initiative Swap
   works.
4. **Pact of the Blade** (ZZ Warlock 5 / Wizard 3, Cha 16, Int 18):
   - **Conjure:** pick Longsword. It appears named "…, Pact Weapon", proficient, with the Spellcasting Attack, which
     uses **Cha** (+3), not Int.
   - **Bond a second weapon** (Forge on a dagger): the conjured longsword disappears and the bond chat line appears.
   - **Distance:** give the dagger to another ZZ token 10 ft away, then advance game time 1 minute. The bond ends; the
     dagger stays (it wasn't conjured).
   - **Death:** conjure again, then give the Warlock the Dead status. The bond ends and the weapon disappears.
5. **Thirsting Blade:**
   - Attack with the pact weapon (Attack action): one follow-up attack is offered, with the pact weapon only.
   - Attack with a non-pact weapon: no follow-up.
6. **Eldritch Smite:**
   - Hit with the pact weapon and pick Eldritch Smite with a level 3 Pact slot: +4d8 force, doubled on a crit, and one
     Pact slot spent.
   - The "Knock the target Prone?" question appears; Yes gives Prone.
   - Against a Gargantuan target: no Prone question.
   - Once per turn.
7. **Lifedrinker:**
   - Hit with the pact weapon, pick Lifedrinker (Psychic): +1d6 psychic.
   - "Spend a Hit Point Die…?" Yes: the largest Hit Point Die is spent and HP restored.
   - Once per turn across the three options.
8. **Misty Step** (Plutonium copy, after Review & apply): casting it asks for a spot within 30 ft and teleports.
9. **Sacred Weapon** (ZZ Paladin 3 Devotion, Cha 16):
   - Use it on a longsword: attacks get +3 and the token sheds 20/40 ft light with the yellow loop. A hit asks
     Slashing or Radiant.
   - Use it on a second weapon: the first loses it, and the light stays (from the second).
   - Hand the weapon to another ZZ token: the bond ends, and the light and the loop stop.
   - The Channel Divinity use is spent.
10. **Damage type choice:** a Pact Weapon hit asks Slashing / Necrotic / Psychic / Radiant, and the roll uses the
    answer. Turn the setting off: no question; dnd5e uses its last choice.
11. **Flurry of Blows v3** (Heightened Focus). Activity flag `repeat.count` may be a formula (`workflow.mjs`
    `strikeCount`). The patch uses `2 + floor(min(@classes.monk.levels, 10) / 10)`.
    - ZZ Monk 5: Flurry asks for 1 follow-up (2 strikes).
    - Set the monk to level 10, then Review & apply: 2 follow-ups (3 strikes).
    - One Focus Point spent in both cases.
    - The editor's "Strikes per use" shows the formula and saves it unchanged.
12. **Creature picker scrolls** (`creatures.mjs` `pickOnMap` and `pickMany`; the list is capped at about half the
    screen). Put 15+ ZZ tokens near a ZZ Sorcerer, then trigger Silvery Barbs. The "who gets advantage" list scrolls and
    Confirm stays visible. Targeting a creature on the map scrolls its row into view.
13. **Editor:**
   - Open each new patch's effect, reaction and activity editors and save without changes: flags are identical.
   - The new fields render, and their descriptions read correctly.

## Left
- Run the live checks above.
- Not done:
  - "can't bond with a magic weapon someone else is attuned to / another Warlock bonded";
  - 2014 Alert "can't be surprised" (dnd5e has no 2014 surprise);
  - 2014 Fighting Styles taken through Fighting Initiate (TCE): see T-011.

## Log
- 2026-10-03 — Claude (Opus): Flurry of Blows v3: 3 strikes from monk level 10. `repeat.count` accepts a formula.
- 2026-10-03 — Claude (Opus): Sacred Weapon v2, bond `carried`, light on enchantments, Stage enchantment cues and
  the damage type choice added.
- 2026-10-03 — Claude (Opus): engine, editor and Box pieces written. `node --check` and the strip check pass, and
  the packs build. Untested live.
