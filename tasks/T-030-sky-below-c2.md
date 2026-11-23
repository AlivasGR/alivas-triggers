# T-030 — Sky Below Chapter 2 (Wormwrithings / Araj): Box patches from existing engine features

- **Status:** done
- **Foundry:** test
- **Owner:** Alivas
- **Area:** box

## Goal
Support the Sky Below campaign's Chapter 2 mechanics manifest as far as the current Engine allows, with **no engine
changes**. Every patch below uses existing mechanisms only. Mechanics that need new engine code are listed under
**Left → Engine gaps (not built)**. Items the campaign hasn't ruled on yet are listed under **Left → Blocked**.

## Sources
- 2025 MM: 5etools `bestiary-xmm.json` — Beholder (p. 36, Eye Rays), Helmed Horror (p. 166, Spell Immunity),
  Bugbear Warrior (p. 62, Grab, the anchor for Haul).
- 2024 PHB: 5etools `spells-xphb.json` — Web (p. 340), Slow (p. 318), Greater Restoration (p. 281), Glyph of Warding
  (p. 279: 5d8, 20-ft-radius Sphere, Dex save; the numbers anchor the Library Glyph).
- dnd5e `6.1.x` `packs/_source/spells24`: `web.yml` (`phbsplWeb0000000`, difficultTerrain behavior), `slow.yml`
  (`phbsplSlow000000`, its three changes), `greater-restoration.yml` (`phbsplGreaterRes`).
- Homebrew (the campaign's C2 mechanics manifest, the DM's own text): Orog Haul (escape DC 14), Meld Ward (Con DC 15,
  6d6 Force, Restrained), Circle Failsafe (Dex DC 15, 4d10 Force, thrown 20 ft), Library Glyph (Dex DC 15, 5d8
  Thunder, 20 ft), Duct Crystal Node (Sleight of Hand DC 15, 2d8 Lightning). 5etools has no entry for these.

## Done
All new files are in `alivas-box-of-triggers/packs/_source/fixed-items/`. Every patch is version 1, live-tested
2026-11-23 (Foundry 14.370, dnd5e 6.1.1).

| File | Match | Mechanics |
|---|---|---|
| `eye-rays-beholder-mm-25-36.json` | name Eye Rays, feat, MM'25 p. 36 | **Eye Rays** utility (target 1 creature, 120 ft): `onUse` → `random` 1d10 gives the target a marker effect `Eye Ray: <ray>`; the marker's `applied` trigger runs that ray's save activity (DC 16) on its bearer, then removes itself. Rays: Charm (3d8 psychic, half; Charmed 1 h, ends when damaged), Paralyzing (Paralyzed 1 min, Con save at turn end), Fear (4d6 psychic, half; Frightened to end of next turn), Slowing (4d8 necrotic, half; movement ×0.5, `noReactions`, `actionOrBonus` to end of next turn), Enervation (3d8 poison, half; Poisoned + `noHealing` to end of next turn), Telekinetic (Str; `autoSave` Gargantuan; Restrained until the beholder's next turn; `onFail` `place` 30 ft), Sleep (`autoSave` Construct/Undead; Unconscious 1 min, ends when damaged), Petrification (Restrained; at its turn end `useActivity` "Petrification Ray (second save)" → Petrified on a failure; the Restrained effect then ends either way), Disintegration (8d8 force, half), Death (10d10 necrotic, half). |
| `web-phb-2024-340.json` | identifier web + PHB 2024 / dnd5e `phbsplWeb0000000` | Save activity with its own `area.triggers`: `areaEnter` / `areaTurnStart` (`oncePerTurn`) → `useActivity` (Dex vs spell DC) → **Restrained (Web)** (statuses `restrained`, `webbed`); `areaLeave` → `removeStatus webbed`. `autoSave` for creatures already `webbed` (no stacking). Difficult terrain behavior kept from the SRD item. Extra activities: **Burning Webs** (2d4 fire) and **Break Free** (check activity, Str (Athletics) vs spell DC). |
| `slow-phb-2024-318.json` | identifier slow + PHB 2024 / `phbsplSlow000000` | Targeted save (Wis) on up to 6 creatures (no template: a placed cube would take every creature inside, not "of your choice") → **Slowed**: AC −2, Dex saves −2, movement ×0.5 (the SRD's changes), `noReactions`, `actionOrBonus`; Wis save at turn end (`removeOnSuccess`); turn-start note "one attack only"; `spell` event with a somatic component → `random` 1d4, on a 1 gives "Slow: the spell fails" (a note). |
| `greater-restoration-phb-2024-281.json` | identifier greater-restoration + PHB 2024 / `phbsplGreaterRes` | Utility, touch: `removeStatus` charmed / petrified / cursed on the target, `choose: true`. |
| `spell-immunity-helmed-horror-mm-25-166.json` | name Spell Immunity, feat, MM'25 p. 166 | Transfer effect `ignoreDamageFrom` Heat Metal, Lightning Bolt, Magic Missile (identifier and name). |
| `haul-orog-sky-below.json` | name Haul, feat, owner **Orog** | Melee attack (Str, reach 5, no damage); on a hit **Grappled (Haul)**: tether `{ range: 5, drag: true, dc: 14 }`. `requires: { maxSizeAbove: 0 }` (Medium or smaller). |
| `meld-ward-sky-below.json` | name Meld Ward, feat | Transfer aura (5 ft, `areaEnter`; no `oncePerTurn`, which outside combat would let each creature trigger it only once per session) → save activity Con DC 15, 6d6 Force (half), **Restrained (Meld Ward)** (statuses `restrained`, `meld-bound`) with a turn-end note telling the DM to roll the repeat save. |
| `circle-failsafe-sky-below.json` | name Circle Failsafe, feat | Transfer aura (5 ft, `areaEnter`) → Dex DC 15, 4d10 Force (half); `onFail` `push` 20 ft from the trap token. |
| `library-glyph-sky-below.json` | name Library Glyph, feat | 1 use. Save activity, 20-ft-radius template on the trap token, Dex DC 15, 5d8 Thunder (half). The DM fires it by hand. |
| `duct-crystal-node-sky-below.json` | name Duct Crystal Node, feat | **Pass the Node** (check activity, Dex (Sleight of Hand) DC 15) and **Discharge** (2d8 Lightning damage activity). |

**Trap setup** (the trap patches): make an NPC actor (for example "Araj Wards"), give it an empty feat with the exact
patch name, and place its token at the spot (the door, the circle, the library door). The Box fills in the
mechanics. A ward is switched off during a dropout by disabling the item's aura effect.

**Trap actor:** the trap's own token sits inside the Library Glyph's 20-ft template, so it is also targeted and takes
the damage (the Engine targets a caster inside its own template). Give the trap actor immunity to Thunder, or ignore
its HP.

Checks:
- (offline) `node scripts/strip-rules-text.cjs --check` passes; `npm run pack` builds.
- (live 2026-11-23) All ten patches apply on actor creation (Patch on import) and load with every activity and
  effect intact.
- (live) **Eye Rays:** each ray was forced once (`formula` set to the number).
  - The marker effect is always removed.
  - 1: 3d8 psychic, Charmed 1 h; damage ends it.
  - 2: Paralyzed; the turn-end Con save fails and keeps it, then succeeds and ends it.
  - 3: 4d6 psychic, Frightened.
  - 4: on a success, half damage and no effect; on a failure, movement multiplier 0.5, `noReactions`,
    `actionOrBonus`, expiry turnEnd.
  - 5: Poisoned; 10 healing at 50 HP left it at 50.
  - 6: a Gargantuan target auto-succeeds; on a failure the target is placed 20 ft away (placement stubbed) and
    Restrained until `sourceStart`.
  - 7: an Undead target auto-succeeds; Unconscious (plus Prone) ends on damage.
  - 8: Restrained; at the end of its turn a second save; the failure gives Petrified and Restrained is gone.
  - 9 and 10: damage only.
- (live) **Web:**
  - A creature inside when it's cast gets no save.
  - Entering: Dex DC 15 (spell DC), Restrained (Web).
  - Turn start inside: a creature already webbed auto-succeeds (no stacking); a new one saves and is caught.
  - Leaving ends Restrained (Web).
  - Break Free is a Str (Athletics) DC 15 check card. Success doesn't end the effect; the DM removes it.
- (live) **Slow:**
  - The effect: AC −2, Dex save −2, multiplier 0.5.
  - Somatic spells roll 1d4 (a 1 posts "the spell fails"); verbal-only spells roll nothing.
  - Turn-start note; the turn-end Wis save ends it.
  - Fixed during the test: the 40-ft cube template took every creature inside it, including one not chosen. Slow is
    now targeted, up to 6.
- (live) **Greater Restoration:** on a Charmed + Petrified target the caster picks one and only that one ends.
- (live) **Spell Immunity:** Lightning Bolt and Magic Missile deal 0 to the Helmed Horror (chat says so); Fireball
  dealt 35.
- (live) **Haul:**
  - Hit at 1d20+4+PB; Grappled (Haul) with tether dc 14.
  - The Orog moves 10 ft and the target follows.
  - A Large target is refused ("too large").
- (live) **Meld Ward:**
  - Entering: Con DC 15, 6d6 Force, half on a success; Restrained (Meld Ward) on a failure.
  - Turn-end reminder note.
  - Disabling the aura removes its region.
  - Fixed during the test: `oncePerTurn` stopped a second entry outside combat; removed.
- (live) **Circle Failsafe:** Dex DC 15, 4d10 Force; on a failure the creature is pushed 20 ft away from the trap.
- (live) **Library Glyph:** a 20-ft template, Dex DC 15, 5d8 Thunder; the single use is spent and a second use is
  refused.
- (live) **Duct Crystal Node:** Pass the Node is a Dex (Sleight of Hand) DC 15 check card; Discharge posts its 2d8
  Lightning damage card.

## Left
1. Nothing to test. The engine gaps and blocked items below are future work.
2. Web outside combat: the Engine's area `oncePerTurn` keys on "no combat", so outside combat a creature triggers the
   web only on its first entry per session. In combat it works as written. Engine behaviour, not changed here.
3. **Assumptions** (all verified live 2026-11-23; kept for the record):
   - `onUse` → `random` → `giveEffect` onto a target the user doesn't own works through the GM relay, and the given
     effect's `applied` trigger runs on the GM.
   - `useActivity` from an effect given to another creature finds the beholder's item through `effect.origin`.
   - `traits.size` and `details.type.value` are in NPC roll data for `autoSave`, and `statuses.webbed` is in roll data
     as a count.
   - The `spell` event's filter data has `item.properties` (the Hidden effect relies on the same key).
   - dnd5e 6's `check` activity takes `check: { ability, associated, dc: { calculation, formula } }`.
   - Haul's attack bonus: a feat attack activity adds proficiency for an NPC (+6 for STR 18, PB 2).
4. **Engine gaps (not built,** by decision: no engine changes for now):
   - Meld Ward's three-successes / three-failures tally (a `save` tally option; 2024 *Flesh to Stone* needs it too).
   - The ward cycle (scheduled dropouts by day). Today the DM disables the wards' aura effects by hand. Freezing
     "ward-bound" creatures would need a scene-wide tag selector.
   - *Arcane lock* (a door that Pick Lock can't open; *knock* opens it).
   - Haul's "needn't spend extra movement" (a `freeDrag` option on tether). Today dragging costs extra as normal.
   - Eye Rays' "reroll a ray already used this turn": the DM rerolls by hand.
   - Greater Restoration's "1 Exhaustion level", ability score reduction and HP maximum reduction (`removeStatus`
     would clear all Exhaustion).
   - Slow's "one attack only" is a note, not enforced.
   - Meld Ward and the Circle Failsafe don't exclude Vizeran (the DM disables the effect); the Library Glyph's
     book-carried trigger is the DM's call.
5. **Blocked** (the campaign hasn't ruled yet): the drow block; which rays come through Shedrak's staff (its patch can
   reuse the Eye Rays pattern); the Troglodyte Champion conversion; S'slaar and the "stronger troglodytes";
   Karazikar's Antimagic Cone (removing it is deleting the item, no patch needed); guards and wards' Other effect on
   L2, L4 and L5.
6. **Stage:** no presets were added for these items (see T-016).

## Log
- 2026-11-23 — Claude (Opus 5.5): wrote the 10 patches above from 5etools and dnd5e 6.1.x data, generated with a
  script, using existing engine features only. No Foundry and no Node on this machine: nothing packed or tested.
- 2026-11-23 — Claude (Opus 5.5): live-tested all ten in Foundry 14.370 / dnd5e 6.1.1 on a throwaway ZZ scene. Fixed Slow (now targeted: the template caught creatures not chosen) and Meld Ward (dropped `oncePerTurn`). Status done.
