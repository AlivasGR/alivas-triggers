# T-030 — Sky Below Chapter 2 (Wormwrithings / Araj): Box patches from existing engine features

- **Status:** needs-live-test
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
All new files are in `alivas-box-of-triggers/packs/_source/fixed-items/`. Every patch is version 1 and **untested**.

| File | Match | Mechanics |
|---|---|---|
| `eye-rays-beholder-mm-25-36.json` | name Eye Rays, feat, MM'25 p. 36 | **Eye Rays** utility (target 1 creature, 120 ft): `onUse` → `random` 1d10 gives the target a marker effect `Eye Ray: <ray>`; the marker's `applied` trigger runs that ray's save activity (DC 16) on its bearer, then removes itself. Rays: Charm (3d8 psychic, half; Charmed 1 h, ends when damaged), Paralyzing (Paralyzed 1 min, Con save at turn end), Fear (4d6 psychic, half; Frightened to end of next turn), Slowing (4d8 necrotic, half; movement ×0.5, `noReactions`, `actionOrBonus` to end of next turn), Enervation (3d8 poison, half; Poisoned + `noHealing` to end of next turn), Telekinetic (Str; `autoSave` Gargantuan; Restrained until the beholder's next turn; `onFail` `place` 30 ft), Sleep (`autoSave` Construct/Undead; Unconscious 1 min, ends when damaged), Petrification (Restrained; at its turn end `useActivity` "Petrification Ray (second save)" → Petrified on a failure; the Restrained effect then ends either way), Disintegration (8d8 force, half), Death (10d10 necrotic, half). |
| `web-phb-2024-340.json` | identifier web + PHB 2024 / dnd5e `phbsplWeb0000000` | Save activity with its own `area.triggers`: `areaEnter` / `areaTurnStart` (`oncePerTurn`) → `useActivity` (Dex vs spell DC) → **Restrained (Web)** (statuses `restrained`, `webbed`); `areaLeave` → `removeStatus webbed`. `autoSave` for creatures already `webbed` (no stacking). Difficult terrain behavior kept from the SRD item. Extra activities: **Burning Webs** (2d4 fire) and **Break Free** (check activity, Str (Athletics) vs spell DC). |
| `slow-phb-2024-318.json` | identifier slow + PHB 2024 / `phbsplSlow000000` | Save (Wis) on up to 6 creatures → **Slowed**: AC −2, Dex saves −2, movement ×0.5 (the SRD's changes), `noReactions`, `actionOrBonus`; Wis save at turn end (`removeOnSuccess`); turn-start note "one attack only"; `spell` event with a somatic component → `random` 1d4, on a 1 gives "Slow: the spell fails" (a note). |
| `greater-restoration-phb-2024-281.json` | identifier greater-restoration + PHB 2024 / `phbsplGreaterRes` | Utility, touch: `removeStatus` charmed / petrified / cursed on the target, `choose: true`. |
| `spell-immunity-helmed-horror-mm-25-166.json` | name Spell Immunity, feat, MM'25 p. 166 | Transfer effect `ignoreDamageFrom` Heat Metal, Lightning Bolt, Magic Missile (identifier and name). |
| `haul-orog-sky-below.json` | name Haul, feat, owner **Orog** | Melee attack (Str, reach 5, no damage); on a hit **Grappled (Haul)**: tether `{ range: 5, drag: true, dc: 14 }`. `requires: { maxSizeAbove: 0 }` (Medium or smaller). |
| `meld-ward-sky-below.json` | name Meld Ward, feat | Transfer aura (5 ft, `areaEnter`, `oncePerTurn`) → save activity Con DC 15, 6d6 Force (half), **Restrained (Meld Ward)** (statuses `restrained`, `meld-bound`) with a turn-end note telling the DM to roll the repeat save. |
| `circle-failsafe-sky-below.json` | name Circle Failsafe, feat | Transfer aura (5 ft, `areaEnter`) → Dex DC 15, 4d10 Force (half); `onFail` `push` 20 ft from the trap token. |
| `library-glyph-sky-below.json` | name Library Glyph, feat | 1 use. Save activity, 20-ft-radius template on the trap token, Dex DC 15, 5d8 Thunder (half). The DM fires it by hand. |
| `duct-crystal-node-sky-below.json` | name Duct Crystal Node, feat | **Pass the Node** (check activity, Dex (Sleight of Hand) DC 15) and **Discharge** (2d8 Lightning damage activity). |

**Trap setup** (the trap patches): make an NPC actor (for example "Araj Wards"), give it an empty feat with the exact
patch name, and place its token at the spot (the door, the circle, the library door). The Box fills in the
mechanics. A ward is switched off during a dropout by disabling the item's aura effect.

Checks run here:
- (offline) Every file parses.
- (offline) Activity keys equal their `_id`.
- (offline) No duplicate item or effect ids.
- (offline) A Python port of `strip-rules-text --check` (450-character limit, copied markup) passes.

Not run here:
- `npm run strip-rules-text`, `--check` and `npm run pack`: there is no Node.js on the machine this was written on.

## Left
1. **Pack and lint:** run `npm run strip-rules-text`, then `node scripts/strip-rules-text.cjs --check`, then
   `npm run pack` (Foundry closed).
2. **Live tests** (throwaway `ZZ` scene and actors):
   - [ ] **Eye Rays** (Plutonium-imported 2025 Beholder `ZZ Beholder` vs `ZZ Target`): target, use Eye Rays → a d10
     card, then the ray's save card at DC 16. Force each result once (temporarily set `formula` to the number):
     - [ ] 1: half 3d8 psychic on a success; Charmed 1 h on a failure, ending when it takes damage.
     - [ ] 2: Paralyzed; a Con save at each turn end ends it.
     - [ ] 4: speed halved, no reaction prompt, Action or Bonus Action only, through the end of its next turn.
     - [ ] 5: healing is blocked while Poisoned.
     - [ ] 6: a Gargantuan target auto-succeeds; on a failure the GM is asked to place the target within 30 ft and it
       is Restrained until the beholder's next turn.
     - [ ] 7: an Undead target auto-succeeds; Unconscious ends when damaged.
     - [ ] 8: Restrained; at the end of its next turn a second Con save; a failure gives Petrified, and Restrained is
       gone either way.
     - [ ] 9 and 10: damage only.
     - [ ] The marker effect `Eye Ray: …` never stays on the target.
   - [ ] **Web:** cast on an empty spot, then move `ZZ Target` in: Dex save, Restrained (Web) on a failure. Start its
     turn inside: no second effect (`webbed` auto-succeeds). Move it out: Restrained (Web) ends. Creatures inside when
     the web is cast get no save until they enter or start a turn. Break Free rolls Athletics vs the caster's DC.
   - [ ] **Slow:** 6 targets. Failures get AC −2, Dex save −2, half speed, no reactions, Action or Bonus Action. Wis
     save at each turn end. Casting Fire Bolt (somatic) while Slowed rolls 1d4 and notes "the spell fails" on a 1;
     casting a spell with no somatic component rolls nothing.
   - [ ] **Greater Restoration** on a Petrified + Charmed target: the caster picks one and it ends.
   - [ ] **Spell Immunity:** Magic Missile and Lightning Bolt deal 0 to a Helmed Horror; a Fireball still hurts.
   - [ ] **Haul** (actor named exactly `Orog`, feat "Haul"): a hit gives Grappled (Haul) with escape DC 14; Escape
     Grapple rolls vs 14; the orog drags the target as it moves; a Large target is refused.
   - [ ] **Meld Ward:** a token stepping next to the trap token rolls Con DC 15, takes 6d6 Force (half on a success),
     and is Restrained on a failure; a turn-end note appears. Disabling the aura effect removes the area.
   - [ ] **Circle Failsafe:** stepping in → Dex DC 15, 4d10 Force (half); on a failure the creature is pushed 20 ft
     away from the trap token.
   - [ ] **Library Glyph:** use it → a 20-ft template on the trap token, Dex saves for everyone inside, 5d8 Thunder
     half on a success; the use is spent.
   - [ ] **Duct Crystal Node:** Pass the Node prompts a DC 15 Sleight of Hand; Discharge rolls 2d8 Lightning.
3. **Assumptions** (unverified):
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
