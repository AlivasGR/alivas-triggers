# T-026 — Factions: relations table, perspective colours, disposition sync, flanking (spec)

- **Status:** open (spec agreed with the maintainer on 2026-10-03; **don't implement until told**)
- **Foundry:** test
- **Owner:**
- **Area:** engine (factions; replaces the T-025 baseline's rules), Box (flanking setting only)

## Goal
Who fights whom is a **faction** (a letter A–Z) on every creature token. The GM sets how factions regard each other in
a per-scene **relations table**, with three relations shown as colours: **ally (green), neutral (yellow), hostile
(red)**. Everything in the engine that asks "ally or enemy?" reads the table, and Foundry's token disposition follows
it automatically. Setting up a normal fight takes zero clicks: the party is A, every NPC placed is B, A and B are
hostile. Complex encounters (a truce with the drow against demons, a traitor, a three-way fight) are a few clicks:
give some tokens a new letter and colour the table.

Builds on the `alliances` branch (T-025 baseline: letters on combatants, a tracker field, a sheet default, sides follow
letters, a picker override). T-025's rules are replaced by the ones below.

## Decisions (maintainer, 2026-10-03)

### Factions on tokens
- **Rename** "alliance" to **faction** everywhere in the UI, settings and API.
- **The letter lives on the token** (TokenDocument flag), not the combatant, so it works before and outside combat.
  These two edit the same value, GM only:
  - the combat tracker field;
  - a field on the token, shown when the GM clicks it (Token HUD).
- **Defaults when a token is placed:**
  1. **Sheet override:** the actor's default faction, set by the sheet's "Faction" button. It seeds the token when
     it's placed.
  2. **Player-owned creatures:** **A**, set by the setting `factionPC`.
  3. **Summons:** their summoner's letter, so a familiar or Find Steed isn't hostile to the party.
  4. **Any other NPC:** **B**.
  5. **No faction at all** for actors that aren't creatures: Item Piles loot piles, vehicles, group actors. They're
     never counted for or against anyone.
- **Changing sides later:** the GM edits the letter. That covers defections, betrayals, a spy's reveal and splitting a
  group. There are **no per-creature overrides, disguises or temporary hostility**; a new letter or a table edit
  covers each of those cases.

### Relations table, one per scene
- **Scene scope.** Letters are labels: "B" in the drow outpost and "B" in a city are different groups, so the table
  belongs to the scene. Store it as a scene flag. It persists across fights in that place and applies before
  initiative is rolled.
- **Defaults:**
  - a faction is always **ally** to itself (the diagonal, which can't be changed);
  - **A ↔ B hostile**;
  - **every other pair neutral** until the GM changes it.
- **GM-only window**, opened from the combat tracker header and the token field:
  - **cells:** a coloured square that cycles green → yellow → red on click;
  - **rows and columns:** only the letters in use on the scene, plus a "+" for preparing an empty faction;
  - **size:** the table grows with the number of factions;
  - **linked by default:** a click sets both directions (A→B and B→A). An **"Unlink"** toggle in the window allows
    asymmetric relations (row = "how this faction regards", column = "that faction");
  - **hover on a letter:** highlights that faction's tokens on the map;
  - **click on a letter:** keeps the highlight until clicked again. This is for spotting tokens left out of a faction;
  - **"Copy relations from scene…":** for recurring locations or factions.
- **The window edits the scene the GM is viewing.** The highlight needs the same scene.

### What reads the table
- **`relation(a, b)` (how a regards b):** the table cell for (faction(a), faction(b)). It drives everything that
  T-025 wired to alliances:
  - selector sides (ally / enemy / non-ally);
  - the filters `subjectIsAlly` / `subjectIsEnemy`;
  - reactions;
  - Opportunity Attacks: offered against hostile *and* neutral creatures leaving reach, never against allies. The
    setting "Opportunity Attacks against allies" stays;
  - Sneak Attack's ally-near check;
  - blocked-move offers;
  - flanking, below.
- **Pickers:** three colour chips (green, yellow, red), relative to the chooser.
  - Their defaults come from the selector: an ally-only picker starts with green on, enemies only with red on, "any"
    with all three.
  - The chooser can switch chips on, for example to Bless an enemy or Bane an ally.
  - This replaces T-025's "Include creatures outside this alliance" checkbox.
- **Movement:**
  - creatures your faction regards as ally never block you;
  - hostile ones block you even if they share your token disposition.

  This needs an occupancy check alongside dnd5e's disposition-based blocking (the follow-up T-025 left open).

### Disposition: derived from the table
- **Each token's Foundry disposition is written from the table as its relation from A, the party:**
  - A regards X as ally → **Friendly**;
  - neutral → **Neutral**;
  - hostile → **Hostile**.

  Foundry defines disposition as "relation to the players", and that's exactly the A row.
- **When it's written:** only when the GM changes a letter or the table. There are no event-driven disposition
  changes, so attacks never change anything by themselves.
- **Who writes it:** the lead GM, batched.
- **Why sync instead of ignoring disposition:**
  - dnd5e (movement blocking), Foundry (border colour, name and info visibility) and other modules (Item Piles, Token
    Action HUD, targeting helpers) read disposition;
  - syncing keeps all of them consistent with the table, with one source of truth.
- **Secret tokens are never rewritten.** Secret means "hide this token's identity", not a relation.
- **There are no other exceptions.** A spy or traitor is marked with the faction they're *acting as*, and switched
  when revealed.

### Colours each viewer sees (local rendering)
- **Borders are drawn per viewer** from the table, seen from a **perspective faction**. Override the token's border
  colour client-side; nothing is written.
- **The perspective is the faction of the tokens the user is controlling.** If those are in mixed factions, or none
  is selected, it falls back:
  1. the user's assigned character's faction;
  2. else the faction most of their owned tokens share;
  3. else A.
- **The GM:** the same rule. With nothing selected the GM sees A's view ("what the players see").
- **A small badge** on the selected token shows the active perspective letter.
- **Players in A see exactly the stored disposition colours.** Only a player controlling a token of another faction
  (a dominated creature, say) sees a different picture.
- **The letters and the table stay GM-only.** Players only see colours.

### Conditions
- **Dominate (Person / Monster):** the target **joins the source's faction** while the effect lasts. This is a new
  effect rule (e.g. `faction: "source"`) and the Box patches use it. When the effect ends, the target's previous letter
  is restored.
- **Charmed: no faction change.** The charmed creature can't attack or target the charmer with harmful abilities.
  That's a targeting restriction (the charmer is excluded from its hostile pickers and attacks), not a relation.

### Flanking (2014 DMG p. 251; there's no flanking rule in the 2024 DMG)
- **Setting `flanking`:** Off / **Advantage** (DMG, the default) / **+2 to hit** / **Custom modifier** (a formula).
  It goes in Automation settings → Attacks.
- **The rule, on squares:**
  - an attacker and at least one creature its faction regards as **ally** are both adjacent to an enemy, on
    opposite sides or corners of its space;
  - the test: the line between the two creatures' centres passes through opposite sides or corners of the enemy's
    space;
  - **only melee attack rolls** against that enemy get the benefit;
  - a creature can't flank an enemy it can't see (`Creatures.canSee`), and can't flank while Incapacitated;
  - a Large or larger creature flanks if any one square of its space qualifies.
- **"Enemy":** a target the attacker's faction regards as hostile.
- **The hex variant** from the same DMG section (count hexes around the enemy by its size) is out of scope until
  someone plays on hexes.

### Dropped (considered, not needed)
- Bystander or persistent-neutral relations: an all-neutral faction does it.
- Per-creature overrides: give the creature its own letter.
- Combat-scoped temporary hostility: edit the table or the letter.
- "Disguised as": a spy is marked as what they act as and switched on reveal.
- World- or combat-scoped tables, persistent named factions, parent factions, numeric relation scales.

## Example (the design test)
- **Setup:** the party (A) escapes drow captivity. Demons (C) attack the drow outpost (B). One drow (Veth) only looks
  after himself.
- **Before the demons:** the table is the default (A ↔ B hostile). Demons placed later are B, so give them C. They
  start neutral to everyone, so the GM sets C hostile to A and to B.
- **The truce:** set A ↔ B to neutral, or to ally. Dispositions follow: the drow turn yellow or green for the players.
  - Unlink if the drow only tolerate the party while the party fully helps them: A→B ally, B→A neutral.
- **Veth:** stays B while cooperating. On the betrayal, the GM gives him D and sets D hostile to B (and to A, if he
  turns on everyone).
- **After the fight:** the table stays as the scene's state. The GM sets A ↔ B back to hostile if the truce ends.

## Implementation plan (when approved)
1. **Data:**
   - the token flag `faction`;
   - the actor flag `faction` (seed);
   - the scene flag `relations` (`{ "A": { "B": "hostile" } }`, directional; missing cells use the defaults);
   - `factionOf(token)`, `relation(a, b)` and `perspective(user)`.
   - Migrate T-025's combatant and actor flags.
2. **Seeding** on `createToken` (lead GM): the sheet seed → player-owned A → summoner's letter → B; none for
   non-creatures.
3. **Disposition sync** (lead GM, batched) on letter or table changes. Skip Secret tokens.
4. **UI:**
   - the tracker field and the Token HUD field (GM);
   - the sheet "Faction" button;
   - the relations window (colour cells, link toggle, hover and pinned highlight, "+", copy from scene).
5. **`relation()` integration:** replace T-025's same-letter rule everywhere it was wired.
6. **Pickers:** colour chips instead of the "include others" checkbox.
7. **Perspective border colours:** override the token border colour, add the perspective badge, and refresh on
   control changes.
8. **Movement:** an occupancy check so hostile factions block, and allies never do.
9. **Dominate:** the effect rule `faction: "source"` (and restore), plus the Box patches. **Charm:** exclude the
   charmer from the charmed creature's hostile pickers and attacks.
10. **Flanking:** the geometry on squares, the setting (off / advantage / +2 / custom), and the attack-roll hook
    (dnd5e `preRollAttackV2`, melee only). A short chat or roll note says "flanking".
11. **Editor and docs:** AGENTS.md §4, README, and an editor field for the `faction` effect rule.

## Acceptance (live, when built)
- [ ] A new scene: place a PC, an NPC and a familiar summoned by the PC. They get A, B and A. A loot pile gets no
      letter. The default table shows A ↔ B red and A↔A / B↔B green.
- [ ] A sheet seed of "C" on an NPC: the placed token is C, and C is yellow to everyone.
- [ ] Table:
  - cycling a cell changes both directions while linked, and only one when unlinked;
  - the diagonal is locked;
  - the table grows when a letter is added;
  - hovering a letter highlights its tokens, and clicking pins the highlight.
- [ ] Disposition sync:
  - setting A ↔ B to neutral turns B tokens Neutral;
  - a Secret token isn't touched;
  - nothing changes when a creature attacks.
- [ ] Perspective colours:
  - the player selects their PC (A) and B tokens show red;
  - the same player selects a dominated creature in C and colours change to C's view;
  - with mixed selection, the fallback is the assigned character;
  - the GM with nothing selected sees A's view.
- [ ] Pickers:
  - Bless (an ally-only picker) starts with green on;
  - switching on red lists hostiles, and a hostile can be picked.
- [ ] Opportunity Attacks: offered against hostile and neutral creatures leaving reach, not against allies. The
      "against allies" setting adds the ally case.
- [ ] Movement: an ally-faction creature with a Hostile disposition doesn't block. A hostile-faction creature with a
      Friendly disposition does.
- [ ] Dominate: the target joins the caster's faction, and returns to its old letter when the effect ends. Charm: the
      charmer is missing from the charmed creature's hostile pickers.
- [ ] Flanking:
  - opposite sides → advantage, and opposite corners → advantage, on melee attacks only;
  - not when the flanker can't see the enemy or is Incapacitated;
  - a Large ally flanks via any of its squares;
  - the +2 option adds +2, a custom formula applies, and Off does nothing.
- [ ] Setting factions off: everything falls back to dispositions, with no fields or windows.

## Sources
- 2014 DMG p. 251, Flanking (5etools `variantrules.json`, source DMG). There's no flanking rule in the 2024 DMG
  (XDMG).
- Market research: Baldur's Gate 3's faction system (Larian modding docs: SetFaction, SetRelation, SetIndividualRelation,
  SetRelationTemporaryHostile; bg3.wiki Hostile, Dominate Person, Charmed). It confirmed the split between the public
  colour and the hidden relation, directional relations, a small set of relation values, and that Dominate changes
  side while Charm doesn't.

## Log
- 2026-10-03 — Claude (Opus) with the maintainer: design converged through brainstorming. This spec records every
  decision. Nothing is implemented beyond T-025's baseline on this branch.
