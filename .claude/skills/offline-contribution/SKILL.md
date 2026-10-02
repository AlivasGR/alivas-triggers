---
name: offline-contribution
description: Set up and run contributions to this repo without git or a GitHub account. The agent does all of it: gets the code, sets up, recommends tasks, works, and packs one bundle file into send-to-alivas/ for the user to send to the maintainer. Use when the repo has no .git folder, when the user is pointed at github.com/AlivasGR/alivas-triggers but can't use GitHub, or when they ask to set up, "send my work" or "make a bundle".
---

# Offline contribution (no git, no GitHub account)

**You do everything.** The user only does three things:
- tells you their name once;
- installs Node.js, and only if it's missing;
- sends the finished file to the maintainer (Alivas) on Discord.

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
2. Run `npm run contrib -- setup --name "<name>"`. If a Foundry server is reachable (AGENTS.md §6), add `--foundry`.

Setup records a baseline (`.contrib/base/`): every change is measured against it. That's why it must run **before
the first edit**. Running it again is safe: it only reports the state. Run it at the start of every session.

- If it reports "Already set up" with changed files, that's earlier unsent work. Carry on with it.
- Never delete `.contrib/`. It holds the baseline, the name and the bundle count.

## 4. Recommend a task (right after setup)

Setup ends with a task list:
- **Your tasks**: the user's own, in progress. Recommend continuing those first.
- **Recommended tasks**: open and unowned. Fully-offline ones come first, then ones whose final check needs Foundry.

`npm run contrib -- tasks` shows the list again at any time.

Don't paste that list. Read the top candidates' task files, then give the user **3 to 5 recommendations**:

```
Here's what you could work on (none of it needs Foundry):

1. T-013 — Unit tests for the engine's pure logic. Fully offline; you'd write tests that catch bugs before anyone
   runs Foundry. Medium-sized.
2. T-007 — Monk Deflect Attacks keeps the attack's damage type. Small: one patch, plus a test checklist for the
   maintainer.
3. …

Which one? (Or describe something else you want to automate, and I'll set up a new task for it.)
```

For each one, say in plain words:
- what it is;
- how big it is (from the task's Plan);
- whether someone with Foundry has to check it at the end.

When the user picks one, run `npm run contrib -- claim T-<nnn>`. It makes the user the owner and sets the status to
`in-progress` in both the task file and the index. If they want something that isn't listed, create a task (skill:
`handoff`) with the next free number, and set **Owner** and **Status** yourself. Number clashes with other offline
contributors are fine; the maintainer renumbers.

## 5. Work

- Read AGENTS.md and follow it like any contributor: rules from 5etools, generic engine code, the §7 checklist.
- Never change `module.json` versions. Never put anything in `private/`, `dist/`, `node_modules/` or
  `send-to-alivas/` by hand.
- `npm run contrib -- status` shows what has changed so far.

## 6. Pack and hand over

1. Update the task file: **Status**, **Done**, **Left**, and a dated **Log** line (skill: `handoff`). Mark each check
   (offline) or (live). Without Foundry, the status is `needs-live-test` and **Left** holds the exact test checklist.
2. Run `npm run contrib -- pack --title "T-<nnn>: <what it does>"`. One task per bundle.
3. If pack refuses, fix what it lists and pack again:
   - no task file changed;
   - a version number changed;
   - a syntax error, or JSON that doesn't parse;
   - rules text left in a patch (run `npm run strip-rules-text`).
4. Pack does the following:
   - writes the bundle into the **`send-to-alivas/`** folder at the top of the user's copy;
   - writes a `README.txt` beside it that lists every bundle, newest first;
   - prints a "READY TO SEND" box;
   - opens the folder in the user's file manager, with the file selected.
5. **End your turn with this message.** Fill it in, and keep the file path on a line of its own so it's easy to copy:

```
✅ Your work is packed and ready to send.

📎 Send this file to Alivas:
<full path printed by pack>

It's in the "send-to-alivas" folder in your copy of the repo (I've opened it for you). Drag it into a Discord
message to Alivas, exactly as it is. Don't rename, unzip or edit it.

What's in it: <one line: the task and what was done>
Still to do: <one line: e.g. "Alivas or someone with Foundry needs to live-test it (checklist in the task)" or "nothing">
```

If pack says the folder holds earlier bundles, add this line: "Also send any earlier files in that folder that you
haven't sent yet, lowest number first. Sending one twice is harmless."

Pack numbers the bundle and re-baselines, so the user can keep working in the same folder. The next pack holds only
newer work. Bundles are applied in number order; the maintainer's tool refuses to skip one.

## 7. Getting the maintainer's newer version

Pack first, so nothing is left unsent. Then download a fresh copy (step 1) into a new folder. Copy the old
`.contrib/config.json` into the new `.contrib/` so the name and bundle count carry over, and run setup there. The old
copy's `send-to-alivas/` folder still holds the earlier bundles. Bundles merge 3-way, so a bundle made from an older
copy still applies.

## What the maintainer does (for reference)

The maintainer runs `npm run contrib -- intake <file>`:
- it verifies the checksum and refuses unsafe paths;
- it applies the bundle on the branch `contrib/<name>-<nn>-<stamp>` as a 3-way merge;
- if there are no conflicts, it commits with the user as the author. It never pushes.

The maintainer then reviews the work, live-tests it, and merges it.
