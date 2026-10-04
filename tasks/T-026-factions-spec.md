# T-026 — Factions: relations table, perspective colours, disposition sync, flanking (spec)

- **Status:** needs-live-test (live test 2026-10-04: all pass except perspective colours, see Left)
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

## Done (2026-10-04, offline: `node --check`, strip check)
- `factions.mjs` replaces T-025's `alliances.mjs`. It has:
  - resolution (effect rule `faction` → token flag → default);
  - stamping on `createToken` (lead GM, 400 ms later so summon flags are in place);
  - the per-scene table API, with linked edits by default (`setRelation`);
  - disposition sync (lead GM, batched; Secret skipped; on letter, table, faction-effect changes and once at ready);
  - per-viewer border colours (wraps `Token#getDispositionColor`; Secret and non-creatures as Foundry draws them);
  - `perspective()`;
  - the GM fields: the tracker letter (coloured by the party's relation), the Token HUD letter and table button, and
    the sheet "Faction" seed dialog;
  - Charmed: attack rolls against the charmer are refused.
- `factions-window.mjs` (Sonnet agent): the relations window. It has:
  - colour cells that cycle;
  - the locked diagonal;
  - a "Linked" checkbox;
  - "+" for an empty faction;
  - copy from another scene;
  - letter headers with token counts, where hover highlights and a click pins rings on the map.
- `flanking.mjs` (Sonnet agent): the 2014 DMG rule on squares. Pure geometry is in `flankingCells` (Node-tested: 7
  cases), with relation, sight and Incapacitated checks. The settings `flanking` (off / advantage / plus2 / custom)
  and `flankingFormula` apply at `dnd5e.preRollAttackV2`; the flavor gets " (flanking)". It works with exactly one
  target, and skips thrown attack modes.
- `creatures.mjs`:
  - pickers show colour chips (ally / neutral / hostile, relative to the chooser), preset from the selector side;
  - a charmer is left out of the charmed creature's hostile picks;
  - `charmersOf`.
- `maneuvers.mjs`, with factions on:
  - dnd5e's blocking and difficult-terrain lists are rebuilt from the table (hostile blocks; non-allies are difficult
    terrain), keeping dnd5e's exceptions and pass-through permissions;
  - blocked-move offers use the table.
- `reactions.mjs`: Sneak Attack's ally check is "ally of the attacker"; Opportunity Attacks use the table.
- The editor: the effect rule "While it lasts, the bearer belongs to: own / source's / faction…".
- Settings: `factions`, `factionPC`, `factionOaAllies` (Combat), `flanking`, `flankingFormula` (Attacks).
- Box: `dominate-beast` / `dominate-person` / `dominate-monster` (PHB 2024; SRD compendiumSource keys) v1. Their
  "Dominated" effect (Charmed) has `faction: "source"`.
- AGENTS.md §4 and the README updated.

**Deviations from the spec:**
- The perspective badge on the selected token isn't built. The relations window shows "Map colours are shown as seen
  by: X" instead.
- Unlinking is a "Linked" checkbox.
- T-025's combatant and actor flags aren't migrated, because T-025 was never released (it existed only on this branch).

## Acceptance (live)
Live test 2026-10-04 (headless Foundry v14, dnd5e 6.0.5, scene "ZZ Factions", GM + player tabs).
- [x] (live 2026-10-04) A new scene: PC -> A, NPC -> B, familiar (actor with `flags.dnd5e.summon.origin` = PC's spell item; not a
      real Find Familiar cast) -> A, Item Pile token -> no letter (and no flag). Default table: A<->B hostile, A<->A / B<->B ally.
- [x] (live 2026-10-04) Sheet seed "C" (api.setSeed): the placed token is C, disposition Neutral, C neutral to A and B.
- [x] (live 2026-10-04) Table: cycling a cell changes both directions while linked, one while unlinked; diagonal cells are
      disabled (locked); "+" adds a row and column (D); hovering a letter draws a ring on the map (PIXI Graphics added on
      canvas.controls, removed on leave), clicking pins it, clicking again unpins. Copy from scene (window + confirm) copies the
      table and the link state. First open of the window throws (see Left, 1).
- [x] (live 2026-10-04) Disposition sync: A<->B ally/neutral/hostile -> B token Friendly/Neutral/Hostile; Secret token kept
      (-2) through every change; two attacks (one rolled) changed no dispositions. Tracker letter field and Token HUD field+button
      edit the flag and re-sync.
- [ ] Perspective colours: **FAIL** as built: `Token#getDispositionColor` is never wrapped (see Left, 2). With the wrapper
      emulated by hand (same code) the logic passed: player selecting PC (A) -> B red; selecting a C token -> A red, B yellow;
      GM with nothing selected -> A's view. Mixed-selection fallbacks and GM selection: SKIPPED (the perspective rule changed
      on 2026-10-04; retest after the rewrite). The perspective badge is not built (known deviation).
- [x] (live 2026-10-04) Pickers: an ally-only picker starts with only the green chip on (3 allies shown, hostile/neutral rows
      hidden); switching red on lists the hostiles; a hostile and an ally were picked and returned. Chips relative to the
      chooser. Side note in Left, 3 (loot pile listed as a neutral pick).
- [x] (live 2026-10-04) Opportunity Attacks: popup offered for a hostile (A leaving B's reach) and a neutral (C leaving B) mover;
      none for an ally (B leaving B); with `factionOaAllies` on the ally popup appears ("(an ally)").
- [x] (live 2026-10-04) Movement (player client, real `token.move`): an A-faction token with Hostile disposition did not block
      an A mover (reached the destination); a B-faction token with Friendly disposition blocked (stopped on the adjacent
      square). Control with factions off: the Hostile-disposition A token blocked (stopped adjacent).
- [x] (live 2026-10-04) Dominate: Box "Dominate Person" cast, forced failed save: target B -> E (the caster's letter) while
      "Dominated" lasts, back to B when the effect is deleted. Charm: a Charmed target's attack on its charmer is refused with
      "is Charmed by ... and can't attack it."; the charmer is missing from the charmed creature's hostile picker (present
      without the effect). Disposition sync on the dominated token was not checked (the target was Secret).
- [x] (live 2026-10-04) Flanking (Advantage): opposite sides and opposite corners -> advantage with "(flanking)" in the flavor;
      adjacent sides / non-opposite corners -> none; ranged weapon -> none; ally Incapacitated -> none; Large ally flanks via
      a side square and via a corner-only square, not when not adjacent; ally behind a wall (token vision on) cannot flank;
      +2 -> formula `1d20 + 2 + 2 + 2`; custom `1d4` -> `1d20 + 1d4 + 2 + 2`; Off -> nothing. Not verified: attacker Incapacitated
      (the attack was allowed and still got no flanking; dnd5e doesn't stop the attack, so that is the engine's check working).
      Not verified: attacker unable to see the target (only the ally side).
- [x] (live 2026-10-04) Setting factions off: sides fall back to dispositions, no tracker field/button, no Token HUD field. (The API
      `openWindow` still opens a window when off; harmless.)
- [x] (live 2026-10-04) GM-only: the player client has no tracker fields, HUD fields or relations button; openWindow warns.

## Left (live test 2026-10-04)
1. **Relations window: first open throws.** `openRelationsWindow` (factions-window.mjs) calls `app.bringToFront?.()` right after
   `app.render({ force: true })` without awaiting; `ApplicationV2#bringToFront` reads `this.element.style`, which doesn't exist yet
   on the first open -> `TypeError: Cannot read properties of undefined (reading 'style')`. The window still renders (the throw is
   after render started) but the click handler throws. Fix: `await app.render({force:true})` before `bringToFront`, or call it only if
   `app.rendered`.
2. **Border colours never applied.** `registerFactions()` runs inside main.mjs's `Hooks.once("ready")` (line ~3197), but the
   `Token#getDispositionColor` wrapper is installed in `Hooks.once("setup", ...)` inside it, which never fires. Observed: on both clients
   `Token5e.prototype.getDispositionColor` is Foundry's original (a B token is Hostile red whatever the perspective). Fix: install the
   wrapper directly (or register it at module load / `init`) instead of inside `setup` from a ready callback. The wrapper's logic was
   verified by installing the same code by hand: perspective C -> B yellow, A red.
3. **Loot pile listed in pickers.** `findCreatures` (creatures.mjs) has no creature check, so an Item Piles actor (no faction) is listed
   as a "neutral" pick with side any. Observed in the Bless picker (neutral chip). Expected: never counted for or against anyone.
   Fix: skip actors where `!system.isCreature` / item-pile flag.
4. Test caveat: with the pane hidden `TokenDocument#x/y` lag after a teleport (animation never ends), so flanking/OA geometry reads
   stale positions unless `token.object.stopAnimation()` is called. Not an engine bug, but it could bite headless tests.
5. Perspective rule changed 2026-10-04 (sticky last-clicked token; GM always A): mixed-selection / GM fallbacks to be retested by the main thread.

## Sources
- 2014 DMG p. 251, Flanking (5etools `variantrules.json`, source DMG). There's no flanking rule in the 2024 DMG
  (XDMG).
- Market research: Baldur's Gate 3's faction system (Larian modding docs: SetFaction, SetRelation, SetIndividualRelation,
  SetRelationTemporaryHostile; bg3.wiki Hostile, Dominate Person, Charmed). It confirmed the split between the public
  colour and the hidden relation, directional relations, a small set of relation values, and that Dominate changes
  side while Charm doesn't.

## Log
- 2026-10-04 — Sonnet live test (headless v14, GM + player tabs): everything passes except perspective border colours (wrapper never installed), plus a first-open TypeError in the relations window and loot piles in pickers; see Left.
- 2026-10-04 — Claude (Opus) + 2 Sonnet agents (window, flanking): built offline as above; awaiting a live test.
- 2026-10-03 — Claude (Opus) with the maintainer: design converged through brainstorming. This spec records every
  decision. Nothing is implemented beyond T-025's baseline on this branch.
