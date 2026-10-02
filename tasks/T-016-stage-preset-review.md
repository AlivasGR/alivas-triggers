# T-016 — Visual review of the Stage's presets (Box items and conditions)

- **Status:** needs-live-test
- **Foundry:** yes
- **Owner:**
- **Area:** stage (presets)

## Goal
Every Box item and condition preset in `alivas-stage-of-triggers/presets/` looks right in play: correct theme and colour,
sensible size, aimed correctly, loops that don't hide the token, sounds that fit and aren't too loud. The presets were
authored offline from path names (no one had seen the animations).

## Sources
- `presets/box.json` (97 items), `presets/statuses.json` (29 conditions).
- Report per item, with the reason for each choice: `private/work/anim/box-presets-report.md` (maintainer only); the
  presets themselves are self-explanatory.
- JB2A / PSFX through Sequencer's database viewer (Sequencer layer → Show Sequencer Database).

## Plan
1. Throwaway scene, two tokens (`ZZ Caster`, `ZZ Target`). Select one, target the other.
2. For each preset: `game.modules.get("alivas-stage-of-triggers").api.previewCue(cue)`. Or open the item's **Animations**
   window and press ▶ on each row.
3. Fix in the item's Animations window (that makes a copy on the item), then port the change into `presets/box.json`.
   Re-check every path is valid: each must be a prefix of an entry in `Sequencer.Database.flattenedEntries`.
4. Worth a closer look:
   - `scale: 12` sensing rings (Detect Magic, Detect Evil and Good, Divine Sense);
   - `melee_generic` / `melee_attack` files used as `melee` steps;
   - aura sizes on area effects (Flaming Sphere, Wild Surge Flowers / Protective Lights, Festering Aura);
   - Chromatic Orb (rainbow bolt);
   - Resistance and Proto-Abjuration tints.

## Acceptance
- [ ] Every Box preset previewed; fixes ported to `presets/box.json` (live)
- [ ] Every condition preset previewed: start, active (the loop doesn't hide the token), end (live)
- [ ] One full flow each: an attack with a miss, a save spell with an area, a buff with an active loop, a Wild Surge
      teleport (live)

## Done
- Presets written; all 331 steps validated against the installed JB2A Patreon + free PSFX database (offline).
- Live: Toll the Dead preset played on cast and Automated Animations stood down; persistent effect loops start and end;
  projectile → impact chains play.

## Left
Steps 1–4 above.

## Log
- 2026-10-02 — Presets authored offline and validated (paths, kinds, names). Live: three flows checked.
