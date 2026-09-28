# T-003 — Match dnd5e SRD 2024 copies of every patched item

- **Status:** open
- **Foundry:** test
- **Owner:**
- **Area:** box

## Goal
Most patches match Plutonium imports (`book: "PHB 2024"`). Users who take items from dnd5e's own SRD 2024 compendia
(`classes24`, `spells24`, `feats24`, `origins24`, `equipment24`) should get the same patch. Known example: the SRD
"Monk's Focus" item.

## Plan
1. For each file in `alivas-box-of-triggers/packs/_source/fixed-items/`, find the SRD counterpart in the dnd5e repo
   `packs/_source/<pack>/` (same `system.identifier`). Record its `_id`.
2. Add a second match key `{ type, identifier, compendiumSource: "Compendium.dnd5e.<pack>.Item.<_id>" }` and bump
   the patch `version`.
3. Engine flags that reference activity ids keep working (patches replace activities wholesale) — confirm per patch.

## Acceptance
- [ ] Table patch → SRD id in **Done** (offline)
- [ ] Keys added, versions bumped, stripped, packed (offline)
- [ ] One SRD item per pack dropped onto an actor and auto-patched (live)

## Done
## Left
Start with the Monk and Rogue features (`classes24`).

## Log
- 2026-09-29 — maintainer: task written.
