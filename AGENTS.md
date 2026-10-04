# AGENTS.md — working on Alivas's Triggers

Read this before changing anything. It tells you what the two modules are, where the rules come from, how to work
**with or without a Foundry VTT install**, and how to leave work for the next person.

> **First, check for a `.git` folder in the repo root.** If there isn't one, or the user can't use GitHub, this is an
> offline contribution. Follow [.claude/skills/offline-contribution/SKILL.md](.claude/skills/offline-contribution/SKILL.md)
> yourself, end to end:
> 1. Run `npm run contrib -- setup --name "<their name>"` **before your first edit**.
> 2. Recommend 3 to 5 tasks from the list it prints, then `claim` the one the user picks.
> 3. Work as this guide says.
> 4. Run `npm run contrib -- pack --title "…"`.
> 5. End with the skill's hand-off message: the path of the file in `send-to-alivas/`, and that it goes to Alivas.
> Run setup at the start of every session; it's safe to repeat. If you were only given the GitHub link, the skill's
> step 1 downloads the code (no account needed).

Quick links: [tasks/](tasks/README.md) (open work, handoffs) · [.claude/skills/](.claude/skills/) (step-by-step
recipes for repeated jobs) · [README.md](README.md) (user docs).

---

## 1. What this is

Two Foundry VTT modules that bring PF2e-level automation to the **dnd5e** system (no midi-qol / DAE):

| Module | Folder / id | Job |
|---|---|---|
| **Alivas's Engine of Triggers** | `alivas-engine-of-triggers` | The code: triggers, reactions, the save/attack/heal workflow, areas, weapon masteries, creature pickers, the editor UI, settings. Knows nothing about specific spells. |
| **Alivas's Box of Triggers** | `alivas-box-of-triggers` | The content: a compendium of **patches** (item data + engine flags) applied onto matching items in a world, plus weapon options. Almost no logic. |

**Engine = mechanisms, Box = data.** Code that makes automation *possible* is generic and reusable (an event, an
action, an effect rule, a reaction option). Automating a *specific* spell / feature / item / monster is a Box patch.
Never put spell-specific code in the Engine; never put logic in a patch.

**Reuse before adding.** Check the existing pieces (§4) first. When something new is needed, build it as a general
mechanism and express the case as data. Every engine capability must also be reachable in the editor UI.

Targets: **Foundry v14**, **dnd5e 6.x**, the **2024 rules** (2014 content keeps working where it can; never silently
turn 2014 content into 2024).

---

## 2. Rules source (verify, don't recall)

1. **5etools is the official source for 2024 rules text and numbers**: <https://5e.tools/>. The raw data is in the
   GitHub mirror `5etools-mirror-3/5etools-src`, folder `data/` (`class/class-<name>.json`, `spells/spells-xphb.json`,
   `bestiary/bestiary-xmm.json`, `items.json`, `races.json`, `backgrounds.json`, `feats.json`,
   `optionalfeatures.json`, `foundry-*.json` = Plutonium's automation data). Fetch the JSON; grep for the entry.
2. Inside Foundry the same data arrives through **Plutonium** (it imports from 5etools); items imported that way carry
   `system.source.book` like `PHB 2024` / `MM'25` and `flags.plutonium`.
3. dnd5e's own SRD 2024 compendia (`foundryvtt/dnd5e` repo, `packs/_source/classes24`, `spells24`, `feats24`,
   `origins24`, `actors24`, `equipment24`…) are the source for **item data structure** (activities, effects) and for
   SRD copies users may have.
4. Go outside 5etools **only** if it explicitly doesn't have the answer (homebrew, third-party). Say where the text came
   from in the task log.

Never ship rules text: patches keep the user's own item description (see §5).

---

## 3. Repository layout

```
AGENTS.md / CLAUDE.md      this guide (CLAUDE.md imports it)
tasks/                     open work, handoffs, work logs — one file per task (tasks/README.md = index + template)
.claude/skills/            recipes for repeated jobs (new-patch, live-test, handoff, character-pass, offline-contribution)
README.md, LICENSE         user docs (MIT)
package.json               npm scripts: pack, release, strip-rules-text, contrib
scripts/                   set-version.cjs, strip-rules-text.cjs, release.cjs (maintainer), contrib.cjs (offline bundles)
alivas-engine-of-triggers/
  module.json              also declares documentTypes.RegionBehavior.area
  scripts/main.mjs         events, trigger runner, ACTIONS, effect rules, damage pipeline, masteries, settings, api
  scripts/reactions.mjs    reaction windows and popups
  scripts/creatures.mjs    geometry/vision, selectors, creature picker, runAs, GM relays, lead-GM election
  scripts/workflow.mjs     save / attack / heal workflow, the ONE save routine, evasion, follow-up attacks
  scripts/areas.mjs        automated areas (Region behavior): appear / enter / leave / turn start / turn end
  scripts/editor.mjs       trigger editor (triggers / reactions / activity / area modes), sheet summaries
  scripts/settings-app.mjs the grouped "Automation settings" window
  scripts/settings.mjs     registers the table-ruling settings (bodies, trading, cover, economy, locks); read with opt(key)
  scripts/maneuvers.mjs    2024 maneuvers: holds (tether), pass-through, check/place/escape actions, requirements, blocked-move offers
  scripts/loot.mjs         Item Piles integration: drops (2024 timing), disarm, pile images, locks on piles and doors
  scripts/economy.mjs      action economy per combat turn: Action, Bonus Action, free object interaction, Utilize, Fast Hands
  scripts/interact.mjs     token interactions registry: right-click menu (non-owners) + Token HUD buttons (owners/GM)
  scripts/bodies.mjs       carry bodies (container item), put down, loot the unconscious, pickpocket
  scripts/trade.mjs        hand over / throw / catch items (2024 + house ruling), retrieving from containers
  scripts/skills.mjs       skill checks with another ability (sheet menu + rollSkillWith for triggers)
  scripts/cover.mjs        Half / Three-Quarters cover on attacks (dialog + after-roll buttons with undo), ignoreCover
alivas-box-of-triggers/
  scripts/main.mjs         patch matching, buildPatched, Review & apply, auto-patch on create/import, weapon options
alivas-stage-of-triggers/  animations + sounds (Sequencer; JB2A / PSFX); requires the Engine and Sequencer
  scripts/cues.mjs         cue format (steps: onToken/projectile/melee/impact/area/aura/teleport/sound) + Sequencer player
  scripts/sources.mjs      where cues come from (item/effect flags, presets, conditions, engine actions, moves), dnd5e
                           hooks, Automated Animations hand-off + whole-word match guard
  scripts/cue-editor.mjs   cue editor, item / effect animation windows, condition + move settings windows
  scripts/picker.mjs       animation/sound browser (search, filters, recommendations, previews)
  scripts/catalog.mjs      catalog built from Sequencer's database: families, search, recommend (no Foundry needed)
  presets/box.json         cues for Box items (name + type match); presets/statuses.json — conditions
  packs/_source/fixed-items/*.json     patch sources (source of truth)
  packs/_source/weapon-options/*.json
  packs/<name>/            built compendia (gitignored; `npm run pack`)
```

`npm install` once. Build compendia with `npm run pack` (Foundry must be **closed** if it's running).

---

## 4. The Engine in one page

**Triggers** (on effects): `flags["alivas-engine-of-triggers"].triggers = [{ event, filter, action, then, label, ask,
needsUses, oncePerTurn, every }]`, run while the effect is active on its **bearer**.
* events — bearer: attack, spell, activity, save, check, moved, rest, initiative, missed, dealt, damageRolled,
  collided, interval · to the bearer: hit, damaged, statusGained, applied · turns: turnStart/End, roundStart/End,
  sourceTurnStart/End · area: areaCreated, areaEnter, areaLeave, areaTurnStart, areaTurnEnd.
* actions — save (dc: number, "source", "sourceSpell" or a formula), damage, activityDamage, useActivity, giveEffect,
  removeStatus (standard or custom status ids), tempHp, recoverSlots, storeSpell, repeatActivity, drainMaxHp,
  spendHitDie, inspire, swapInitiative, toggleLight, random (roll on a table → give that row's effect), teleport, push,
  conjureItem (pick an item from a compendium, equipped and enchanted by this item; vanishes when its bond ends),
  sense (whisper nearby creatures / magic), rollActivity, note, duplicates.
* trigger options — ask, needsUses, oncePerTurn, every. Filter data includes bearerTurn, sourceTurn, subjectIsSource,
  subjectIsAlly, subjectIsEnemy.
* selectors `to: { who: choose|all|self|bearer|source|subject|targets, range, from, side (any|ally|enemy|notAlly), sight,
  count, by: "source", grappledBy (creatures the chooser grapples) … }`.

**Effect rules** (flags): area, stopOnCollision, attackedWith (mode, once, by uuid|"source", attacker filter),
attacksWith (mode, once, unlessTarget "source"), disengaged, extraAttack, evasion, saveAdvantageAgainst, healingExtraDie,
noHealing, dropSave, onlyIf, saveDamage, ownRollsOnly, ignoreDamageFrom, noReactions, noComponents, askFirst,
attackAbilities(Only), minLevel, reduceDamage, damageDice (minimum die), baseDamage (deal X instead of a weapon's own
damage when higher; filter data adds held.weapons / held.shield), light, noSpells, sustain (Rage upkeep),
tether, passThrough, checksWith, whileStatus, ignoreCover ({ level, classification?, type? }), extraAttack ({ count,
item: weapon filter }), noUnseenAdvantage (setting unseenAttacks), actionOrBonus (an Action or a Bonus Action on its turn, not both), faction ("source" | letter: Dominate), bond (on enchantments: { id, single, range, away,
endOnDeath } — Pact of the Blade; filters see `item.bonds`).
Prefer dnd5e 6's own conditional Rules changes (`attack` / `damage` / `check` / `save` with `dnd5e.bonus` /
`dnd5e.advantage` and `conditions` on the roll data, e.g. `roll.attack.mode`, `roll.ability`, `roll.skill`) before adding
an engine rule — Dueling, Reckless Attack and Danger Sense need nothing else.

**Activity flags**: onUse, onHit (attacks: after hits settle; "targets" = creatures hit), pay, chooseEffects (also for
save activities), targetFilter, summonEffects, repeat, mastery, properties, area.triggers, castingAbility ({ class } |
{ spell }: where its "spellcasting" ability comes from), autoSave (filter: creatures that succeed on its save without rolling).

**Reactions** (on items): `reactions = [{ window, who, activity, outcome, filter, cost, free, oncePerTurn, onceKey,
requiresItem, atTarget, after, refundUnlessSuccess… }]`. Windows: hitBy, d20Succeeded, d20Failed, damageIncoming,
spellCast, d20Rolling, hitting, leavesReach. Outcomes: acBonus, reroll, modifyRoll, damage, counter, straight,
damageNext, none. `after` steps may `ask` first. The hitting window's filter data has `item` (identifier, bonds…).
Headers of `reactions.mjs` / `main.mjs` document every field.

**Factions** (`factions.mjs`, setting `factions`, default on; spec `tasks/T-026-factions-spec.md`):
- **Letters:** every creature token has a faction letter (token flag `faction`). It's seeded on placement: the actor's
  seed (sheet "Faction" button), else player-owned creatures get `factionPC` ("A"), summons their summoner's faction,
  other NPCs "B". Non-creatures (loot piles, vehicles) have none.
- **Relations:** the scene's table (scene flag `relations[from][to]` = ally | neutral | hostile, directional;
  defaults: self ally, party ↔ B hostile, the rest neutral). It's edited in the relations window
  (`factions-window.mjs`), opened from the combat tracker header or the Token HUD.
- **What follows the table:** `Creatures.relation`, and through it selector sides, the `subjectIsAlly` /
  `subjectIsEnemy` filters, Opportunity Attacks, Sneak Attack's ally check, movement blocking and difficult terrain
  (`maneuvers.mjs`) and flanking (`flanking.mjs`, 2014 DMG).
- **Dispositions** are written from the party's relation (lead GM; Secret tokens are never rewritten).
- **Border colours** are drawn per viewer from `perspective()`.
- **Pickers** show colour chips.
- **Effect rule `faction`** ("source" or a letter) moves the bearer while it's active: Dominate.
- **Charmed:** no attacks against the charmer, and the charmer is never in the charmed creature's hostile picks.
- **API:** `api.factions`. **Hook:** `alivasTriggers.factionsChanged`.

**Delay turn** (`delay.mjs`, setting `delayTurn`): combat tracker button; combatant flag `delayed`, combat flag `resume`; wraps
`ActiveEffect#isExpiryEvent` so a delay only ends turn-end effects that help the delayer; returning reorders with
`turnEvents: false`; reactions are blocked through `Reactions.reactionUsed`.

**Workflow** (settings in *Automation settings*): saves (targeted → `resolveSave`; templates → their area), attacks
(roll → hit → damage → rider saves → masteries), healing, weapon masteries. **One save routine:**
`Workflow.rollSaveOutcome` — don't add another.

**Multi-client**: once-only work runs on the lead GM (`Creatures.isLeadGM()`); players act on things they don't own
through GM relays; UI for a specific user goes through `Creatures.runAs`. The lead GM may be viewing another scene —
never assume `canvas.scene`; find tokens with `Creatures.tokenFor`. When testing, every GM window must run the new
code (reload or close the others), or the lead one does the work with the old code.

**dnd5e 6 / v14 facts**: templates are Regions (test points with `region.testPoint`; a new region's token list fills
late); `preMoveToken` can only reject; healing damage values are **positive** with a healing type; old effect keys are
shimmed; upcast activities carry `flags.dnd5e.scaling` (the usage card's `getAssociatedActivity()` is scaled);
`postUseActivity` is sync — set `usageConfig.subsequentActions = false` before any await.

---

**Extension API** (for other modules, e.g. the Stage):
- `Hooks.on("alivasTriggers.ready", api => …)`, then `api.registerAction(type, { run, label, icon, hint, defaults, describe,
  validate, fields, onAction, activity })` adds an action type (runtime + editor tile/fields), and
  `api.registerEditorSection({ id, render, describe, validate, onAction })` adds a section under every action card.
  Inputs bind with `data-path="action.…"`; buttons use `data-action="extAction"` / `"extSection"` + `data-op`.
- `Hooks.on("alivasTriggers.action", { origin, action, trigger, effect, bearer, event, context, result, moves })` after
  every trigger action and activity step (on the client that ran it); `Hooks.on("alivasTriggers.move", { token, from,
  to, kind })` for every teleport / push / pull (`creatures.mjs` displaceToken). Keep unknown action fields (e.g.
  `action.animation`) — the editor round-trips them.

## 5. The Box in one page

A patch = a full item document in `packs/_source/fixed-items/<file>.json` with
`flags["alivas-box-of-triggers"] = { version, match: [keys…] }`.
* **Match keys** (all fields must equal): `name`, `type`, `book`, `page`, `identifier`, `compendiumSource`, `owner`.
  2024 PHB via Plutonium → `{ type, identifier, book: "PHB 2024" }`; dnd5e SRD copy → `{ type, identifier,
  compendiumSource: "Compendium.dnd5e.classes24.Item.<id>" }`; same rule everywhere (Evasion) → `{ type, identifier }`;
  per creature → `owner`. Never match 2014 copies with a 2024 patch.
* Applying replaces mechanics and **keeps** the user's description, image, uses spent, preparation, equipment and
  attunement. So a patch can be built from any copy of the item.
* Consumption from another item (a Focus Point or Psionic pool) is written `"target": "identifier:focus-point|monks-focus"`
  — never an item ID from one character. The Box resolves it on each actor (when patching, else on first use).
* Imported effects' descriptions are the book's text: clear them (the strip script removes any with enricher markup).
* Bump `version` whenever a patch changes. Unique `_id` per patch.
* After editing patches: `npm run strip-rules-text` then `node scripts/strip-rules-text.cjs --check`.

---

## 5b. The Stage in one page

Animations and sounds. A **cue** is `{ steps: [...] }` (format in `cues.mjs`'s header); it plays through Sequencer.
Cues come from, most specific first: item flags (`cues[activityId|"*"][use|attack|hit|damage|area]`), effect flags
(`cue.start|active|end`), `action.animation` on any engine action (or the `animate` action), presets
(`presets/box.json` by item name + type; `presets/statuses.json`), the condition and move settings. Anything the Stage
animates, Automated Animations skips (`aaHandOff`): an effect that has a cue, an effect from an item with activity cues, an
item with any activity cue, an activity that applies an effect with a `start` cue. Otherwise AA plays, with whole-word
matches only (`aaGuard`). Instantaneous areas linger 3 s before removal so animations on them can play.
- **Presets** use only Sequencer database paths that exist; validate with `node private/work/anim/validate-presets.mjs`
  (maintainer) or by checking every `file` is a prefix of a path in Sequencer's database. Prefer paths in the free JB2A
  / PSFX. No rules text, as everywhere.
- **catalog.mjs** is pure (no Foundry): test it with Node against a dump of path strings.

## 6. Working with or without Foundry

Detect first: is a Foundry server reachable (e.g. `http://localhost:30000`) with this repo's modules linked into its
`Data/modules`? Don't install Foundry or ask anyone to — work in the mode you have.

| Work | No Foundry | With Foundry |
|---|---|---|
| Read rules (5etools), design | ✅ | ✅ |
| Engine / editor code (`node --check`, careful reading of dnd5e source from its GitHub repo) | ✅ | ✅ |
| New / changed Box patches from 5etools + dnd5e `packs/_source` data | ✅ | ✅ (can also dump real items) |
| Strip rules text, pack compendia | ✅ | ✅ (Foundry closed) |
| Live test, editor round-trip in the UI, release | ❌ → leave a task | ✅ |

**Without Foundry**: do everything else, then record the untested part as a task with status `needs-live-test` and an
exact checklist (skill: `handoff`). Mark the code/patch as untested in your commit message. Never claim something works
that you couldn't run.

**With Foundry** (skill: `live-test`): test on a throwaway scene with throwaway actors (`ZZ …`), never on a scene
or combat with a game in progress; snapshot and restore any real character you touch; stub placement clicks when
testing templates / summons; clean up. Then pick up any `needs-live-test` tasks you can.

---

## 7. Every change

1. Collect: the rules text (5etools), the current item data, what dnd5e already does natively.
2. Design generically (§1). Name the pieces you reuse.
3. Implement; `node --check` each edited `.mjs`.
4. Editor: new capability reachable, round-trips (`converters.triggerToModel` ⇄ `modelToTrigger`, `reactionToModel` ⇄
   `modelToReaction`), describes itself in plain English.
5. Box: patch + strip rules text + version bump + `npm run pack`.
6. Test live, or leave a `needs-live-test` task (§6).
7. Update the task file's log (§8) and commit with a clear message.

---

## 8. Leaving work for others (tasks/)

`tasks/README.md` is the index; each task is `tasks/T-<nnn>-<slug>.md` using the template there. A task file is written
for an LLM to pick up cold: goal, sources, exact files, acceptance checks, what's done, what's left, and a dated log.
When you stop mid-way (or can't test), update **Status**, **Done**, **Left** and append to **Log** — the next person
starts from that file alone. Statuses: `open`, `in-progress`, `needs-live-test`, `blocked`, `done`.

---

## 9. Contributing

* Fork, branch (`t-004-push-mastery`), open a pull request against `main`. One task per PR; the PR updates that
  task's file (status, Done, Left, Log) so the state travels with the code.
* Offline work is welcome: mark it `needs-live-test` and say so in the PR. Someone with Foundry picks it up from the
  task file.
* Don't change module versions — releases are cut by the maintainer (`npm run release -- X.Y.Z`).
* Keep personal data out: no world dumps, player names, local paths or credentials in commits.

**Without git or a GitHub account**: the agent handles everything (skill: `offline-contribution`).
1. Download https://github.com/AlivasGR/alivas-triggers/archive/refs/heads/main.zip.
2. Run `npm run contrib -- setup --name "…"` before the first edit. It recommends tasks; `claim T-<nnn>` takes one.
3. Work and update the task file, as above.
4. Run `npm run contrib -- pack --title "T-<nnn>: …"`.
5. The user sends the maintainer the single numbered file it writes to `send-to-alivas/` (the folder opens by itself).

The maintainer runs `npm run contrib -- intake <file>`, which applies the bundle as a 3-way merge on a branch, with
you as the commit author. If the repo you're in has no `.git` folder, this is your route.
