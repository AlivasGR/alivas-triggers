# T-007 — Deflect Attacks: redirect keeps the attack's damage type

- **Status:** open
- **Foundry:** test
- **Owner:**
- **Area:** engine (reaction `after` data), box (Deflect Attacks patch)

## Goal
2024 Monk Deflect Attacks: the redirected strike deals the same damage type as the attack it deflected. The patch
uses a fixed type. Pass the incoming damage type from the `damageIncoming` window to the `after` useActivity (e.g. a
roll-data value such as `@reaction.damageType` usable in the damage part). Generic: any reaction that reuses the
triggering damage type benefits.

## Acceptance
- [ ] Damage type available to `after` activities (offline)
- [ ] Deflect a slashing hit → the redirect deals slashing (live)

## Log
- 2026-09-29 — maintainer: task written.
