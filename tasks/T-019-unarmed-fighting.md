# T-019 — Unarmed Fighting (2024 Fighting Style): damage swap and grapple damage

- **Status:** done
- **Foundry:** test
- **Owner:**
- **Area:** engine, editor, box

## Goal
The 2024 Unarmed Fighting feat works on the character's own Unarmed Strike (the Box's patched one, with Grapple and
Shove). Its damage becomes 1d6 + Str, or 1d8 + Str when no weapon or Shield is held, and only when that beats the
strike's own damage (a Monk's Martial Arts die may be higher). At the start of each of the bearer's turns, it may deal
1d4 Bludgeoning to one creature it is grappling.

## Sources
- 5etools `feats.json`, "Unarmed Fighting" (XPHB p. 210, category FS).
- Plutonium (`foundry-feats.json`) gives the feat three activities of its own: two separate attacks and a manual damage
  roll. Those bypass the Unarmed Strike item. The patch replaces them, because applying a patch replaces activities.
- Not in dnd5e's SRD 2024 compendia.

## Plan
Two new generic engine pieces, both added to the editor:
1. Effect rule `baseDamage: [{ formula, filter, type }]` (`main.mjs`, a `dnd5e.preRollDamageV2` hook). On a matching
   attack, the base damage part (the weapon's die and its `@mod`) is replaced by `formula`, but only when the average is
   higher. The first entry whose filter passes is used. Filter data is the damage roll data plus
   `held: { weapons, shield }`.
2. Selector option `grappledBy: true` (`creatures.mjs` `findCreatures`): keeps only creatures carrying a tether whose
   `source` is the chooser's token. That tether is the Box Unarmed Strike's Grapple.

Patch `unarmed-fighting-phb-2024.json` v1: one transfer effect.
- `baseDamage`: the 1d8 line (unarmed, `held.weapons` 0, `held.shield` false), then the 1d6 line (unarmed).
- Trigger: `turnStart` → `damage` 1d4 bludgeoning to `{ who: "choose", grappledBy: true, self: false }`. The picker
  offers "no one", which covers "you can". There's no prompt when nobody is grappled.

## Acceptance
- [x] `node --check` on main.mjs, creatures.mjs, editor.mjs (offline)
- [x] strip-rules-text check; `npm run pack` (offline)
- [x] Fighter level 1, Str 16 (+3), with Unarmed Fighting patched (Review & apply), and a 2024 Unarmed Strike (Box
      patched).
      - Nothing equipped: Unarmed Strike damage reads `1d8 + 3` bludgeoning.
      - Longsword equipped: `1d6 + 3`.
      - Shield equipped, no weapon: `1d6 + 3`.
      - A critical hit doubles the d8. (live 2026-10-03)
- [x] Monk level 5 (Martial Arts d8, Dex 18 +4, Str 10 +0), empty hands: the Monk's own `1d8 + 4` stays, because the
      replacement's average is lower. (live)
- [x] Grapple a ZZ creature with the Unarmed Strike's Grapple, then start the bearer's turn in combat. A creature picker
      offers the grappled creature (and no one else). Picking it deals 1d4 bludgeoning. Choosing nobody deals nothing.
      With nobody grappled there is no prompt and no chat line. (live 2026-10-03)
- [x] Editor: the effect's Effect rules → Damage group shows both lines ("Unarmed Strikes, holding no weapon or shield"
      / "Unarmed Strikes"). Saving without changes keeps the flags identical. The trigger's selector shows "Only creatures
      the bearer is grappling", and the summary reads "… that the bearer is grappling". (live 2026-10-03: both lines and the grappledBy box render, the summary reads "... that the bearer is grappling", saving unchanged keeps the effect flags identical)

## Done
- Engine: `baseDamage` rule plus `heldItems` / `averageOf` helpers (`main.mjs`); `grappledBy` selector
  (`creatures.mjs`, plus `describeSelector`).
- Editor: `baseDamage` rows with filter presets, a damage type and a custom filter; an empty row adds another line.
  `grappledBy` checkbox in the selector block; sheet summary line.
- Box: `unarmed-fighting-phb-2024.json` v1 (`_id` hfKX9Ey48FFli97N).

## Left
Nothing; every acceptance item passed live (2026-10-03).

Assumption verified: the base damage roll is replaced as expected (1d8 / 1d6 lines, crit doubles the die).

## Log
- 2026-10-03 — Claude (Opus): engine pieces, editor, and patch written. Offline checks pass; untested live.
- 2026-10-03 — Sonnet live test: damage swap and grapple picker PASS; editor round-trip NOT RUN. Fighter Str 16: empty hands 1d8 + 3, longsword 1d6 + 3, shield only 1d6 + 3, crit 2d8 + 3. Monk (class level 5, Dex 18, Martial Arts formula put on the strike by hand because the dump's Unarmed Strike doesn't carry the Martial Arts enchantment): kept 1d8 + 4. Grapple then turnStart: picker listed only the grappled creature plus "No one"; picking it dealt 1d4, "No one" dealt nothing, nobody grappled gave no prompt and no message.
- 2026-10-03 — Sonnet live test (retest): editor round-trip PASS. Effect editor of the patched Unarmed Fighting shows the two base-damage lines (1d8 + @abilities.str.mod bludgeoning, "Unarmed Strikes, holding no weapon or shield"; 1d6 + @abilities.str.mod, "Unarmed Strikes"), the trigger's "Only creatures the bearer is grappling" box is checked and the summary reads "... that the bearer is grappling". Save without changes: effect flags JSON identical. Status set to done.
