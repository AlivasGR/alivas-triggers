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
  - an Unarmed Strike counts too (maintainer, 2026-10-04: it is a melee weapon).
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

- **Ranged option** (setting `flankingRanged`, on by default, only with surround; maintainer's rule, 2026-10-04):
  - ranged weapon attacks, thrown weapons and spell attacks against a flanked creature get the bonus too;
  - ranged attackers add +1 each: a creature that attacked a target at range during its turn adds to that target's
    bonus from the end of that turn until the end of its next turn, and keeps adding while it attacks at range again
    each turn;
  - they add only while they can see the target, aren't Incapacitated and are its opponents;
  - the target must still be flanked by two melee opponents on opposite sides; ranged attackers only add to the bonus.

  State lives on the attacker's token flag `rangedFlank` { pending, active }:
  - `dnd5e.rollAttackV2` on the owner's client fills `pending` (in combat only);
  - `combatTurnChange` on the lead GM moves pending to active at the end of that combatant's turn;
  - `deleteCombat` clears it.

## Acceptance (live)
In zz-stage-test, with setting `flanking` = `surround` and a Medium Hostile target T:
- [x] Two PCs on W and E of T, each with a melee weapon equipped:
  - each one's melee attack gets +2;
  - the flavor reads "(flanked: +2)".
- [x] They stand N and SE: no bonus.
- [x] Two PCs on W and E, plus a third on N, with PB ≥ 3: +3. With PB 2: +2.
- [x] The W PC has no melee weapon item at all (weapon unequipped, no Unarmed Strike item): no flanking.
- [ ] The W PC with only an Unarmed Strike item: flanks (changed after the live run; not yet run live).
- [x] The W PC is Incapacitated, or can't see T: no flanking.
- [x] A reach weapon two squares W of T, plus a PC adjacent E: flanked.
- [x] Elevation:
  - W PC at elevation 15 (out of reach): no flanking;
  - both PCs at elevation 5, W and E: flanked.
- [x] A Large target (2×2) with PCs straight across (N of its left column, S of its left column): flanked.
- [x] A ranged attack: no bonus.
- [x] Advantage from another source still applies with the bonus.
- [x] The setting set back to advantage / plus2 behaves as before.
- [ ] Ranged option (combat running; T flanked by melee PCs on W and E; archer R 30 ft away, PB 3+ on the attackers):
  - R's longbow attack on T gets "(flanked: +2)" (it is not adding yet), and a ranged spell attack gets it too;
  - after R's turn ends, R's token has `rangedFlank.active` = [T]; a melee attack on T now gets +3;
  - on R's next turn R attacks someone else; after it ends, R no longer adds (+2 again);
  - R attacks T on two turns running: it keeps adding;
  - R Incapacitated, or unable to see T: it doesn't add;
  - with only one melee flanker plus R: no bonus (not flanked);
  - with `flankingRanged` off: ranged attacks get nothing, as before;
  - deleting the combat clears `rangedFlank`.

## Log
- 2026-10-04 — Claude (Opus): built; geometry unit-checked in Node; untested live.
- 2026-10-04 — Claude (Sonnet): live test in zz-stage-test, all checklist items pass. Pure flankersOf/surroundBonus for every layout (W+E +2, N+SE none, three flankers PB3 +3 / PB2 +2, unequipped and Incapacitated none, Glaive two squares away flanks, elevation 15 none and 5+5 flanked, Large target flanked, wall-blocked sight none); real attack rolls through the harness show formula "1d20 + 2 + 0 + 3" with flavor "(flanked: +2)" / "(flanked: +3)", ranged Longbow gets nothing, an Advantage from another hook gives 2d20adv plus the bonus, and advantage / plus2 modes behave as before.
- 2026-10-04 — Claude (Opus): Unarmed Strikes now count as melee weapons for surround flanking, per the maintainer. Checked only with `node --check`.
- 2026-10-04 — Claude (Opus): ranged option `flankingRanged` added; untested live.
