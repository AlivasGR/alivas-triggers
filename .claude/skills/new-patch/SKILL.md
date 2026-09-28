---
name: new-patch
description: Automate one spell, feature, item or monster ability as a Box patch (works without Foundry). Use when asked to automate / patch / fix a specific item.
---

# New patch

Works fully offline; only the final check needs Foundry. Read AGENTS.md §4–§5 first if you haven't.

1. **Rules.** Find the entry on 5etools (raw JSON in `5etools-mirror-3/5etools-src/data/`). Note source + page. Only
   look elsewhere if 5etools doesn't have it; say where in the task log.
2. **Base item.** In order of preference: the dnd5e repo `packs/_source/<pack>24/` item with the same
   `system.identifier`; an item exported from a world (if Foundry is available); an existing patch to extend.
3. **Native first.** List what dnd5e / Plutonium already does for this item (activities, effects, advancement). Only
   automate the rest.
4. **Map to engine pieces.** For each rules sentence pick: trigger (event + action), effect rule, activity flag, or
   reaction (window + outcome). Grep the headers of `main.mjs` / `reactions.mjs` / `workflow.mjs` / `areas.mjs` for
   the field before assuming it's missing.
5. **Gap?** If a sentence needs a mechanism that doesn't exist, design it generically (named for what it does, not the
   spell), add it to the Engine and the editor, `node --check`. If that's too big, write a task and patch the rest.
6. **Write the patch** in `alivas-box-of-triggers/packs/_source/fixed-items/<identifier>-<book>.json`:
   unique 16-char `_id`; `flags["alivas-box-of-triggers"] = { version, match }`; `_key`s for the item and effects;
   uses spent 0; no foreign module flags. Match keys per AGENTS.md §5 — a 2024 patch never matches a 2014 copy.
   Changing an existing patch → bump `version`.
7. `npm run strip-rules-text` then `node scripts/strip-rules-text.cjs --check`; `npm run pack` (Foundry closed).
8. **Test** with the `live-test` skill, or, without Foundry, the `handoff` skill (status `needs-live-test`, exact steps
   and expected numbers).
