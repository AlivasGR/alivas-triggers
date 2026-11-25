# T-031 — Sky Below Chapter 2, manifest update 2026-11-25 (Box only)

- **Status:** done
- **Foundry:** test
- **Owner:** Alivas
- **Area:** box

## Goal
Build the 2026-11-25 changes to the campaign's Chapter 2 mechanics manifest (follow-up to T-030) as Box patches,
with **no engine changes** (maintainer's decision). Mechanics that need engine code are listed under **Left**.

## Sources
- 2025 MM (5etools `bestiary-xmm.json`):
  - Spectator (p. 289): Eye Rays (1d4, DC 12, 90 ft) and Spell Reflection.
  - Shield Guardian (p. 277): Regeneration.
- 2024 PHB (5etools `spells-xphb.json`):
  - Sleep (p. 317), Hold Person (p. 286), Glyph of Warding (p. 279: 5d8, 20-ft radius).
  - Thunderwave (p. 334: 2d8, +1d8 per slot level above 1st, so 4d8 at 3rd level; 10-ft push).
  - Suggestion (p. 321), Gust of Wind (p. 282: Str save, 15-ft push).
- Homebrew (the campaign's C2 mechanics manifest; the DM's own numbers): ward save DC 17, The Welcome DC 15,
  Shedrak's staff (Beholder rays, d10, DC 16, one per turn).

## Done
All files are in `alivas-box-of-triggers/packs/_source/fixed-items/`. Each is version 1 unless stated. All were
live-tested 2026-11-23/25 on Foundry 14.370 with dnd5e 6.1.1.

| File | Match | Mechanics |
|---|---|---|
| `shedraks-staff-sky-below.json` | name Shedrak's Staff, equipment | **Eye Ray** (once per turn, recovers at turn start; dnd5e tracks the limit only in combat): `random` 1d10 over the Beholder's ten rays at DC 16. Shares `beholder_ray_set` with the Beholder patch. |
| `eye-rays-spectator-mm-25-289.json` | name Eye Rays, feat, MM'25 p. 289 | 1d4. Confusion: 2d4 psychic, `noReactions`, turn-start note. Paralyzing: repeat Con save. Fear: 2d4 psychic, Frightened. Wounding: 3d10 necrotic, half on a success. All DC 12. |
| `spell-reflection-spectator-mm-25-289.json` | name Spell Reflection, feat, MM'25 p. 289 | Reaction activity: Dex DC 12, 3d6 Force on one creature. Used by hand (see Left). |
| `regeneration-shield-guardian-mm-25-277.json` | name Regeneration, feat, MM'25 p. 277 | Turn start: heal 10 while at 1+ HP. |
| `sleep-glyph-sky-below.json` | name Sleep Glyph, feat | 1 use. A placed 5-ft-radius Sphere, Wis DC 17: Incapacitated; at its turn end a second save, Unconscious on a failure; damage ends either. `autoSave`: Exhaustion immunity, or "elf" in the creature subtype or race. |
| `hold-person-glyph-sky-below.json` | name Hold Person Glyph, feat | 1 use, one target, Wis DC 17: Paralyzed with a repeat save. Non-Humanoids succeed automatically. |
| `lightning-rune-sky-below.json`, `cold-rune-sky-below.json` | names Lightning Rune, Cold Rune, feat | 1 use. A 20-ft emanation from the trap token (place it on the door or the book), Dex DC 17, 5d8, half on a success. |
| `circle-failsafe-sky-below.json` | **v2** | Now the *thunderwave* glyph: Con DC 17, 4d8 Thunder, half on a success; on a failure, pushed 10 ft from the socket. |
| `ward-gust-sky-below.json` | name Ward Gust, feat | A placed 60×10 Line (permanent) with difficult terrain. Entering: Str DC 17, or pushed 15 ft away from the trap token and Prone. |
| `ward-put-back-sky-below.json` | name Ward Suggestion (Put Back), feat | A placed 5-ft square. Entering: the DM is asked "carrying anything taken?"; on Yes, Wis DC 17 or Charmed (with a note; ends on damage). |
| `ward-go-back-down-sky-below.json` | name Ward Suggestion (Go Back Down), feat | A placed 5-ft square. Entering: Wis DC 17 or Charmed (with a note; ends on damage). |
| `ward-mouth-sanctum-sky-below.json` | name Ward Mouth (Sanctum), feat | A 30-ft emanation. Every entry posts the mouth's line. |
| `the-welcome-sky-below.json` | name The Welcome, feat | Transfer effect on the trap token (in the iron doorway, Initiative 20). Each of its turns: everyone within 60 ft saves Dex DC 15 or is **Grappled (The Welcome)** (tether, escape DC 15); everyone it holds is pulled 15 ft toward it; those within 5 ft are **Shackled** (Restrained). Creatures already held or shackled don't save again. |

Removed:
- `library-glyph-sky-below.json`: the manifest removed the library glyph.

Not built:
- **Mana-Drained.** dnd5e restores slots on a Long Rest while the override still caps them at 0, so she would wake
  with none. Instead, expend her slots on the sheet; a Long Rest restores them natively.

**Setup** (DM):
- Trap tokens: an NPC holding empty feats with the exact patch names.
- The template wards (Gust and the two Suggestions): use the activity once to place them; they stay.
- Rune and Sleep glyphs: use them when someone tries the door; restore the item's use to re-arm.
- A ward goes inert in a dropout by disabling its effect (auras) or deleting or hiding its region (templates).

Checks:
- (offline) `node scripts/strip-rules-text.cjs --check` passes; `npm run pack` builds.
- (live) Every patch applies on actor creation.
- (live) Spectator rays 1–4 forced, each as in the table.
- (live) Staff: in combat, one ray, a second refused, recovered at Shedrak's next turn start.
- (live) Regeneration: 50 → 60 HP at turn start; none at 0 HP.
- (live) **Sleep Glyph:**
  - Target A: Incapacitated, then Unconscious after the second save, woken by damage.
  - Automatic successes for the elf (subtype) and an Exhaustion-immune creature.
  - The use is spent.
- (live) Hold Person Glyph: a Humanoid is Paralyzed; an Undead succeeds automatically.
- (live) Cold Rune: three creatures in 20 ft fail and take 5d8 cold; the use is spent.
- (live) Circle Failsafe v2: Con DC 17, 4d8 thunder, pushed 10 ft.
- (live) **Ward Gust:** a line region with difficult terrain; entering: failed Str DC 17, pushed 15 ft from the vent,
  Prone.
- (live) **Go Back Down:** square region; entering: failed Wis DC 17, Charmed with its note; damage ends it.
- (live) **Put Back:** the DM's Yes gives the save, then Charmed; No gives nothing.
- (live) **Ward Mouth:** the line is posted on every entry.
- (live) **The Welcome**, two of its turns:
  - Round 1: failures Grappled and pulled 15 ft; the one reaching the doorway Shackled.
  - Round 2: no new saves for held creatures; the next creature pulled up behind (blocked by the first).
- Fixed during the test:
  - The suggestion squares used template type `rect`, which dnd5e doesn't have; now `square`.
  - The Sleep Glyph used `radius` (an emanation around the trap token); now `sphere`, placed on the intruder.
    **The sphere itself wasn't re-run live**; the placed-template path is the same one Web uses.

## Left
1. **The Welcome's range is 60 ft from the trap token,** so every creature within it is caught, not only those on the
   gallery. Set the range to the gallery's size in the trigger editor, or keep other creatures out of it.
2. **Engine gaps** (not built, by decision):
   - Spell Reflection's automatic prompt: `Reactions.saveSucceeded` never offers the saver a reaction to its own save.
   - The ward cycle (dropouts, ward-bound creatures and traps, the demiplane door).
   - Door events: a glyph firing when a door is tried; door AC/HP; 1-minute picks; the strongroom password and
     Lintel's fight trigger.
   - The meld ward's three-and-three save tally.
   - Re-arming traps after 10 minutes.
   - Books going home from the demiplane.
   - Haul's free drag.
   - The circle project tracker (a journal page instead).
3. **Approximations:**
   - The circle failsafe hits only the intruder, not everyone in the 15-ft cube.
   - The Gust's difficult terrain applies in every direction, not only against the wind.
   - Torches going out, Vizeran's exemption, the Welcome's three locks and chain HP stay with the DM.

## Log
- 2026-11-25 — Claude (Opus 5.5): built 13 new patches and updated the circle failsafe (v2), removed the Library
  Glyph, dropped Mana-Drained; live-tested everything in Foundry 14.370 / dnd5e 6.1.1; fixed two template types
  found in the test.
