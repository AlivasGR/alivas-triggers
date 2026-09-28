# T-014 — Items whose attack spends uses they don't have

- **Status:** open
- **Foundry:** test
- **Owner:**
- **Area:** box

## Goal
Some imported items (Dagger, Rope, Hooded Lantern) have an activity whose consumption targets item uses that are
empty, so using the item is refused. Find the pattern (likely an `itemUses` consumption target with no `uses.max`
from an import), and fix it with a patch matching the affected source — or report it upstream if it's an importer
bug. Correct item data: 5etools `items-base.json` / dnd5e `equipment24`.

## Acceptance
- [ ] Cause identified and written in the log (offline if reproducible from item JSON)
- [ ] Dagger attack usable after the fix (live)

## Log
- 2026-09-29 — maintainer: task written.
