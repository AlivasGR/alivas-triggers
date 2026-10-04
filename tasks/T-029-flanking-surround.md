# T-029 — Flanking variant "surround" (+1 per flanker, up to PB)

- **Status:** needs-live-test
- **Foundry:** test
- **Owner:**
- **Area:** engine

## Goal
A balanced flanking option that makes surrounding worthwhile and stacks with Advantage. It is modelled on the
"Aardvark's Flanking" module (foundryvtt.com/packages/aardvarks-flanking), built on our factions, vision, reach and
size. The maintainer's rules:
- A creature is flanked when two or more of its opponents wielding melee weapons have it within their melee reach,
  and at least two of them are on opposite sides of it.
- An opponent can't flank a creature it can't see, and can't flank while Incapacitated.
- Melee attacks against a flanked creature get +1 for each opponent flanking it, up to the **attacker's PB** (so the
  minimum when flanked is +2).
- Creature size and elevation count.

## Done
`flanking.mjs`: the setting `flanking` has a new choice, `surround`.
- **Opponent:** the faction relation from the opponent to the target is `enemy`.
- **Wielding a melee weapon:**
  - an equipped weapon item with a melee attack activity counts;
  - natural weapons count even when unequipped;
  - an Unarmed Strike does not.
- **Reach:** the weapon's reach (or 10 ft with the Reach property). The 3D distance is the larger of:
  - the horizontal distance (as Opportunity Attacks measure it);
  - the vertical gap between the token boxes plus one square.

  A token's height is its size in feet.
- **Opposite sides:** the line between two flankers' centres passes through the target's box, inset by ⅕ of a square.
  It's tested twice:
  - seen from above (so two flyers hovering on both sides still flank);
  - in 3D (one above, one below).

  On a Medium target this equals the DMG's opposite sides or corners. Pure helpers: `segmentThroughBox`,
  `oppositeSides`; Node checks pass. It works on any grid, including gridless.
- **Bonus:** the number of threatening opponents, capped at the attacker's PB. The attacker must be an opponent of the
  target. It's added as a roll part, with " (flanked: +N)" in the flavor, and applied only when exactly one target is
  selected.

## Acceptance (live)
In zz-stage-test, with setting `flanking` = `surround` and a Medium Hostile target T:
- [ ] Two PCs on W and E of T, each with a melee weapon equipped:
  - each one's melee attack gets +2;
  - the flavor reads "(flanked: +2)".
- [ ] They stand N and SE: no bonus.
- [ ] Two PCs on W and E, plus a third on N, with PB ≥ 3: +3. With PB 2: +2.
- [ ] The W PC holds only an Unarmed Strike (weapon unequipped): no flanking, since only one flanker is left.
- [ ] The W PC is Incapacitated, or can't see T: no flanking.
- [ ] A reach weapon two squares W of T, plus a PC adjacent E: flanked.
- [ ] Elevation:
  - W PC at elevation 15 (out of reach): no flanking;
  - both PCs at elevation 5, W and E: flanked.
- [ ] A Large target (2×2) with PCs straight across (N of its left column, S of its left column): flanked.
- [ ] A ranged attack: no bonus.
- [ ] Advantage from another source still applies with the bonus.
- [ ] The setting set back to advantage / plus2 behaves as before.

## Log
- 2026-10-04 — Claude (Opus): built; geometry unit-checked in Node; untested live.
