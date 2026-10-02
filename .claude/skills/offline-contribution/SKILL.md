---
name: offline-contribution
description: Set up and run contributions to this repo without git or a GitHub account. The agent does all of it: gets the code, sets up, works, packs one bundle file for the user to send to the maintainer. Use when the repo has no .git folder, when the user is pointed at github.com/AlivasGR/alivas-triggers but can't use GitHub, or when they ask to set up, "send my work" or "make a bundle".
---

# Offline contribution (no git, no GitHub account)

**You do everything.** The user only does three things:
- tells you their name once;
- installs Node.js, and only if it's missing;
- sends the finished file to the maintainer (Alivas) by email, chat, or any other channel.

Don't ask the user to run commands. Tell them what you did in plain language.

## 1. Get the code (only if there's no local copy yet)

If you were given the GitHub link but there's no copy of the repo on disk, download it. No account is needed.

- Windows (PowerShell):
  `Invoke-WebRequest https://github.com/AlivasGR/alivas-triggers/archive/refs/heads/main.zip -OutFile alivas-triggers.zip; Expand-Archive alivas-triggers.zip .`
- macOS / Linux: `curl -L -o alivas-triggers.zip https://github.com/AlivasGR/alivas-triggers/archive/refs/heads/main.zip && unzip -q alivas-triggers.zip`

The repo is the extracted folder `alivas-triggers-main/`. Work there from now on.

If a `.git` folder exists, this is a normal git checkout and this skill doesn't apply. Follow AGENTS.md §9.

## 2. Check Node.js

Run `node --version`. You need v18 or later. If it's missing or older, ask the user to install the LTS from
https://nodejs.org. Don't install system software yourself unless the user says to. `npm install` is not needed.

## 3. Set up (before any edit)

1. Ask the user for the name they want credited (once).
2. Run `npm run contrib -- setup --name "<name>"`.

Setup records a baseline (`.contrib/base/`): every change is measured against it. That's why it must run **before
the first edit**. Running it again is safe: it only reports the state. Run it at the start of every session.

- If it reports "Already set up" with changed files, that's earlier unsent work. Carry on with it.
- Never delete `.contrib/`. It holds the baseline, the name and the bundle count.

## 4. Work

- Read AGENTS.md and follow it like any contributor: rules from 5etools, generic engine code, the §7 checklist.
- Pick a task from `tasks/README.md` and set its **Owner** to the user's name. If no task fits, create one (skill:
  `handoff`) with the next free number. Number clashes with other offline contributors are fine; the maintainer
  renumbers them.
- Never change `module.json` versions. Never put anything in `private/`, `dist/` or `node_modules/`; those aren't
  sent.
- `npm run contrib -- status` shows what has changed so far.

## 5. Pack and hand over

1. Update the task file: **Status**, **Done**, **Left**, and a dated **Log** line (skill: `handoff`). Mark each check
   (offline) or (live). Without Foundry, the status is `needs-live-test` and **Left** holds the exact test checklist.
2. Run `npm run contrib -- pack --title "T-<nnn>: <what it does>"`. One task per bundle.
3. If pack refuses, fix what it lists and pack again:
   - no task file changed;
   - a version number changed;
   - a syntax error, or JSON that doesn't parse;
   - rules text left in a patch (run `npm run strip-rules-text`).
4. Tell the user:
   - the full path of the file it wrote (`.contrib/out/contrib-<name>-<nn>-<stamp>.json`);
   - to send that file, unchanged, to the maintainer;
   - one or two lines on what's in it and what still needs a live test.

Pack numbers the bundle and re-baselines, so the user can keep working in the same folder. The next pack holds only
newer work. Bundles are applied in number order; the maintainer's tool refuses to skip one.

## 6. Getting the maintainer's newer version

Pack first, so nothing is left unsent. Then download a fresh copy (step 1) into a new folder, copy the old
`.contrib/config.json` into the new `.contrib/` so the name and bundle count carry over, and run setup there. Bundles
merge 3-way, so a bundle made from an older copy still applies.

## What the maintainer does (for reference)

The maintainer runs `npm run contrib -- intake <file>`:
- it verifies the checksum and refuses unsafe paths;
- it applies the bundle on the branch `contrib/<name>-<nn>-<stamp>` as a 3-way merge;
- if there are no conflicts, it commits with the user as the author. It never pushes.

The maintainer then reviews the work, live-tests it, and merges it.
