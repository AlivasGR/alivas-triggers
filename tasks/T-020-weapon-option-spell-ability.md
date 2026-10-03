# T-020 — Weapon options use their spell's casting ability (Magic Initiate)

- **Status:** needs-live-test
- **Foundry:** test
- **Owner:**
- **Area:** box

## Goal
A weapon option whose attack uses "spellcasting" (Arc Blade, Burning Blade, Frigid Blade, True Strike) uses the
casting ability of the actor's own copy of that spell. dnd5e alone uses the actor's best class ability. Example: a Cha
Sorcerer who took True Strike through Magic Initiate on Int must attack with Int, and the damage `@mod` follows.
Vengeful Blade is unchanged: its rules make a normal melee weapon attack (Str/Dex).

## Plan (done)
`alivas-box-of-triggers/scripts/main.mjs` overrides `spellcastingAbility` on dnd5e's attack activity class (setup
hook). An activity flagged with the option id (`flags.alivas-box-of-triggers.option`) on a weapon looks up the actor's
spell with that identifier and uses `spell.system.availableAbilities.first()`. That's the spell's own `system.ability`
(Magic Initiate, feats, species) or its class's ability. When there's no such spell, dnd5e's default applies. Weapons
that already have options work without re-dropping them.

## Acceptance
- [x] Mocked Node test: Magic Initiate Int → int; class Cha → cha; no spell or no option → dnd5e default (offline)
- [ ] Sorcerer (Cha 18, Int 14) with True Strike from Magic Initiate (Int) and the True Strike option on a dagger:
      the attack uses Int (+2 + prof) and the damage `1d4 + 2` (live)
- [ ] The same Sorcerer with Burning Blade learned as a sorcerer spell: Cha (+4) (live)
- [ ] Remove the spell from the actor: the option falls back to dnd5e's best class ability (live)

## Log
- 2026-10-03 — Claude (Opus): written and tested offline; untested live.
