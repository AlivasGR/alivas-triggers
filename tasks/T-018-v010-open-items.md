# T-018 — v0.10.0 follow-ups: unverified items, placeholders to confirm, known limits

- **Status:** open (waiting for the maintainer's play-session feedback, which gets added below; don't implement before they say so)
- **Foundry:** test
- **Owner:**
- **Area:** engine (bodies, trade, cover, economy, interact, settings, maneuvers, loot), box, stage

## Context
v0.10.0 shipped:
- carrying bodies, looting, pickpocketing;
- trading (hand over, throw, catch);
- skills with another ability;
- cover, with dialog, after-roll buttons and undo;
- the action economy and the token interaction menu;
- 46 settings in Automation settings;
- full editor coverage.

All of this was tested live with a GM tab and a player tab, except the items below.

**Testing rule (the maintainer's):** live tests are run by Sonnet subagents, never in the main thread.

Test setup in the `zz-stage-test` world:
- harness: `Data/zz-harness.mjs`;
- GM tab at `http://localhost:30000`, user "Gamemaster";
- player tab at `http://127.0.0.1:30000`, user "ZZ Player", who owns ZZ Rogue and ZZ Barbarian. The different host gives it a separate cookie.
- The in-app browser pane is hidden, so tokens and animations don't draw. Read positions from `_source`, not from token x/y.

## Not verified yet
- [ ] The Box patches for Sharpshooter, Spell Sniper and +1/+2/+3 Wand of the War Mage, applied from the rebuilt pack (`keep.effects`). The ignore-cover logic itself is tested.
- [ ] The combined loot-pile image as drawn on screen (the file and `texture.src` are verified).
- [ ] Most of the new settings. Only `bodiesPickpocket` and `coverButtons` were toggled. List and defaults: header of `scripts/settings.mjs`.
- [ ] The editor additions beyond Shove Aside's onFail/saveAdvantage and the fragile item setting: see "Verify live" in the editor audit (light animation, armorClass.shielded, check filters, refunds, free-cast spell picker).
- [ ] Opportunity Attack exclusion for teleport spells and Hurl (same "displace" path as push and Shove Aside, which are tested).

## Placeholders the maintainer should confirm (all are settings now)
| What | Default |
|---|---|
| Body weight per size when the sheet's Weight is empty | Tiny 8, Small 35, Medium 150, Large 500, Huge 2,000, Gargantuan 10,000 lb |
| Pickpocket "small object" | unequipped, not a container, ≤ 1 lb |
| Fragile heuristic | potions or names matching vial / flask / bottle / potion / glass (per-item override in the editor) |
| Trading out of combat | any distance, no throw |
| Stressed-throw check | GM asked, default Yes |
| "Hidden" for pickpocketing | statuses `hiding` / `invisible` (Box Hide maneuver); no per-observer tracking |

## Known limitations
- An unlinked token whose own data (delta) holds a Combat Maneuvers item doesn't receive Box updates: the delta copy hides the base actor's. The Box sync only walks world actors.
- Player placement for Shove Aside / Hurl on creatures they don't own uses a stand-in preview built on the player's own token (`maneuvers.mjs` `placementStandIn`).
- Item Piles shows its own "Give item?" confirm before our trade flow runs (cancelling it in `item-piles-preGiveItem` happens after that dialog).
- The Stage preset builders (`private/work/anim/build-presets.mjs`, `build-items.mjs`) are behind the hand-fixed `presets/*.json`. Re-running them overwrites fixes (warning in their headers).

## Older open items carried over
- Fix the Hungry Jaws Stage preset (needs an attack phase).
- Resume the Box-wide live test:
  - Paladin features (oaths, Vow of Enmity, Sacred Weapon, Lay on Hands, Divine Sense);
  - Wizard items and spells;
  - monster features (Wight Life Drain, Quasit Rend/Scare, Mummy, Chasme Drone, Zombie, Spores);
  - Dwarven Resilience;
  - Hold Person repeat save.
- Traps on the obstacle model (`loot.mjs`: `obstacle.trap` is reserved).
- Ready action (T-017, on hold).

## Session feedback (maintainer)
_(add here as it comes in)_

## Log
- 2026-10-03: Created at the v0.10.0 release.
