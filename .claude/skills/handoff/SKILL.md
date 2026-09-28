---
name: handoff
description: Leave work for the next contributor or agent in tasks/. Use when stopping mid-task, when a live test can't be run (no Foundry), or when proposing new work.
---

# Handoff

The next reader starts cold with only the repo. Write so they can continue from the task file alone.

1. **Find or create the task.** Existing: `tasks/T-<nnn>-*.md`. New: copy the template from `tasks/README.md`, take
   the next free number, add the row to the index, bump the number.
2. **Status.** `needs-live-test` if everything offline is done; `in-progress` if not; `blocked` + the reason if you
   need a decision or data.
3. **Done** — facts only: files written (paths), patch ids + versions, engine pieces added (function / field names),
   commit hashes. Say "untested" wherever it applies.
4. **Left** — the first concrete step, then the rest. For live tests: actor setup (class, level, items), exact
   actions, expected numbers (e.g. "Flurry second hit → Hand of Healing offered → ally heals 1d6+3").
5. **Assumptions** — anything you couldn't verify (data shapes, identifiers, how dnd5e behaves at runtime), in a
   bullet list under **Left**.
6. **Log** — one dated line: what you did, what failed, what you learned.
7. Commit with the task id in the message (`T-004: Push mastery handler (untested)`).

Never mark an acceptance item done without saying how it was verified: (offline) / (live).
