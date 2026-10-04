# T-027 — Twinned Spell upcast, complete Charm/Dominate patches, Swing Creature, the new perspective rule

- **Status:** done
- **Foundry:** test
- **Owner:**
- **Area:** engine, editor, box (branch `alliances`)

## Goal
The maintainer's requests of 2026-10-04:
- **Perspective:** a player sees colours from the last of their tokens they clicked; the GM always sees A's view.
- **Charm Person, Charm Monster and Dominate (Beast / Person / Monster):** complete patches.
- **Twinned Spell:** it actually applies. Before this, the patch only spent the Sorcery Point.
- **A new homebrew maneuver,** Swing Creature: use a grappled creature as an improvised weapon.

## Sources
- 5etools `spells-xphb.json`: Charm Person / Charm Monster p. 249 (advantage if you or your allies are fighting it;
  ends if you or your allies damage it); Dominate Beast / Monster p. 265, Dominate Person p. 266 (advantage if
  fighting; a repeat Wis save each time it takes damage; concentration).
- Twinned Spell (PHB 2024 p. 142): spend 1 Sorcery Point to increase the spell's effective level by 1, for spells
  that target an additional creature when upcast.
- dnd5e `spells24` YAML for the Charm / Dominate structure; dnd5e `Activity#_prepareUsageScaling` (how spell level
  scaling is computed).

## Done (offline, `node --check`, strip check)
- **Engine:**
  - `factions.mjs` `perspective()`: players use the last clicked own token (a sticky `controlToken`), then their
    assigned character, then A; the GM always sees A.
  - Effect rule `upcast { levels }` (`main.mjs`, wraps `_prepareUsageScaling`): the bearer's leveled spells count as
    cast N levels higher (capped at 9).
  - Activity flag `saveAdvantageWhenFighting` (`workflow.mjs` `fighting()`): targets save with advantage when they're
    in a started combat with the user and hostile to it.
  - The `damaged` event now knows its `subject` (who dealt the damage, from the damage options), and filter data adds
    `subjectAlliedWithSource`.
  - Requirements `holding` and `canLiftHeld` (`maneuvers.mjs`).
- **Editor:**
  - the effect rule "spells count as cast N levels higher";
  - the activity setting "advantage if the user is fighting them";
  - the filter field "the creature is the effect's source or its ally";
  - requirement labels.
- **Box:**
  - `dominate-*-phb-2024` v2: advantage when fighting, `faction: "source"`, a damaged → Wis save (DC source) →
    removeOnSuccess trigger;
  - `charm-person-phb-2024` / `charm-monster-phb-2024` v1 (PHB 2024 + SRD keys): advantage when fighting; Charmed ends
    when the source or its ally damages it;
  - `metamagic-twinned-spell` v2: the activity gives "Twinned Spell (next spell)", with `upcast 1` and a trigger that
    removes it after the next leveled spell;
  - `combat-maneuvers-alivas` v3: **Swing Creature** (homebrew; Action; requires a free hand, holding someone, and
    able to lift them) runs an Athletics check vs 8 + the held creature's higher of Str/Dex + its proficiency. On a
    success it uses **Swing Creature: Strike** (homebrew attack, Str, 1d6 + Str bludgeoning to the target; its use
    deals 1d6 bludgeoning to the held creature, hit or miss).
- **Not packed yet** (Foundry was running for T-026). Run `npm run pack` with Foundry closed before testing.

## Acceptance (live)
- [x] (live 2026-10-04) **Perspective:** player client: selecting ZZ PC (A) -> B tokens e72124 (red); selecting the C hireling -> B
      tokens f1d836 (yellow), still yellow after releasing; selecting the PC again -> red. GM client (also with a C token selected)
      -> perspective "A". Minor, not reproduced: on the first run after a page reload, selecting the hireling once left the perspective
      at "A" (the controlToken hook may not fire if the token was already controlled at load); repeating it worked every time.
- [x] (live 2026-10-04) **Twinned:** Twinned Spell used: Sorcery Points 3 -> 2, "Twinned Spell (next spell)" on the sorcerer. Fire Bolt
      (cantrip): effect stays. Charm Person with a level 1 slot (two goblins targeted): `scaling` 1 in the usage config, both targets
      got a save, slot spell1 4 -> 3, effect removed ("Twinned Spell ends").
- [x] (live 2026-10-04) **Charm Person:**
  - [x] (live 2026-10-04) out of combat: a single d20 (advantage mode 0);
  - [x] (live 2026-10-04) in combat vs a hostile goblin: `2d20adv` (advantage mode 1); failure -> Charmed;
  - [x] (live 2026-10-04, retest) ends when the caster's ally damages it: a real Greataxe hit by an A-faction ally (workflow, wfAttackPC "full")
    -> trigger "Charmed|damaged|note", Charmed removed, note "Charm Person triggers ... damaged by the cas...";
  - [x] (live 2026-10-04, retest) an unrelated C-faction goblin's real Scimitar hit (HP 10 -> 5): Charmed stays, no trigger action;
  - [x] (live 2026-10-04, retest) the caster's own Fire Bolt hit: Charmed removed.
- [x] (live 2026-10-04) **Dominate Person:**
  - [x] (live 2026-10-04) in combat: first save `2d20adv`; on a failure Charmed + "Dominated" effect, faction A, disposition Friendly (1), border cyan;
  - [x] (live 2026-10-04, retest) damage (Fire Bolt hit) with the caster concentrating: trigger "Dominated|damaged|save" rolls a Wis save, no "No usable DC"
    error; forced failure -> Dominated stays, faction A; forced success -> "succeeds - Dominate Person ends", Dominated gone, faction B,
    caster's Concentrating effect kept.
- [x] (live 2026-10-04, retest 2) **Perspective after a page reload:** only a C token owned and auto-controlled at load -> perspective "C", B token colour f1d836; nothing controlled at load -> assigned character's faction "A", colour e72124 (after the fix in `registerFactions`).
- [x] (live 2026-10-04) **Swing Creature** (setting "Include homebrew maneuvers" was already on):
  - Fighter grappled goblin 1 (Unarmed Strike Grapple, DC 15, failed save, tether on goblin 1);
  - Athletics check (1d20 + 7) vs DC 12 (8 + goblin 1's higher of Str/Dex + prof); a roll of 9 -> "can't get enough of a grip", nothing else happens;
  - success (27): Strike attack vs goblin 2 (AC 1) hit: goblin 2 took 1d6+5 (6), goblin 1 took 1d6 (5);
  - success (26) vs AC 40: attack 20 missed: goblin 2 unchanged (10), goblin 1 took 1d6 (3);
  - not grappling: refused "ZZ T27 Fighter isn't grappling anyone.";
  - held goblin set to Gargantuan: refused "(12000 lb) is more than ZZ T27 Fighter can lift now (287.8 lb free)".
- [x] (live 2026-10-04) **Editor:** the effect rule "spells count as cast N levels higher" shows 1, saves 2, other triggers untouched;
  the activity checkbox "Its targets save with advantage if the user is fighting them" shows, toggles off (flag becomes `{}`) and on, and
  reopens in sync; the filter field "source or its ally" is present on the Charm Person effect and the effect round-trips unchanged.

## Left
Nothing.

## Log
- 2026-10-04 — Claude (Opus): written offline; untested live, not packed.
- 2026-10-04 — Sonnet live test (headless v14.368, dnd5e 6.0.5, GM + player tabs, square-grid scene "ZZ T27", cleaned up afterwards): perspective, Twinned,
  Swing Creature and the editor pass; Charm Person's "ally damages it" and Dominate's repeat-save DC fail (Left 1 and 2). Status stays needs-live-test until those are fixed.
- 2026-10-04 — Sonnet live retest (scene "ZZ T27b", GM + player tabs, cleaned up; wfAttackPC set "full" and its stored value deleted afterwards): Charm Person (ally ends, unrelated
  stays, caster ends) and Dominate Person (repeat save with DC, success ends, failure stays) pass. Perspective after reload fails (Left 1). Status stays needs-live-test until that is fixed.
- 2026-10-04 — Sonnet retest 2: the `registerFactions` fix for the load-time perspective passes (C token controlled at load -> C / f1d836; nothing controlled -> A). Everything in T-027 passes; status done.
