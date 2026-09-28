# Tasks

Open work, handoffs and work logs. One file per task: `T-<nnn>-<slug>.md`. Next free number: **T-015**.

**Foundry?** column: `no` = can be done fully without Foundry · `test` = the work is offline, only the final check
needs Foundry · `yes` = needs a running Foundry throughout.

| Task | Title | Status | Foundry? |
|---|---|---|---|
| [T-001](T-001-future-levels.md) | Prepare automation for the party's future levels (classes, subclasses, species, backgrounds, feats) | open | test |
| [T-002](T-002-live-test-backlog.md) | Live-test backlog: things built but not yet exercised in a real game flow | needs-live-test | yes |
| [T-003](T-003-srd-copies.md) | Match dnd5e SRD 2024 copies of every patched item | open | test |
| [T-004](T-004-remaining-masteries.md) | Weapon masteries Nick, Cleave, Push | open | test |
| [T-005](T-005-cover.md) | Cover as an effect rule (half / three-quarters), used by the Keywand of the Stars | open | test |
| [T-006](T-006-generators-in-repo.md) | Patch generators as public, rerunnable scripts | open | no |
| [T-007](T-007-deflect-redirect-type.md) | Deflect Attacks: redirect keeps the attack's damage type | open | test |
| [T-008](T-008-healers-kit-stabilize.md) | Healer's Kit / Medicine: stabilize a dying creature | open | test |
| [T-009](T-009-slow-fall.md) | Monk Slow Fall: reduce falling damage | open | test |
| [T-010](T-010-npc-condition-riders.md) | Condition riders on monster attacks (save-ends, bite → poisoned…) | open | test |
| [T-011](T-011-2014-variants.md) | 2014 variants of patched items, as separate patches | open | test |
| [T-012](T-012-editor-coverage-audit.md) | Editor coverage audit: every engine field reachable and described | open | test |
| [T-013](T-013-unit-tests.md) | Node unit tests for the pure parts (filters, formulas, patch matching, editor converters) | open | no |
| [T-014](T-014-uses-bug-items.md) | Items whose attack spends uses they don't have (Dagger, Rope, Hooded Lantern) | open | test |

Statuses: `open` · `in-progress` · `needs-live-test` · `blocked` · `done`. Keep this table in sync when you change a
task's status. Done tasks stay listed until the next release, then the file is deleted (git keeps it).

---

## Template

Copy this into a new `T-<nnn>-<slug>.md`, add a row above, bump "Next free number".

```markdown
# T-<nnn> — <title>

- **Status:** open | in-progress | needs-live-test | blocked | done
- **Foundry:** no | test | yes
- **Owner:** <name or blank>
- **Area:** engine | box | editor | tooling | docs

## Goal
One paragraph: the outcome, in rules terms and in engine/box terms.

## Sources
5etools entries (file + name), dnd5e packs/_source entries, anything else (and why 5etools didn't cover it).

## Plan
Numbered steps. Name the existing engine pieces reused; name any new generic piece and where it goes.

## Acceptance
Checklist that proves it works. Mark each with how it was verified: (offline) / (live) / (not yet).
- [ ] …

## Done
What exists now: files, patch ids + versions, commits.

## Left
What the next person does first. Be specific enough to start without reading anything else.

## Log
- YYYY-MM-DD — <who/agent>: what was done, what was learned, what failed. Newest last.
```

### Writing for the next agent

* State facts, not intentions. "`sneak-attack-phb-2024.json` v1 written, untested" — not "I think this should work".
* Name files, ids, functions and settings exactly. Quote the rules text you implemented only as a short paraphrase
  and cite the 5etools entry.
* List every assumption you couldn't verify (e.g. "assumed Plutonium stores the subclass as `system.identifier:
  warrior-of-mercy`").
* For untested work, write the exact live-test steps: actor setup, what to click, the expected numbers.
