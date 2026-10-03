# T-025 — Alliances (baseline)

- **Status:** needs-live-test
- **Foundry:** test
- **Owner:**
- **Area:** engine

## Goal
The maintainer's design (2026-10-03): every combatant has an alliance letter (the party A, enemies B, others as the GM
assigns). The same letter are allies, and a different alliance is not an ally. The GM edits it on the combat tracker
(a one-letter field, GM only) or sets a default on the sheet. The engine's ally / enemy logic follows the letters.
An override lets any creature picker include creatures outside the alliance (Bless an enemy, Bane an ally), and a
setting allows Opportunity Attacks against allies. More features will be built on this later: use `api.alliances`
and the hook `alivasTriggers.allianceChanged`.

## Done (offline, `node --check`)
- `alliances.mjs`:
  - resolution: combatant flag → actor flag (`"-"` means none) → automatic (players' creatures `alliancePC`, summons
    their summoner's, else Friendly A / Hostile B / Neutral none);
  - `createCombatant` stamps the letter (lead GM);
  - a tracker field (GM only, `renderCombatTracker`);
  - an "Alliance" header button on actor sheets (GM): a dialog for the default, showing what "automatic" would give;
  - the API and the `allianceChanged` hook.
- `creatures.mjs`:
  - `relation()` uses alliances when on (`setAllianceResolver`, `alliancesOn`, `allianceLetter`);
  - side-filtered pickers (`selectCreatures` "choose") pass `others`; `pickOnMap` shows them behind "Include
    creatures outside this alliance";
  - targeting such a creature on the map reveals the hidden rows.
- `reactions.mjs`:
  - Opportunity Attacks: same alliance means no offer, unless the setting `allianceOaAllies` is on (then the popup
    says "(an ally)");
  - Sneak Attack's ally-near check uses alliances.
- `maneuvers.mjs`: a creature's own alliance never blocks its move (removed from dnd5e's blocking set); blocked-move
  offers use alliances.
- Settings `alliances` (default on), `alliancePC` ("A") and `allianceOaAllies` (off), in Automation settings → Combat.
  AGENTS.md and README updated.

## Known limits (baseline)
- dnd5e's blocking only counts creatures of a different disposition. An enemy by letter who shares the mover's
  disposition doesn't block. Fixing that needs an occupancy check: a follow-up.
- Out of combat, the actor default or the automatic letter applies. There is no per-token letter outside combat.
- Two creatures that both have no alliance aren't allies (behaviour change from dispositions: two Neutral tokens can now
  Opportunity Attack each other).

## Acceptance (live)
- [ ] Start a ZZ combat with a ZZ PC (player-owned), a ZZ Friendly NPC companion, two ZZ Hostile goblins and a ZZ
      Neutral commoner. The tracker shows A, A, B, B and blank (GM only; the player tab shows no field).
- [ ] Sheet: set the commoner's default to "C" before adding it to a combat; it joins as C. Set "-": it joins with no
      letter. Set empty: automatic.
- [ ] The PC casts Bless (a side-filtered picker: allies within 30 ft). It lists the PC and the companion, not the
      goblins. Tick "Include creatures outside this alliance": the goblins appear and can be picked; Bless goes on the
      goblin.
- [ ] Change goblin 2 to A on the tracker:
  - it now appears in the PC's ally picker;
  - an aura "allies within 10 ft" (e.g. Paladin Aura of Protection, or a ZZ effect with a giveEffect side ally)
    includes it;
  - a filter with `subjectIsEnemy` stops matching it.
- [ ] Opportunity Attacks:
  - goblin 1 (B) leaves the PC's reach: OA offered;
  - goblin 2 (now A) leaves: not offered;
  - with `allianceOaAllies` on: offered, with "(an ally)".
- [ ] Movement: the PC moves through goblin 2's space after it's switched to A (no block). Through goblin 1 (B):
      blocked, and the Tumble / Overrun offer appears (if the PC has those activities).
- [ ] Sneak Attack ally-near: a rogue hits goblin 1 with the companion (A) adjacent to it: Sneak Attack is offered.
      Change the companion to B: no longer counts.
- [ ] A summon (e.g. Find Familiar) gets its summoner's letter.
- [ ] Setting `alliances` off: no tracker field, and sides follow dispositions exactly as before.
- [ ] Hook `alivasTriggers.allianceChanged` fires on a tracker edit (log it).

## Log
- 2026-10-03 — Claude (Opus): baseline written offline. Untested live.
