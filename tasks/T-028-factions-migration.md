# T-028 — Factions: keep existing worlds' sides on first load (migration)

- **Status:** needs-live-test
- **Foundry:** test
- **Owner:**
- **Area:** engine

## Goal
In 0.12.0, the first GM load stamped every pre-existing NPC token without a letter as B, which is hostile to the
party, and rewrote dispositions to match. Friendly and Neutral NPCs on existing scenes would therefore turn Hostile.
Found right after release, before any world updated.

## Done
`factions.mjs` `migrateExisting()`: a one-time step, gated by the world setting `factionsMigrated`, run by the lead GM
before the startup sync, and also when the `factions` setting is switched on.
- Creature tokens that have no faction flag get their letter from their **current** disposition:
  - player-owned → the party letter;
  - Friendly → the party letter;
  - Hostile → B;
  - Neutral or Secret → **N** (neutral to everyone by default).
- New tokens still follow the spec's defaults (NPC → B).

## Acceptance (live)
- [ ] In zz-stage-test, prepare a scene with tokens that have no faction flag:
  - remove `flags.alivas-engine-of-triggers.faction` from its tokens;
  - delete the stored `factionsMigrated`;
  - include a Friendly NPC, a Hostile NPC, a Neutral NPC, a Secret NPC and a PC.

  Reload the GM:
  - letters become A, B, N, N, A;
  - no token's disposition changes (Friendly stays Friendly, Neutral stays Neutral, Secret stays Secret);
  - `factionsMigrated` is true.
- [ ] Reload again: nothing is re-stamped (change one letter by hand first; it stays).
- [ ] Turn factions off, then remove one token's flag, then turn factions on: that token is migrated without a reload.
- [ ] A new NPC token placed afterwards gets B (hostile).

## Log
- 2026-10-04 — Claude (Opus): written after the 0.12.0 release; untested live.
