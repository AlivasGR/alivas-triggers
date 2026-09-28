# T-001 — Prepare automation for the party's future levels

- **Status:** open
- **Foundry:** test (build offline from 5etools + dnd5e data; only the final checks need Foundry)
- **Owner:**
- **Area:** box (engine only where a generic mechanism is missing)

## Goal
Every class / subclass / species / background / feat feature the party will gain at **levels 6–20** has a Box patch
(or is confirmed to need none, or is logged as manual) **before** the characters reach that level, so levelling up
through Plutonium is automated on arrival.

Party builds (all 2024 unless noted; current level 5 except where noted):

| Character | Class / subclass | Species | Background |
|---|---|---|---|
| Asta Stillhand | Monk / Warrior of Mercy (PHB 2024) | Dwarf (PHB 2024) | Physician (GH:PG'24) |
| Kvoth | Rogue / Soulknife (PHB 2024) | Human | Farmer (PHB 2024) |
| Tristan Greymane | Wizard / Evoker (PHB 2024) | Human | Scribe |
| Enigma | Wizard / Bladesinger (FRHoF) | Human | Sage |
| Cyra | Sorcerer / Clockwork Soul (PHB 2024) — confirm level on her sheet | — | — |
| Asha Vandree (NPC ally) | Cleric 3 / Trickery Domain | Elf, Drow lineage | Acolyte |

Species and background features are level-1 and mostly done; the work is class/subclass features, the Epic Boon at
19, and the feats chosen at 8 / 12 / 16 (feats: patch the general-feat list that 5etools marks XPHB, most likely
picks first — the table decides picks).

## Sources
* 5etools `data/class/class-monk.json`, `class-rogue.json`, `class-wizard.json`, `class-sorcerer.json`,
  `class-cleric.json` — `classFeature` / `subclassFeature` entries with `source: "XPHB"`; Bladesinger `source:
  "FRHoF"`. `data/feats.json` (XPHB general feats, Epic Boons). `data/foundry-class-*.json` shows what Plutonium
  already automates natively.
* dnd5e repo `packs/_source/classes24/` (class items with advancement, and the feature items with activities) —
  use as the item-data base for patches; they have the same `system.identifier` Plutonium uses.
* Existing patches in `alivas-box-of-triggers/packs/_source/fixed-items/` (the level ≤5 features) for style.

## Plan
1. Inventory: for each class/subclass list every feature 6–20 (name, level, 5etools source). Put the table in this
   file under **Done** with a column "native / patch / engine gap / manual".
2. Classify each: `native` (dnd5e or Plutonium already does it — e.g. a flat AC or speed change), `patch` (existing
   engine pieces are enough), `engine gap` (needs a new generic mechanism — write it up as its own task, don't block
   on it), `manual` (reference-only, nothing to automate).
3. For each `patch`: build from the dnd5e `classes24` item (or the 5etools entry if dnd5e has none), add engine flags,
   match `{ type, identifier, book: "PHB 2024" }` plus a second key with the dnd5e `compendiumSource`. One file per
   feature; version 1. Strip rules text; `npm run pack` (tests §6 of AGENTS.md).
4. Write the live-test checklist per feature (actor at the level, expected result) in **Left**, status
   `needs-live-test`.
5. Order of work: nearest levels first (6, 7, then 9–11), and the character closest to levelling first.

Expected engine gaps to check early (don't assume — verify against the engine headers): Monk Deflect Energy (L13,
Deflect Attacks against any damage type — likely just a filter change), Self-Restoration (L10, end conditions at
turn end), Rogue Reliable Talent (L7, d20 floor of 10 on proficient checks — probably a new `d20Rolling` outcome),
Elusive (L18, no advantage against you), Soulknife Soul Blades Homing Strikes (L9, add to a missed attack — the
`d20Failed` window already does this for checks; check attacks), Evoker Sculpt Spells / Overchannel, Bladesinger
Song of Defense (reduce damage by expending a slot), Clockwork Soul Trance of Order (L14, rolls below 10 count as
10).

## Acceptance
- [ ] Inventory table complete for all five classes (levels 6–20) (offline)
- [ ] Every `patch` row has a patch file, stripped, packed (offline)
- [ ] Every `engine gap` row has its own task file (offline)
- [ ] Live checks, per feature, on a throwaway actor at that level (live)

## Done
Nothing yet.

## Left
Start with step 1 for Monk and Rogue (Asta, Kvoth), levels 6–11.

## Log
- 2026-09-29 — maintainer: task written.
