# T-006 — Patch generators as public, rerunnable scripts

- **Status:** open
- **Foundry:** no
- **Owner:**
- **Area:** tooling

## Goal
Patches are built by one-off scripts from private world dumps. Contributors need a public way to (re)generate a patch
from **public** data — the dnd5e repo `packs/_source` item, or a 5etools entry — plus a small declarative spec
(engine flags, match keys, version).

## Plan
1. `scripts/patch/lib.cjs` with the shared `finish()` step: drop folder / ownership / foreign module flags
   (midi-qol, dae, tidy5e…), reset uses spent / attuned / equipped, set Box flags `{ version, match }`, set `_key`s for
   the item and its effects, clear `_stats` source fields.
2. Source loader: read a local checkout of `foundryvtt/dnd5e` `packs/_source` by pack + identifier (path from an env
   var; no hard-coded paths).
3. One spec file per class / spell group in `scripts/patch/specs/`. `npm run patches` rebuilds them all, then runs
   strip-rules-text.
4. Port existing patches gradually. A ported patch must diff clean (or the diff is explained in the log).

## Acceptance
- [ ] Helper + loader + one ported class (Monk) with a clean diff (offline)

## Log
- 2026-09-29 — maintainer: task written.
