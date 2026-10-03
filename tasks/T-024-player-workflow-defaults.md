# T-024 — Player workflow defaults: manual attack and save rolls, automatic damage and effects

- **Status:** done
- **Foundry:** test
- **Owner:**
- **Area:** engine (settings)

## Goal
The maintainer's request (2026-10-03): by default, players roll their own attack rolls, and damage and effects on a hit
are automatic. The creatures their save spells target roll from the chat card, and damage and effects are applied
after each result. NPCs stay fully automatic.

## Done
`main.mjs` settings:
- `wfAttackPC` default `"full"` → `"damage"` ("You roll the attack; damage on a hit is rolled and applied");
- `wfSavePC` default `"auto"` → `"apply"` ("You roll the saves (chat card); damage and effects applied as results
  come in").

Effects on a hit and on a failed save already follow `autoApplyEffects` (default on). The README states the defaults.
A changed default only reaches worlds without a stored value, so there is also a one-time update (`main.mjs`, a
`ready` hook, lead GM, world setting `defaultsApplied`). A world still storing the OLD defaults (`wfAttackPC`
"full", `wfSavePC` "auto") is switched to the new ones, and the GM gets a whisper saying so. Other stored choices are
left alone. The local copy of the Forge world stores `wfAttackPC`, so it is covered by this update.

## Acceptance (live)
- [x] (live 2026-10-03) With no stored values, a player attacks a ZZ Goblin with a longsword:
  - dnd5e's attack roll dialog appears (not auto-rolled);
  - on a hit, damage is rolled and applied, with no damage dialog;
  - on a miss, nothing is applied (Graze excepted);
  - an attack activity with an effect puts it on the target it hits.
- [x] (live 2026-10-03) A player casts a save spell (Toll the Dead) at a ZZ Goblin:
  - no save is rolled automatically, and a "Waiting for saves from: ZZ Goblin" card appears;
  - the GM rolls the Goblin's save from the spell card's button, and damage (and effects on a failure) are applied.
- [x] (live 2026-10-03) NPC attacks and saves stay fully automatic.
- [x] (live 2026-10-03) One-time update:
  - store wfAttackPC "full", reset defaultsApplied to 0, and reload the GM: wfAttackPC becomes "damage" and one GM
    whisper appears;
  - reload again: nothing more;
  - store "attack" instead: left unchanged.

## Log
- 2026-10-03 — Claude (Opus): defaults changed; untested live.
- 2026-10-03 — Sonnet live test (zz-stage-test, GM + ZZ Player tabs): all PASS. No stored values: player Longsword attack shows dnd5e's Attack Roll dialog; hit (8 vs AC 1) rolled 1d8+3=10 and applied (100 to 90) with no damage dialog; miss (22 vs AC 40) applied nothing; an effect on the activity landed on the hit target. Toll the Dead from the player: no save rolled, card said "Waiting for saves from: Goblin Warrior..."; GM rolled the save from the card (Wis -30, failed), 4 damage applied (71 to 67), and a failure effect was applied on a second cast (67 to 63). NPC goblin Scimitar and an NPC Toll the Dead at the PC were fully automatic (40 to 37, 37 to 36, save auto-rolled). Migration: wfAttackPC full + wfSavePC auto + defaultsApplied 0, GM reload gave damage + apply and exactly one whisper; second reload no new whisper; wfAttackPC attack + wfSavePC auto + defaultsApplied 0 left attack, moved the save, one whisper naming only the save. No harness errors on the player tab. Stored values for wfAttackPC, wfSavePC, defaultsApplied deleted afterwards; test actors removed.
