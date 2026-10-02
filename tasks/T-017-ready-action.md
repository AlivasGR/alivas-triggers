# T-017 — Ready action: full automation

- **Status:** open (on hold by the maintainer's decision; "a big can of worms")
- **Foundry:** test
- **Owner:**
- **Area:** engine, box (Combat Maneuvers), editor

## Goal
2024 Ready: you choose a perceivable trigger and an action; when the trigger happens before the start of your next
turn, you use your reaction to take that action. A readied spell is cast when you ready it (its slot spent then) and
held with concentration; you release it with your reaction.

**Today:** the Combat Maneuvers "Ready" activity only spends the reaction (engine action `useReaction`). Everything
else is played out by the table.

## Sources
- XPHB, Actions: Ready. Summarised in `private/work/maneuvers/rules-2024-digest.md` §4 (maintainer).

## Plan (a starting point exists)
`alivas-engine-of-triggers/scripts/ready.mjs` is a working prototype. It is **not wired in** (no import in `main.mjs`).
It provides:
- the action `ready`, which picks an activity, a trigger (enters / casts / attacks / manual) and a range, and gives the
  effect "Readied: X" with `flags.readied`;
- watchers:
  - `readyMoved(tokenDoc, movement)`, called from `main.mjs`'s `moveToken` hook;
  - a hook on spells cast (`dnd5e.postUseActivity`);
  - a hook on attack rolls (`dnd5e.rollAttackV2`);
  - a GM "Trigger now" chat button;
- release through `Reactions.ask` (exported), which spends the reaction and ends the readiness.

Tested live in the prototype stage: "enters" released a readied longsword attack once. A double attack roll was fixed
in `reactions.mjs`.

Open design questions to settle with the maintainer first:
1. Readied spells: spend the slot when readied, plus concentration ("Readied: spell" as a concentration effect via
   dnd5e), and a free release.
2. Triggers beyond the four: doors (Wall updates), a specific creature, "when an ally…".
3. The interaction with Delay turn: a delayed creature has no reaction.
4. UI: choosing the trigger on the Ready card vs a dialog.

## Acceptance
- [ ] Each trigger releases the readied action once, only within range, only for hostile triggers (live)
- [ ] The reaction is spent, and the readiness ends at the start of the bearer's next turn (live)
- [ ] Readied spell: slot and concentration (live)
- [ ] Editor: the `ready` action has fields (trigger, range) (offline)

## Done
- Prototype `ready.mjs` (unwired). `useReaction` action plus the Ready activity spends the reaction (live: not yet).

## Left
Settle questions 1–4, wire `ready.mjs` back in (import, `initReady`, `registerReadyHooks`, `readyMoved` in
`moveToken`), add the editor fields, and switch the Box's Ready activity from `useReaction` to `ready`.

## Log
- 2026-10-02: Prototype built and tested for "enters". Put on hold by the maintainer: Ready only spends the reaction.
