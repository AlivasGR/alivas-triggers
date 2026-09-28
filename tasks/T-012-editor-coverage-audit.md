# T-012 — Editor coverage audit

- **Status:** open
- **Foundry:** test
- **Owner:**
- **Area:** editor

## Goal
Every field documented in the headers of `main.mjs`, `reactions.mjs`, `workflow.mjs` and `areas.mjs` is reachable in
`editor.mjs`, round-trips unchanged, and describes itself in plain English.

## Plan
1. Offline: list the fields from the headers; grep `editor.mjs` for each; table in **Done** with reachable /
   described / round-trips.
2. Offline round-trip: run the converters in Node over every patch in `fixed-items` (`triggerToModel` →
   `modelToTrigger`, `reactionToModel` → `modelToReaction`) and diff. Needs the stubs from T-013.
3. Live: open the editor on a sample of patched items; nothing should read "a custom condition".

## Log
- 2026-09-29 — maintainer: task written.
