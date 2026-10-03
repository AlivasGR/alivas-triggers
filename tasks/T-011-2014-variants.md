# T-011 — 2014 variants of patched items

- **Status:** open
- **Foundry:** test
- **Owner:**
- **Area:** box

## Goal
Tables using 2014 items (Plutonium PHB 2014, dnd5e `spells` / `classes` packs) get no automation. Build **separate**
2014 patches — a 2024 patch must never match a 2014 item. Source: 5etools entries with `source: "PHB"` / `"MM"`.
Start with the most-used spells (Shield, Counterspell, Fireball, Healing Word) and class features whose rules differ
between editions (e.g. Stunning Strike).

## Log
- 2026-09-29 — maintainer: task written.
- 2026-10-03 — Claude (Opus): add the 2014 Fighting Styles a character gets through Tasha's Fighting Initiate (Plutonium book label `TCoE`; styles from PHB 2014). Archery and Defense are probably covered by dnd5e or Plutonium already. 2014 Great Weapon Fighting differs from 2024 (reroll 1s and 2s), and 2014 Protection requires a shield. Unarmed Fighting (TCE) is the same as the 2024 patch, so add a `TCoE` match key. Match keys need a real 2014 import to confirm (name `Fighting Style: X` vs `X`, identifier).
