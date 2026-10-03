# T-022 — Concentration popup for players; Graze fixes; reaction options (unprepared, duplicates)

- **Status:** done
- **Foundry:** test
- **Owner:**
- **Area:** engine

## Goal
Reported from play (Forge, 2026-10-03):
1. A paladin concentrating on Compelled Duel was hit several times and got neither a concentration popup nor an
   automatic save.
2. A character with a greatsword dealt no Graze damage on missed attacks.

## Findings
**Concentration.** In the setting "Concentration saves" = Automatic (the default), a PC whose player was connected
was left to dnd5e's own handling: a whispered chat card with a button, which is easy to miss. Nothing happened unless
the player clicked it. The Compelled Duel patch is fine: the activity takes the spell's Concentration property.
Not confirmed: whether dnd5e's world setting "disableConcentration" is on in the Forge world. That would also explain
it; check it there.

**Graze.** The engine only applies a mastery the character has chosen in dnd5e's weapon mastery list
(`system.traits.weaponProf.mastery`). In the local dump (2026-09-26) **no character has any mastery chosen**, so no
mastery ever fires. That's the likely cause. Code gaps found on the way:
- a hit that a reaction turned into a miss (Shield, Silvery Barbs) skipped Graze;
- a weapon with no `baseItem` set didn't count;
- the modifier wasn't taken from the attack roll (finesse).

## Done (offline, `node --check`)
- `main.mjs` `challengeConcentration` override, mode "auto", connected player:
  - `runAs(player, "concentrationPrompt")` shows a popup (DC, the spells at risk, Roll / Advantage / Disadvantage)
    that rolls by itself after the reaction timeout;
  - if the player doesn't answer (runAs gives null), the window that applied the damage rolls it;
  - a failure ends concentration (the existing `dnd5e.rollConcentrationV2` hook).

  Setting hint updated.
- `masteryOf`:
  - falls back to the item's identifier when `baseItem` is empty (if it names a dnd5e weapon);
  - whispers a one-time hint (owner + GM) when the actor has the Weapon Mastery feature but no masteries chosen.
- `applyMastery`: the modifier comes from the attack roll's data (`roll.data.mod`). A reaction-turned miss now applies
  Graze.

- `reactions.mjs` `eligible`, found on Raziel (Paladin 3, export 2026-10-03):
  - a leveled spell that must be prepared (`system.canPrepare`) and isn't (`prepared: 0`) is no longer offered;
  - copies of the same item (same identifier and label) offer one option.

  Raziel had three Divine Smites, unprepared Searing, Thunderous and Wrathful Smite, and two each of Protection from
  Evil and Good and Shield of Faith.

## Acceptance (live)
- [x] **Concentration popup (live 2026-10-03):** ZZ Paladin (player tab connected) concentrating on Compelled Duel; ZZ Goblin hits it
      for 8.
  - The player tab gets a "Concentration" popup at DC 10.
  - Fail: concentration ends, and Compelled Duel ends on the target.
  - Let it time out: it rolls by itself.
  - Close the player tab and hit again: the GM window rolls it.
- [x] **Graze (live 2026-10-03):** ZZ Fighter (Str 16) with Greatsword mastery chosen; miss a ZZ Goblin: 3 slashing damage, plus the
      "the miss still deals 3" line.
  - The same with Shield turning a hit into a miss.
  - With no masteries chosen: one whisper hint per session, and no Graze.
- [x] **Reaction options (live 2026-10-03):** a ZZ Paladin with Divine Smite twice (prepared 2) and Searing Smite unprepared hits:
      Divine Smite is offered once and Searing Smite isn't. Prepare Searing Smite: it's offered.
- [x] **Topple (live 2026-10-03):** the Con save DC is 8 + Str mod + proficiency.

## Left
- Live checks all passed (see Log). Not covered: a player who is connected but whose client never answers the popup (runAs returns null); only a disconnected player was tested.
- On Forge: choose each martial character's weapon masteries on their sheets, and check dnd5e's "disable
  concentration" setting.

## Log
- 2026-10-03 — Claude (Opus): diagnosed from code and the world dump; fixes written, untested live.
- 2026-10-03 — Sonnet live test (zz-stage-test, GM + ZZ Player tabs, dnd5e 6.0.5): all PASS. Concentration: popup on the player tab at DC 10 listing "Concentrating: Compelled Duel", auto-rolled after 3 s; failed roll (-30 Con bonus) ended concentration and removed Compelled from the target; the Advantage button was honoured (2d20adv); with the player offline the GM window rolled it. Graze: Greatsword (Pact Weapon enchantment, attack used Cha +3) missing dealt 3 with the "the miss still deals 3" line; a plain Str +2 quarterstaff dealt 2; Shield turning a hit into a miss still applied Graze (wizard 20 to 17); a baseItem-less greatsword still counted; with no masteries chosen exactly one whisper hint and no Graze on the second try. Reactions on the imported Raziel (3 Divine Smites): Divine Smite once plus "Divine Smite (Paladin's Smite)" (a separate feature), no unprepared smites; after preparing Searing Smite it was offered. Topple DC 12 = 8 + Str 2 + prof 2 (13 with the Pact Weapon attack because the roll used Cha).
- 2026-10-03 — Sonnet live test (Graze damage type): ZZ PC with Greatsword mastery and base types slashing + radiant, target resisting radiant. With no type chosen a miss dealt 3 (slashing, first type); after choosing Radiant in the damage-type popup on a hit (flag dnd5e.last.<activity>.damageType.0 = radiant), the next miss dealt 1 (3 halved by the resistance), so Graze uses the chosen type. PASS.
