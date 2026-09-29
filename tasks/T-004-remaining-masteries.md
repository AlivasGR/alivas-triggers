# T-004 — Weapon masteries Nick, Cleave, Push

- **Status:** open
- **Foundry:** test
- **Owner:**
- **Area:** engine (masteries in `workflow.mjs` / `main.mjs`), editor

## Goal
The engine applies Vex, Sap, Slow, Topple and Graze after an attack (setting `wfMastery`). Add the other three 2024
masteries as generic handlers.

## Sources
5etools `data/items-base.json` → `itemMastery` (source XPHB): Nick, Cleave, Push.

## Plan
* **Push** — on hit, target Large or smaller: offer to push it up to 10 ft straight away (a choice prompt; reuse the
  token-movement helper the Trip / Deflect flows use).
* **Cleave** — melee hit, once per turn: offer a follow-up attack against a second creature within 5 ft of the first
  and within reach; no ability modifier to damage unless negative. Reuse the follow-up attack path (Extra Attack /
  Flurry).
* **Nick** — the Light-property extra attack is part of the Attack action, once per turn. Decide: note only, or an
  action-economy flag. Log the decision.

## Acceptance
- [ ] Handlers + editor option for the activity `mastery` flag (offline, `node --check`)
- [ ] Each mastery tested with a weapon that has it (live)

## Notes
- 2026-09-29: the engine now has `Creatures.pushCreature` (straight line, stops at walls, creatures and the map edge) and a `push` action — use them for Push.

## Log
- 2026-09-29 — maintainer: task written.
