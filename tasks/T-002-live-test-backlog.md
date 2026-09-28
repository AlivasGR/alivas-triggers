# T-002 — Live-test backlog

- **Status:** needs-live-test
- **Foundry:** yes
- **Owner:**
- **Area:** engine, box

## Goal
Exercise features that were built (and unit-checked) but never run in a real game flow. Follow the `live-test`
skill: throwaway scene, `ZZ` actors, clean up afterwards.

## Checklist
Mark each (live) with the date, or move it to a fix task if it fails.

- [ ] **Flaming Sphere** after the areas refactor: cast; move the sphere into a creature (collision → ram save, 2d6
  fire, stops); end the caster's turn next to a creature (end-of-turn save); dismiss / concentration end removes it.
- [ ] **Chromatic Orb** leap in a real cast: roll two matching damage dice → prompt to leap to a creature within 30 ft
  of the first target; the leap makes a new attack; a second pair leaps again (upcast limit).
- [ ] **Keywand of the Stars** stored spell: store a spell (storeSpell), then cast it from the wand with the
  wand's own numbers; charge spent; the +1 spell attack bonus not applied to summons.
- [ ] **Weapon masteries** Sap (target has Disadvantage on its next attack), Slow (−10 ft speed until your next turn,
  no stacking), Topple (Con save or Prone), Graze (miss → ability-modifier damage). Setting `wfMastery` on; actor
  with the masteries chosen in `system.traits.weaponProf.mastery`.
- [ ] **Mummy Rotting Fist** curse in play: the curse's interval (every 24 h) drains max HP; a long rest doesn't cure
  it; Remove Curse does.
- [ ] **Proto-Necromancy** and **Find Familiar** summons: placed through the summon workflow; summonEffects applied;
  the familiar can deliver a touch spell.
- [ ] **Trinket of the Raven Queen** Necrotic Shroud sight check on a rendered canvas (hidden-pane tests can't see).
- [ ] **Multi-client**: a player (non-GM) triggers a save area, a reaction on a creature they don't own, and a
  heal; each resolves once (lead GM) with no errors on either client.

## Log
- 2026-09-29 — maintainer: backlog collected from the v0.5.0 / v0.6.0 rounds.
