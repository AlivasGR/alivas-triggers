---
name: offline-contribution
description: Contribute without git or a GitHub account — work on a downloaded copy and send the maintainer one bundle file. Use when the repo has no .git folder, when the user can't push or open pull requests, or when they ask to "send my work" / "make a bundle".
---

# Offline contribution

For contributors who can't use GitHub. Your work leaves as **one JSON file** that the maintainer merges. You don't
need git. You do need Node.js 18+; `npm install` is not needed for this.

## Before any work

1. Get a fresh copy. Use https://github.com/AlivasGR/alivas-triggers/archive/refs/heads/main.zip (no account needed),
   or a zip the maintainer sends you. Unzip it.
2. In the repo root, run `npm run contrib -- start`. This records the baseline: a copy in `.contrib/base/`. Every
   change is measured against it, so **run it before editing anything**. Running it after edits hides those edits.
3. Pick a task from `tasks/README.md` and set its **Owner** to your name. If no task fits, create one (skill:
   `handoff`) and use the next free number. Another offline contributor may take the same number; the maintainer
   renumbers on intake.

## While working

- Follow AGENTS.md §7 exactly as an online contributor would.
- `npm run contrib -- status` lists what you've changed.
- Never edit `module.json` versions. Never add files under `private/`, `dist/`, `node_modules/` or the built
  compendia; they aren't sent.
- One task per bundle. If you finish more than one, make a bundle for each (see "Several bundles").

## Sending

1. Update the task file: **Status**, **Done**, **Left**, and a dated **Log** line (skill: `handoff`). Write as if
   the maintainer will read nothing else. Say what you verified and how: (offline) or (live).
2. `npm run contrib -- pack --name "<your name>" --title "T-<nnn>: <what it does>"`
3. Before writing the bundle, pack checks that:
   - a `tasks/` file changed;
   - no `module.json` version changed;
   - every changed `.mjs`/`.cjs` passes `node --check`;
   - every changed `.json` parses;
   - `strip-rules-text --check` passes (if not, run `npm run strip-rules-text`).

   Fix whatever it reports, then pack again.
4. Send `.contrib/out/contrib-<name>-<stamp>.json` to the maintainer by email, chat, or any other channel. Don't edit
   the file: a checksum detects changes and corruption in transit.

## Several bundles / continuing

- **After packing:** to keep working on top of what you sent, run `npm run contrib -- start --force`. The next
  bundle then holds only the newer changes. The maintainer applies bundles in the order you made them, so tell them
  that order.
- **To start fresh from the maintainer's latest version instead:** download a new copy and run `start` in it. Bundles
  merge 3-way, so a bundle made from an older copy still applies. Where you and the maintainer changed the same lines,
  the maintainer resolves it.

## What the maintainer does (for reference)

`npm run contrib -- intake <file>` runs on the maintainer's side. It verifies the checksum, refuses unsafe paths and
applies each file on a new branch `contrib/<name>-<stamp>` with a 3-way merge. If nothing conflicts it commits with
you as the author. It never pushes. The maintainer reviews it, live-tests it or leaves it `needs-live-test`, and
merges it.
