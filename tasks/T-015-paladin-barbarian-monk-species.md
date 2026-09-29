# T-015 — Aasimar, Lizardfolk, Paladin / Barbarian (Wild Magic) / Monk (Astral Self) to level 3

- **Status:** needs-live-test (most verified live; a few items below not yet)
- **Foundry:** test
- **Owner:** maintainer
- **Area:** engine, editor, box

## Goal
Automate, for characters that don't exist yet: Aasimar (PHB 2024), Lizardfolk (MPMM — newest printing), Paladin 1–3
(Devotion, Vengeance, every Fighting Style, every level-1 Paladin spell and both oath spell lists, Blessed Warrior's
Cleric cantrips), Barbarian 1–3 (Path of Wild Magic, TCE), Monk 1–3 (Way of the Astral Self, TCE; Mercy was done
earlier).

## Sources
5etools `races.json` (Aasimar XPHB, Lizardfolk MPMM), `class/class-{paladin,barbarian,monk}.json` (XPHB features;
Wild Magic and Astral Self are TCE subclasses 5etools marks as usable with the XPHB classes), `feats.json` (XPHB
fighting styles), `spells/spells-xphb.json` + `generated/gendata-spell-source-lookup.json` (class lists). Item data:
Plutonium's own imports of those entries (what users get), so match keys fit.

## Done
Engine (generic, each with editor UI and sheet sentences):
- Trigger `oncePerTurn`; filter data `bearerTurn`, `subjectIsAlly`, `subjectIsEnemy` (hit events now know the attacker).
- Activity flag `onHit` (attack steps after hits settle); `chooseEffects` also works for save activities.
- Actions `random` (roll on a table → give that row's effect), `teleport`, `push`, `sense`; save DC as a formula (editor).
- Effect rules `reduceDamage`, `damageDice` (minimum die), `attackedWith.by: "source"` / `.attacker` filter,
  `attacksWith.unlessTarget`, `light` (while the effect lasts), `noSpells` (+ ends concentration), `sustain`.
- Selectors: side `notAlly`, `targets` filtered by side, `by: "source"`.
- Areas: when an effect's area ends, creatures inside get "areaLeave" (their while-inside effects end).
- removeStatus ends custom statuses (effects carrying them); tokenFor finds tokens on any scene (lead GM elsewhere).
- Attack workflow passes the attack mode to damage (versatile two-handed, Dueling); damage-die rewrites keep
  `@ruleBonus` (it was being added twice).

Box: 36 new patches (see `git log`), plus existing Focus/Psionic-pool patches now use `identifier:` targets (the Box
resolves them per actor) — they pointed at one character's item before.

Verified live (headless server, throwaway ZZ actors): Rage (upkeep, ends on Incapacitated, no spells/concentration,
Str damage rule, resistances), Reckless Attack, Danger Sense, Primal Knowledge, Great Weapon Fighting, Natural Armor
(AC 15), Wild Surge results 1, 2, 3, 5, 6, 7, 8 (4 posts dnd5e's enchant card), Magic Awareness/Detect Magic, Hungry
Jaws, Celestial Revelation (all three forms, once-per-turn damage), Divine Sense, Sacred Weapon light, Vow of Enmity
(advantage for the paladin only; moves on 0 HP), Paladin's Smite, Dueling, Defense (AC 17 in chain mail), Interception,
Protection, Searing / Thunderous (push + Prone) / Wrathful Smite, Command (pick the order after a failed save),
Compelled Duel, Hunter's Mark, Heroism, Protection from Evil and Good, Resistance, Lay on Hands (Remove Poison), Step of
the Wind (Focus from the identifier pool), Arms of the Astral Self (save, Wis stand-in, reach-10 force strike).

## Left
- Live: Wild Surge 4 (enchant a weapon from the card), Guidance (pick one skill), Bite, Two-Weapon / Thrown Weapon
  Fighting (need an off-hand / thrown attack), Patient Defense and Deflect Attacks with the identifier pool on a real
  Plutonium-imported monk, Detect Evil and Good.
- Known limits: Natural Armor shows dnd5e's "Draconic Resilience" label and doesn't apply over worse armor; Divine Sense
  can't see consecrated places; Magic Awareness lists items carried by creatures and spells on them/areas, not loose
  items; Wild Surge's infused weapon lasts 10 minutes, not "until the Rage ends"; Searing Smite's burn is 1d6 even
  when upcast.
- SRD copies (T-003) of these features are not matched yet.

## Log
- 2026-09-29 — maintainer/Claude: built and tested the above; found and fixed the pool-ID bug in older monk/rogue
  patches, the doubled rules bonus on rewritten damage, and the lead-GM-on-another-scene token lookup.
