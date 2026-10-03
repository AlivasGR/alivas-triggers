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
1. **Unseen attacks.** PASS (live 2026-10-03)
   - An Invisible ZZ Fighter attacks a ZZ Goblin that has no special senses: advantage.
   - The Goblin attacks the Fighter: disadvantage.
   - Give the Goblin Blindsight 10 ft, adjacent: neither applies.
   - Turn the setting off: nothing applies.
2. **2014 Alert** PASS (live 2026-10-03; retest: Plutonium PHB 2014 import, book "PHB'14", auto-patched to v2, init total = Dex 2 + 5 = 7, no proficiency; earlier run: legacy and modern, no unseen advantage) (import a PHB 2014 Alert with Plutonium; confirm the match): initiative +5 in both legacy and modern
   worlds, with no proficiency-based bonus. An Invisible attacker gets no advantage against the Alert creature.
3. **2024 Alert, SRD copy** PASS (live 2026-10-03) (dragged from dnd5e's feats compendium): Review & apply offers it, and Initiative Swap
   works.
4. **Pact of the Blade** PASS (live 2026-10-03; retest: conjured Longsword has the Spellcasting Attack, 1d20 + 3 (Cha) + 3 (prof); the Forge path (owned dagger) too; a single game.time.advance(60) ends the distance bond, dagger stays; Dead ends the bond and removes the conjured weapon; see Left 8 for server-log noise) (ZZ Warlock 5 / Wizard 3, Cha 16, Int 18):
   - **Conjure:** pick Longsword. It appears named "…, Pact Weapon", proficient, with the Spellcasting Attack, which
     uses **Cha** (+3), not Int.
   - **Bond a second weapon** (Forge on a dagger): the conjured longsword disappears and the bond chat line appears.
   - **Distance:** give the dagger to another ZZ token 10 ft away, then advance game time 1 minute. The bond ends; the
     dagger stays (it wasn't conjured).
   - **Death:** conjure again, then give the Warlock the Dead status. The bond ends and the weapon disappears.
5. **Thirsting Blade:** PASS (live 2026-10-03)
   - Attack with the pact weapon (Attack action): one follow-up attack is offered, with the pact weapon only.
   - Attack with a non-pact weapon: no follow-up.
6. **Eldritch Smite:** PASS (live 2026-10-03: 4d8, 8d8 on a crit, Pact slot spent, Prone, Gargantuan, once per turn)
   - Hit with the pact weapon and pick Eldritch Smite with a level 3 Pact slot: +4d8 force, doubled on a crit, and one
     Pact slot spent.
   - The "Knock the target Prone?" question appears; Yes gives Prone.
   - Against a Gargantuan target: no Prone question.
   - Once per turn.
7. **Lifedrinker:** PASS (live 2026-10-03: 1d6, HD d8 spent and HP +9, once per turn)
   - Hit with the pact weapon, pick Lifedrinker (Psychic): +1d6 psychic.
   - "Spend a Hit Point Die…?" Yes: the largest Hit Point Die is spent and HP restored.
   - Once per turn across the three options.
8. **Misty Step** PASS (live 2026-10-03; Plutonium import auto-patched; placement click stubbed) (Plutonium copy, after Review & apply): casting it asks for a spot within 30 ft and teleports.
9. **Sacred Weapon** PASS (live 2026-10-03; retest on the dnd5e SRD copy: use spends the SRD Channel Divinity (2->1), +3 attack, light 20/40; a second Sacred Weapon removes the first and the light stays; deleting the enchantment turns the light off (0/0); handing the weapon over ends the bond and both tokens are dark; Review & apply plan() lists the SRD copy as outdated when its version flag is lowered) (ZZ Paladin 3 Devotion, Cha 16):
   - Use it on a longsword: attacks get +3 and the token sheds 20/40 ft light with the yellow loop. A hit asks
     Slashing or Radiant.
   - Use it on a second weapon: the first loses it, and the light stays (from the second).
   - Hand the weapon to another ZZ token: the bond ends, and the light and the loop stop.
   - The Channel Divinity use is spent.
10. **Damage type choice:** PASS (live 2026-10-03; retest: Pact Weapon answer Radiant -> roll type radiant, no damage to a radiant-immune target; answer Necrotic -> 7 necrotic, HP 195->188; Sacred Weapon Radiant -> 10 radiant, immune target unharmed, Slashing -> 4 slashing, HP 182->178; Graze with a multi-type weapon not run: by code graze uses the first damage type and does not ask) a Pact Weapon hit asks Slashing / Necrotic / Psychic / Radiant, and the roll uses the
    answer. Turn the setting off: no question; dnd5e uses its last choice.
11. **Flurry of Blows v3** PASS (live 2026-10-03: 2 strikes at level 5, 3 at level 10, 1 Focus Point each time) (Heightened Focus). Activity flag `repeat.count` may be a formula (`workflow.mjs`
    `strikeCount`). The patch uses `2 + floor(min(@classes.monk.levels, 10) / 10)`.
    - ZZ Monk 5: Flurry asks for 1 follow-up (2 strikes).
    - Set the monk to level 10, then Review & apply: 2 follow-ups (3 strikes).
    - One Focus Point spent in both cases.
    - The editor's "Strikes per use" shows the formula and saves it unchanged.
12. **Creature picker scrolls** PASS (live 2026-10-03: 21 rows, list 440 px, Confirm visible; map target scrolls its row in) (`creatures.mjs` `pickOnMap` and `pickMany`; the list is capped at about half the
    screen). Put 15+ ZZ tokens near a ZZ Sorcerer, then trigger Silvery Barbs. The "who gets advantage" list scrolls and
    Confirm stays visible. Targeting a creature on the map scrolls its row into view.
13. **Editor:** PASS with notes (live 2026-10-03: all new patch editors open and save; only Eldritch Smite drops `configure:false`, Sacred Weapon gains `bond.range: 5`)
   - Open each new patch's effect, reaction and activity editors and save without changes: flags are identical.
   - The new fields render, and their descriptions read correctly.

## Left
Retest 2026-10-03 (Sonnet): the earlier failures 1-7 are fixed (2014 Alert book label, conjured rider, Cha vs Int, damage type answer, Sacred Weapon light, SRD Sacred Weapon / Channel Divinity pool, bond away in one tick). Remaining:
1. **Server log noise when a conjured weapon's bond ends** (replaces the old double delete, which is gone): the log shows `undefined id [<item id>] does not exist in the EmbeddedCollection collection.` twice and `Cannot read properties of undefined (reading 'length')` from server-backend. Traced to dnd5e itself: `ActiveEffect5e#_onDeleteOperation` (dnd5e.mjs ~8202) sends one `modifyBatch` with an Item update (`system.activities.<rider id>: ForcedDeletion`) and the Item delete of the dependent conjured weapon; the update targets the item deleted in the same batch. The weapon is removed correctly; no Alivas frame in the stack. Harmless; could be avoided by deleting the conjured item first.
2. Editor drift: saving Eldritch Smite's reactions drops `configure:false`; saving Sacred Weapon's effect adds `bond.range: 5` (not retested).
3. Console noise: toggling the Invisible status logged `Failed data preparation ... reading 'filters'` (dnd5e, no Alivas frame; not retested).
Not run: player-client console check, Graze with a multi-type weapon.
- Not done:
  - "can't bond with a magic weapon someone else is attuned to / another Warlock bonded";
  - 2014 Alert "can't be surprised" (dnd5e has no 2014 surprise);
  - 2014 Fighting Styles taken through Fighting Initiate (TCE): see T-011.

## Log
- 2026-10-03 — Sonnet live test: local sandbox, Foundry v14 / dnd5e 6.0.5 with Plutonium. Unseen attacks, Alert 2024 SRD + Initiative Swap, Thirsting Blade, Eldritch Smite, Lifedrinker, Misty Step, Flurry v3, picker scroll and editor round-trips pass. Failures: 2014 Alert book label, conjured weapon rider, Cha vs Int, damage type answer ignored, Sacred Weapon light not ending (details in Left). Test actors, scene and combat deleted; settings restored.
- 2026-10-03 — Claude (Opus): Flurry of Blows v3: 3 strikes from monk level 10. `repeat.count` accepts a formula.
- 2026-10-03 — Claude (Opus): Sacred Weapon v2, bond `carried`, light on enchantments, Stage enchantment cues and
  the damage type choice added.
- 2026-10-03 — Claude (Opus): engine, editor and Box pieces written. `node --check` and the strip check pass, and
  the packs build. Untested live.
- 2026-10-03 — Sonnet live retest (local sandbox, Foundry v14 / dnd5e 6.0.5 / Plutonium): items 2, 4, 9, 10 now pass (details in Acceptance). Divine Sense v2 and Vow of Enmity v2 spend a use from a `channel-divinity` pool (2->1->0) and from the SRD `channel-divinity-paladin` pool (2->1->0). Remaining: Left 1-3 (server-log noise from dnd5e, editor drift, Invisible console noise), so status stays needs-live-test. Test actors, scene and combat deleted; world time restored.
