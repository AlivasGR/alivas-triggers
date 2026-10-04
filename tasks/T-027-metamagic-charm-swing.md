# T-027 — Twinned Spell upcast, complete Charm/Dominate patches, Swing Creature, the new perspective rule

- **Status:** needs-live-test
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
- [ ] **Perspective:**
  - a player owning ZZ PC (A) and a ZZ hireling (C, neutral to B) clicks the PC: B tokens are red;
  - they click the hireling: B tokens are yellow, and stay yellow after deselecting;
  - the GM always sees A's colours.
- [ ] **Twinned:**
  - a ZZ Sorcerer uses Twinned Spell: 1 Sorcery Point is spent, and "Twinned Spell (next spell)" is on them;
  - they cast Charm Person with a level 1 slot: the card shows level 2 scaling (two targets allowed), the effect is
    gone, and a level 1 slot is spent;
  - a cantrip doesn't remove the effect.
- [ ] **Charm Person:**
  - out of combat: a normal save;
  - in combat vs a hostile goblin: the save has advantage;
  - on a failure, Charmed; when the caster's ally damages the goblin, the Charmed effect ends ("the charm ends");
  - when an unrelated creature damages it, it stays.
- [ ] **Dominate Person:**
  - on a failure the target is Charmed and joins the caster's faction;
  - when it takes damage, a Wis save vs the caster's DC runs, and a success ends it (it returns to its old faction);
  - advantage on the first save when fighting.
- [ ] **Swing Creature** (setting "Include homebrew maneuvers" on):
  - a ZZ Fighter grapples goblin 1 (Unarmed Strike Grapple), targets goblin 2, and uses Swing Creature;
  - an Athletics check runs vs goblin 1's DC;
  - on a success, the Strike attack rolls vs goblin 2: on a hit, goblin 2 takes 1d6 + Str and goblin 1 takes 1d6; on a
    miss, only goblin 1 takes 1d6;
  - not grappling anyone: refused ("isn't grappling anyone");
  - holding a creature too heavy to lift: refused.
- [ ] **Editor:** the new fields show and round-trip.

## Log
- 2026-10-04 — Claude (Opus): written offline; untested live, not packed.
