---
name: character-pass
description: Automate everything on one character sheet (or one class/subclass at given levels). Use when asked to do a "pass" on a character or to prepare a class for upcoming levels.
---

# Character pass

1. **Inventory.** List every item: class features, subclass features, species, background, feats, spells, equipment,
   and (for a level range) features not yet gained — from 5etools class JSON. Without Foundry, build the list from
   5etools + dnd5e `classes24`; with Foundry, also dump the actor's items.
2. **Classify each** in a table in the task file: `native` / `patched already` / `patch` / `engine gap` / `manual`,
   with the one-line reason.
3. **Look for player workarounds** on the actor (hand-made effects, macros) that duplicate what a patch now does;
   list them for removal (removal needs Foundry — or a task).
4. **Build** each `patch` with the `new-patch` skill. Features any other character of the class would also get go in
   the Box keyed by identifier, never by owner.
5. **Engine gaps** — solve generically, or one task each.
6. **Test** with `live-test` (one throwaway actor at the right level covers most of the pass) or hand off.
7. **Wrap up** — task file updated; README/CHANGELOG-worthy changes listed for the maintainer's release notes.
