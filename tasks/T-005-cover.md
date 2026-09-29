# T-005 — Cover as an effect rule

- **Status:** open
- **Foundry:** test
- **Owner:**
- **Area:** engine (effect rule), editor, box (Keywand of the Stars)

## Goal
A generic effect rule `cover: "half" | "threeQuarters"`: +2 / +5 to the bearer's AC and Dexterity saves (2024 rules
glossary, "Cover" — 5etools `data/variantrules.json`). First user: Keywand of the Stars (homebrew; grants half cover).
Check first whether dnd5e 6 has a cover status or rule (`CONFIG.DND5E`, the system's cover statuses) and reuse it.

## Notes
- dnd5e 6 already adds a cover bonus to AC (`ac.cover`, from `actor.coverBonus`); look at how it is set before building anything.

## Acceptance
- [ ] Rule implemented, reachable and described in the editor (offline)
- [ ] Keywand patch version bumped (offline)
- [ ] AC and Dex save bonus observed on an actor with the effect (live)

## Log
- 2026-09-29 — maintainer: task written.
