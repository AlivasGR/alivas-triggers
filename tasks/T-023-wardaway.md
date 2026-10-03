# T-023 — Wardaway (FRHoF p. 147)

- **Status:** done
- **Foundry:** test
- **Owner:**
- **Area:** engine, editor, box

## Goal
Wardaway is automated as written. The Plutonium import had several problems:
- range Self with no target;
- damage that doesn't scale with slot level;
- no Speed halving and no "Action or Bonus Action" limit on a failed save;
- Constructs and Undead didn't auto-succeed.

Found on Raziel (Paladin 3).

## Sources
- 5etools `spells-frhof.json`, Wardaway (FRHoF p. 147):
  - a 1st-level abjuration, 60 ft, one creature, Con save;
  - Constructs and Undead automatically succeed;
  - fail: 2d4 force, Speed halved until the start of your next turn, and on its next turn only an Action or a Bonus
    Action;
  - success: half damage only;
  - +2d4 per slot level above 1.
- Base data: Raziel's Plutonium copy (`book: "FRHoF"`, identifier `wardaway`).

## Done (offline)
- **Engine:**
  - activity flag `autoSave` (filter on the target's roll data) in `workflow.mjs` (`autoSaves`, used by `resolveSave`
    and `pendSaves`); the summary shows "✔ saved (automatically)";
  - effect rule `actionOrBonus` (`economy.mjs`, `dnd5e.preUseActivity`): on its turn, the second of Action / Bonus
    Action is refused with a notice.
- **Editor:**
  - save activities get "Succeed automatically: nobody / Constructs and Undead / custom";
  - effect rules get "Action or a Bonus Action, not both";
  - both are described in the summaries.
- **Box:** `wardaway-frhof-147.json` v1 (`_id` TBXUUzdG257Z9d2F), match `{ type: spell, identifier: wardaway, book: FRHoF }`.
  - Range 60 ft, one creature.
  - 2d4 force, half on a save, `scaling: whole +2d4`.
  - Effect "Wardaway" on a failure: every speed ×0.5 and `actionOrBonus`; it lasts 1 round, expiring at the start of
    the source's turn.
- **Packing:** not packed yet (Foundry was running for other tests). Run `npm run pack` with Foundry closed.

## Acceptance (live) — all passed live 2026-10-03 (Paladin 3, Plutonium import of Wardaway FRHoF; patch v1 auto-matched)
- [x] ZZ Paladin casts Wardaway (level 1) at a ZZ Goblin (walk 30):
  - forced fail: 2d4 force, the Goblin's walk is 15, and the "Wardaway" effect is on it;
  - forced success: half damage, no effect.
- [x] Upcast at level 2: 4d4.
- [x] A ZZ Skeleton (Undead) target: no roll; the summary says "saved (automatically)"; half damage.
- [x] In combat on the Goblin's turn: after an Action, a Bonus Action activity is refused with the notice. The effect
      ends at the start of the Paladin's next turn, and the walk speed is back to 30.
- [x] Editor: the Wardaway activity shows "Succeed automatically: Constructs and Undead", and the effect shows the
      Action/Bonus box. Saving without changes keeps the flags identical.

## Log
- 2026-10-03 — Claude (Opus): written offline (`node --check`, strip check). Untested; not packed.
- 2026-10-03 — Sonnet live test: all five items PASS. Plutonium import (book FRHoF, identifier wardaway) auto-patched to v1. Forced fail: 2d4=2 force, HP 200->198, Goblin walk 30->15, effect with actionOrBonus. Forced success: 2d4=4, HP 200->198 (half), no effect, walk 30. Upcast slot 2: 4d4=10, HP 200->190. Undead Skeleton (Con save forced to -50): no save roll, summary "saved (automatically)", 2d4=5 -> HP 100->98, no effect. Combat: on the Goblin's turn an Action activity was accepted and a Bonus Action activity refused with the warning "... can take an Action or a Bonus Action this turn, not both (Wardaway)." (economy unchanged); at the start of the Paladin's next turn the effect was expired/suppressed (stays on the sheet as expired, dnd5e doesn't delete it) and walk was back to 30. Editor: activity editor shows "Succeed automatically: Constructs and Undead", effect editor shows the Action/Bonus box checked; saving both unchanged left activity and effect flags identical. Test actors/scene/combat deleted.
