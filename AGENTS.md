# AGENTS.md — contributing to Alivas's Triggers

Guide for contributors and coding agents. Read it before changing anything; it explains what the two modules are, how
they're built, and the workflow every change follows.

---

## 1. What this is

Two Foundry VTT modules that bring PF2e-level automation to the **dnd5e** system, without midi-qol or DAE:

| Module | Folder / id | Job |
|---|---|---|
| **Alivas's Engine of Triggers** | `alivas-engine-of-triggers` | The code: triggers, reactions, the save/attack workflow, areas, creature pickers, the trigger editor UI. Knows nothing about specific spells. |
| **Alivas's Box of Triggers** | `alivas-box-of-triggers` | The content: a compendium of **patches** — item data (activities, effects, engine flags) the Box applies onto matching items in a world — plus weapon options. Almost no logic. |

**The core rule: Engine = mechanisms, Box = data.** Code that makes automation *possible* goes in the Engine and must
be generic and reusable (an event, an action, an effect rule, a selector option). Automating a *specific* spell,
feature, item or monster is done in the Box as a patch. Never put spell-specific code in the Engine; never put logic in
a patch.

**Reuse before adding.** Before writing a new engine piece, check whether existing pieces already cover it (events,
actions, effect rules, areas, the save routine). When something new is needed, build it as a general mechanism and
express the specific case as data. Example: Fireball is not special-cased — it is "an area that, when it appears,
resolves its activity's save on everyone inside, then removes itself if instantaneous".

Targets: **Foundry v14**, **dnd5e 6.x**, the **2024 rules** (2014 content should keep working where it can). Items
often arrive via Plutonium or the dnd5e SRD compendia, so patches match both.

---

## 2. Repository layout

```
AGENTS.md / CLAUDE.md      this guide (CLAUDE.md just imports it)
README.md, LICENSE         user docs (MIT)
package.json               npm scripts: pack, release, strip-rules-text
scripts/
  set-version.cjs          stamps version + manifest/download URLs into both module.json
  strip-rules-text.cjs     removes copyrighted rules text from pack sources (--check to verify)
  release.cjs              maintainer release script (§6)
alivas-engine-of-triggers/
  module.json              also declares documentTypes.RegionBehavior.area (the area behavior)
  scripts/main.mjs         events, trigger runner, ACTIONS, effect rules, damage pipeline, settings, api
  scripts/reactions.mjs    reaction windows (popups): hitBy, d20Succeeded, damageIncoming, spellCast, d20Rolling, hitting, leavesReach…
  scripts/creatures.mjs    geometry/vision, selectors, the creature picker, runAs (UI on another user's client), GM relays, lead-GM election
  scripts/workflow.mjs     save + attack workflow, the ONE save routine (rollSaveOutcome), evasion, the player save popup
  scripts/areas.mjs        automated areas (a Region behavior): appear / enter / leave / turn start / turn end
  scripts/editor.mjs       the trigger editor (ApplicationV2): triggers / reactions / activity / area modes
  styles/editor.css
alivas-box-of-triggers/
  module.json
  scripts/main.mjs         patch matching, buildPatched, Review & apply, auto-patch on create/import, weapon options, cast-links, school choice
  packs/_source/fixed-items/*.json     patch sources — one file per patch (the source of truth)
  packs/_source/weapon-options/*.json  weapon option carriers
  packs/<name>/            built LevelDB compendia (gitignored; `npm run pack`)
dist/                      release zips (gitignored)
```

Setup: `npm install`, then link (symlink / junction) `alivas-engine-of-triggers` and `alivas-box-of-triggers` into
your Foundry `Data/modules` folder. Code edits are live after reloading Foundry (F5); compendium changes need
`npm run pack` with Foundry closed.

Reading source is the fastest way to answer questions: dnd5e ships as one large `dnd5e.mjs` in its system folder, and
Foundry's client/common source is under the installation's `resources/app/`. Grep them.

---

## 3. How the Engine works

### Triggers (on effects)
An ActiveEffect carries `flags["alivas-engine-of-triggers"].triggers = [ { event, filter, action, then, label, … } ]`.
While the effect is active on a creature (the **bearer**), `fire(event, bearer, context)` runs matching triggers via
`runTriggerList` (filter → action → `then`).

* **event** (string or array). The bearer's own: attack, spell, activity, save, check, moved, rest, initiative, missed,
  dealt, damageRolled, collided, interval. Happens to the bearer: hit, damaged, statusGained, applied. Turns/rounds:
  turnStart, turnEnd, roundStart, roundEnd, sourceTurnStart, sourceTurnEnd. **Area**: areaCreated, areaEnter,
  areaLeave, areaTurnStart, areaTurnEnd.
* **filter**: a `dnd5e.Filter` array over roll data + event data. Always available: `sourceTurn`, `subjectIsSource`,
  `subjectIsSummoner`; per event: `amount`, `spellLevel`, `isSpell`, `identifier`, `duplicateDice`, `critical`,
  `attackType`, `longRest`/`shortRest`, …
* **action.type** (`ACTIONS` in main.mjs): save (the bearer, or `to` creatures; damage; failStatus), damage,
  activityDamage, useActivity, giveEffect, removeStatus, tempHp, recoverSlots, storeSpell, repeatActivity, drainMaxHp,
  inspire, swapInitiative, toggleLight, rollActivity, note, duplicates, restoreDuplicates.
* **then**: keep | remove | removeOnSuccess | removeOnFailure | removeWhenDepleted.
* Extras: `oncePerTurn` (area events), `every` (seconds of game time, for `interval`).
* Context carries `subject` (the triggering creature) and `targets`. Selectors (`to: { who: … }`) resolve against them:
  who = choose | all | self | bearer | source | subject | targets, plus range, `from: "subject"`, side, sight, pool,
  able, `self: false`, notSubject, count.

### Activity flags
`onUse` (actions right after use), `pay` (cost from several pools), `chooseEffects`, `targetFilter` (use this activity
automatically for a single matching target), `summonEffects` (effects placed on summoned creatures), `area.triggers`
(triggers for the template it places), `removeAfterUse` (stored spells).

### Effect rules (flags on effects, besides triggers)
noReactions, noComponents, askFirst, ignoreDamageFrom, attackAbilities / attackAbilitiesOnly, minLevel, saveDamage,
**area** `{ radius, color }` (a moving area around the bearer), stopOnCollision, onlyIf (auto-apply only to matching
targets), noHealing, dropSave (Undead Fortitude-style), evasion `[abilities]`, ownRollsOnly (roll bonuses don't reach
summons).

### Reactions (on items)
`flags["alivas-engine-of-triggers"].reactions = [ { window, who, outcome, cost, after, … } ]` — popups offered to the
right creature's controller at the right moment (Shield, Silvery Barbs, Counterspell, Divine Smite…). See the header of
reactions.mjs.

### Workflow (workflow.mjs)
World settings, separately for player-owned creatures and NPCs:
* **Save activities**: targeted → `resolveSave`; with a template → its **area** resolves it (areaCreated →
  useActivity). One damage roll, per-result multiplier (Evasion counts), effects on failure, a summary card.
* **Attacks** (off / attack / full): roll on use; *full* = damage on a hit, applied, then **rider saves** (the item's
  save activities with no activation of their own) against each creature hit.
* **One save routine**: `Workflow.rollSaveOutcome(actor, spec, label)` rolls on the creature's controller's client
  (player popup or automatic) and then lets reactions respond. Every save in the engine goes through it — don't add
  another.

### Areas (areas.mjs)
A Region with the behavior type `alivas-engine-of-triggers.area`. Foundry reports tokens entering/exiting (including
when the region moves) and starting/ending turns inside; `behaviorActivated` marks creation. Handled only on the lead
GM. Owners: an effect with the `area` rule (region attached to the bearer's token, moving with it) or an activity (its
template — the `dnd5e.createMeasuredTemplate` hook adds the behavior). The bearer and non-creatures are skipped.

### Multi-client rules (important)
* Anything that must happen once runs on the **lead GM** (`Creatures.isLeadGM()`, which works even with one GM account
  open in several windows).
* Players can't modify creatures they don't own: damage and effects go through GM relays (`applyDamageAs`,
  `Creatures.giveEffect`, socket messages).
* UI for a specific user (a player's popup) runs via `Creatures.runAs(user, handler, payload)`.

### Facts about dnd5e 6 / Foundry v14 worth knowing
* Spell templates are **Regions**. A new region's `tokens` list fills in late — test points with `region.testPoint`
  (see `tokenInRegion`). Regions can be attached to a token (`attachment.token`); the `emanation` shape is a radius
  around a token.
* `preMoveToken` can only reject a move. Foundry already stops tokens at hostile creatures (`movement.constrained`).
* Old effect keys are shimmed (`system.bonuses.msak.attack` → `system.rolls.attack.msak.bonus`).
* An upcast activity is an item copy with `flags.dnd5e.scaling`; `usageMessage.getAssociatedActivity()` returns it
  scaled.
* dnd5e resizes tokens on size changes itself. Transfer effects on unequipped or un-attuned (attunement "required")
  items are suppressed; items without the magical property don't show attunement.
* `dnd5e.postUseActivity` is called synchronously: set `usageConfig.subsequentActions = false` in it (before any
  `await`) to stop dnd5e's own follow-up roll.
* A combat may have no scene; resolve "whose turn is it" with `combatOf(actor)` (prefers the same scene's combat).

---

## 4. How the Box works

A patch is a full item document in `packs/_source/fixed-items/<file>.json` with
`flags["alivas-box-of-triggers"] = { version, match: [ keys… ] }`.

* **Match keys** — every field of a key must equal the item's: `name`, `type`, `book`, `page`, `compendiumSource`,
  `owner` (actor name), `identifier`. Use `identifier` for rules that are identical everywhere (Evasion, Undead
  Fortitude); `owner` when one item name means different things on different creatures (Life Drain on a Specter vs a
  Wight); `compendiumSource` for dnd5e SRD copies; `book` for Plutonium imports.
* **Applying** replaces mechanics (system data, effects, flags) and **keeps** the target's own description, image,
  uses spent, preparation, equipment and attunement state. So a patch can be built from any copy of the item.
* **Versioning**: bump `version` whenever a patch changes; Review & apply then offers it again.
* **Auto-patching**: items created or imported (`preCreateItem`), actors created with items (`preCreateActor` — so
  summons and dragged-in monsters are patched), Plutonium "update existing" (`updateItem`).
* **Review & apply** (module settings) patches items already in a world.
* **No rules text**: patches must not ship WotC or third-party text. Run `npm run strip-rules-text` after changing
  patches; `node scripts/strip-rules-text.cjs --check` must pass (the release refuses otherwise). Users keep their
  items' own descriptions, so nothing is lost.
* Two patches must not share an `_id` (packing fails). Compendium monsters sometimes share item ids — give the patch a
  unique one.

---

## 5. Workflow for every change

1. **Collect before designing.** Look at what exists: the item data, the exact rules text (the 2024 books; the
   5etools data on GitHub is a quick way to read it), and what dnd5e already does natively — often more than expected.
   Verify numbers; don't recall them.
2. **Design generically** (§1). Name the existing pieces you reuse.
3. **Implement.** `node --check <file>` every edited `.mjs`.
4. **Test live** (§7) with throwaway data. Report what was tested and what wasn't.
5. **Editor**: every engine capability must be reachable in the editor, round-trip cleanly
   (`converters.triggerToModel` → `modelToTrigger` returns the same data) and describe itself in plain English. Keep
   the UX clean and frictionless.
6. **Box**: express the specific case as a patch, strip rules text, bump the version, `npm run pack`.
7. Commit with a clear message.

---

## 6. Build and release

* Foundry must be **closed** to pack (LevelDB lock).
* `npm run pack` — rebuild both compendia from `packs/_source`.
* Releases are cut by the maintainer with `npm run release -- X.Y.Z` (stamps versions, checks rules text, packs,
  publishes the public repository, zips, creates the GitHub release with `<id>.zip` and `<id>.json`). Both modules
  share one version. Contributors: open a pull request instead.
* After a release, users update the modules, run **Review & apply** for items already in their worlds, and reload.

---

## 7. Testing

* Use a **test world** or throwaway scenes/actors — never a world with a game in progress. Name test documents so
  they're easy to find and delete (e.g. `ZZ …`), and delete them afterwards.
* If you test on a real character, snapshot its HP / slots / uses first and restore them; cast with
  `consume: { spellSlot: false }` and `concentration: { begin: false }` where possible.
* Placement clicks (templates, summons) can be stubbed for a test — restore the original in `finally`:
  ```js
  dnd5e.canvas.TemplatePlacement.prototype._place = async () => [{ type: "circle", x, y, radius, rotation: 0 }];
  dnd5e.canvas.TokenPlacement.prototype._place = async function() {
    return this.config.tokens.map((t, i) => ({ x, y, elevation: 0, level: canvas.level?.id, rotation: 0,
      prototypeToken: t, index: { total: i, unique: 0 } }));
  };
  ```
* A patch that isn't packed yet can be tried in the browser: fetch
  `/modules/alivas-box-of-triggers/packs/_source/fixed-items/<file>.json` and apply it with
  `game.modules.get("alivas-box-of-triggers").api.buildPatched({ data, version, keys: match }, item.toObject())`.
* Reaction popups (a nearby creature that could react) can delay a hit until answered or timed out — expected.
* Camera animations don't run in a hidden browser window; check state with console probes rather than screenshots.
