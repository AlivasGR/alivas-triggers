# T-010 — Condition riders on monster attacks

- **Status:** open
- **Foundry:** test
- **Owner:**
- **Area:** box

## Goal
Many monster attacks carry a rider ("Constitution save or Poisoned until the end of its next turn", "save ends")
whose effect is missing or label-only on imported actors. Patch them from the **2025 Monster Manual** (5etools
`data/bestiary/bestiary-xmm.json`) with a rider save activity (the attack workflow runs it on hit) and the effect's
duration / `failUntil`. Priority: demons, then any creature with a save-ends rider.

## Plan
1. Grep XMM actions for `{@actSave` followed by `{@condition`; list creature + action + DC + condition + duration.
2. One patch per feature; add `owner` to the match key where the feature name is generic ("Bite", "Claw").

## Log
- 2026-09-29 — maintainer: task written.
