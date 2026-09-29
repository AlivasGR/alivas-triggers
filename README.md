# Alivas's Triggers

Two Foundry VTT modules that automate D&D 5e (2024 rules) on top of the **dnd5e 6.x** system, without Midi-QOL.

| Module | What it is |
|---|---|
| **Alivas's Engine of Triggers** | The engine: triggers on Active Effects, reaction popups, and rules automation. Works in any dnd5e world. |
| **Alivas's Box of Triggers** | Content: patches for specific spells, features and monster abilities, plus weapon options. Requires the Engine (installed automatically). |

Requires Foundry VTT v14 and dnd5e 6.0 or later.

## Install

In Foundry (or on The Forge: *Bazaar → Install via manifest URL*), install with these manifest URLs:

- Engine: `https://github.com/AlivasGR/alivas-triggers/releases/latest/download/alivas-engine-of-triggers.json`
- Box: `https://github.com/AlivasGR/alivas-triggers/releases/latest/download/alivas-box-of-triggers.json`

Installing the Box installs the Engine too. Enable both in your world, then reload.

## Engine

**Rules automation (settings)**
- **Auto-apply effects**: effects go on automatically — to creatures an attack hits, to creatures that fail a save rolled from the card, to yourself for self spells, and for buffs (Mage Armor, Bless, Aid…) to the creatures you targeted, or yourself.
- **Concentration saves** roll automatically and end concentration on a failure.
- **Players roll their own** repeat saves and concentration saves when they're connected.
- A **`dc` rule**: an Active Effect change with key `dc` (type Rules → Bonus) adjusts save DCs, with conditions (e.g. per school of magic), like dnd5e's own `attack` key.

**Triggers** — an Active Effect can react to what happens to the creature carrying it: its turn starting or ending, being hit, taking damage, attacking, casting, saving, moving, resting, rolling initiative… and then roll a save (with damage on a failure), deal damage, give an effect to chosen or nearby creatures, end conditions, grant Heroic Inspiration, handle Mirror Image-style duplicates, or end itself. Edit them with the ⚡ **Triggers** editor (effect sheet → Details tab, or the sheet's header menu): presets, plain-language summaries, no JSON needed.

**Reactions** — items can declare reactions; when the moment comes, whoever controls a creature that can react gets a popup (and the game waits):
- hit by an attack (Shield), a creature succeeds on a d20 (Silvery Barbs), damage incoming (Absorb Elements), a spell being cast (Counterspell), a d20 about to be rolled with advantage or disadvantage (Restore Balance — decided before anyone sees the dice), Opportunity Attacks.
- Checks range, line of sight and vision (Foundry's own), whether the creature is an ally or enemy, whether a reaction is left, and spell slots — it casts from the lowest slot that works.

**Delay turn** (setting) — an ⏳ button on the combat tracker. On your turn (unless you're last in the order) press it to end your turn and delay; press it again (↺) at the end of any other creature's turn to act right away, before the creature whose turn it is — your initiative moves there for good, and that creature's turn picks up after yours without starting over. While delayed you have no reaction. When you delay, effects that would end at the end of your turn and came from you or an ally end then (configurable: all, or none); buffs you keep up each turn (Rage) don't end because you delayed — attack after you return to keep Rage going; everything else at the end of your turn (an enemy's effect ending, "save at the end of your turn", end-of-turn damage) waits for the turn you actually take. Delay a whole round and you lose that turn: its end-of-turn effects resolve when your place in the order comes round again (a Rage you didn't keep up ends).

## Box

Patches replace an item's **mechanics only** — activities, effects, reactions — and keep its description, image, source and play state. Patched items are matched by name, type and source book/page (or dnd5e compendium source), so Plutonium imports, dnd5e compendium drags and hand-made copies all work.

- **Patch on import** (setting, on by default): items are patched as they're created.
- **Settings → Alivas's Box of Triggers → Review & apply**: patch items already in the world; tick which ones.

The Box contains **no rules text** — each patch keeps your own item's description. Included: Shield, Silvery Barbs, Counterspell, Hold Person, Mind Sliver, Mirror Image, Suggestion, Lesser Restoration, Tasha's Mind Whip, Innate Sorcery, Metamagic (combined Sorcery Point / Metamagic Adept pools), Restore Balance, Alert, Musician, Bladesong, and more; see the compendium.

## Building from source

`npm install`, then `npm run pack` builds the compendia (Foundry must be closed). `npm run release -- X.Y.Z` stamps the version, checks for rules text, packs, zips both modules and publishes a GitHub release.

## License

MIT. Dungeons & Dragons and its rules are © Wizards of the Coast; this project contains no rules text.
