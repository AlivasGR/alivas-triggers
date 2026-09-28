---
name: live-test
description: Test automation in a running Foundry, or record the test as a task when Foundry isn't available. Use after building or changing engine code or patches, or to work through needs-live-test tasks.
---

# Live test

## 0. Is Foundry available?
Check for a reachable Foundry server (default `http://localhost:30000`) running dnd5e with both modules linked into
`Data/modules`. **If not: stop here and run the `handoff` skill** — write the checklist below into the task file
with status `needs-live-test`. Never install Foundry or ask the user to.

## 1. Safety
* Never test on a scene or in a combat that holds a game in progress. Create a scene named `ZZ …` and actors named
  `ZZ …`; delete them afterwards.
* Before touching a real character, snapshot it (`actor.toObject()` saved to a file or a flag) and restore it after.
* Don't change world settings you didn't set; restore any you change.
* Building compendia (`npm run pack`) needs Foundry **closed**; testing needs it running. Ask the user to switch
  when needed, once, batching everything that needs each state.

## 2. Drive it
* Prefer the API over clicking: `activity.use()`, `actor.rollSavingThrow()`, token `update` for movement, and the
  engine's `game.modules.get("alivas-engine-of-triggers").api`.
* Template / summon placement waits for a canvas click: stub it for the test with
  `dnd5e.canvas.TemplatePlacement.prototype._place` / `dnd5e.canvas.TokenPlacement.prototype._place` and restore the
  originals.
* A browser pane that's hidden or 0×0 breaks login and canvas: give it a real viewport (e.g. 1440×900) and reload.
* Popups that need a *player*: use a player user of the local test world. Ask the human to click only when you can't.

## 3. Check
Assert numbers, not impressions: HP before/after, effect present with the right duration, uses spent, chat card
count (no duplicates), no console errors on either client.

## 4. Finish
Clean up (ZZ scene, actors, stubs, restored characters). Update the task file: tick acceptance items with "(live
YYYY-MM-DD)", move failures into **Left** with the observed vs expected values, and fix or file them.
