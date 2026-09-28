# T-013 — Node unit tests for the pure parts

- **Status:** open
- **Foundry:** no
- **Owner:**
- **Area:** tooling

## Goal
Most bugs so far were in logic that doesn't need Foundry: filter evaluation, formula references (`@scale`,
`@castLevel`), patch matching and `buildPatched` (what's kept from the user's item), editor converters. Add
`node --test` tests with minimal stubs of `foundry.utils` and `CONFIG.DND5E`, so offline contributors can verify work.

## Plan
1. Identify pure functions. If one is tangled with globals, extract it without changing behaviour, and export it.
2. `test/` + `test/stubs/`; `npm test`.
3. Cover: patch matching, buildPatched keep-list, filter evaluation, converter round-trips (T-012), strip check on
   every patch.

## Log
- 2026-09-29 — maintainer: task written.
