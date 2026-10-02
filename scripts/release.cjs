/**
 * Publish a release of both modules, from this repository (the public one — contributors' merged work is in it).
 *
 *   npm run release -- X.Y.Z            (Foundry must be closed: the compendia are rebuilt)
 *
 * 0. refuses unless the working tree is clean and up to date with origin/main
 * 1. stamps both module.json files with the version and public URLs (set-version.cjs)
 * 2. refuses if any pack source still carries long rules text (strip-rules-text.cjs --check)
 * 3. rebuilds the compendia
 * 4. commits the version bump, tags vX.Y.Z, pushes
 * 5. zips each module and creates the GitHub release vX.Y.Z with <id>.zip and <id>.json (the manifest)
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const REPO = "AlivasGR/alivas-triggers";
const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const MODULES = ["alivas-engine-of-triggers", "alivas-box-of-triggers", "alivas-stage-of-triggers"];

const version = process.argv[2];
if ( !/^\d+\.\d+\.\d+$/.test(version ?? "") ) throw new Error("Usage: npm run release -- X.Y.Z");
const run = (cmd, cwd=ROOT) => execSync(cmd, { cwd, stdio: "inherit" });
const out = (cmd, cwd=ROOT) => execSync(cmd, { cwd, encoding: "utf8" });

// 0
if ( out("git status --porcelain").trim() ) throw new Error("Working tree not clean — commit or stash first.");
run("git fetch -q origin");
if ( out("git rev-list --count HEAD..origin/main").trim() !== "0" ) throw new Error("Behind origin/main — pull first.");

// 1–3
run(`node scripts/set-version.cjs ${version}`);
run("node scripts/strip-rules-text.cjs --check");
run("npm run pack");

// 4
run("git add -A");
if ( out("git status --porcelain").trim() ) run(`git commit -q -m "Release ${version}"`);
run(`git tag v${version}`);
run(`git push -q origin HEAD:main v${version}`);

// 5. Zips and manifests
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST);
for ( const id of MODULES ) {
  const stage = path.join(DIST, "stage", id);
  const src = path.join(ROOT, id);
  fs.cpSync(src, stage, {
    recursive: true,
    filter: p => {
      const rel = path.relative(src, p).replace(/\\/g, "/");
      return !rel.startsWith("packs/_source") && !/(^|\/)(LOCK|LOG|LOG\.old)$/.test(rel);
    }
  });
  fs.copyFileSync(path.join(ROOT, "LICENSE"), path.join(stage, "LICENSE"));
  fs.copyFileSync(path.join(ROOT, "README.md"), path.join(stage, "README.md"));
  const zip = path.join(DIST, `${id}.zip`);
  // bsdtar (built into Windows) writes forward-slash paths; PowerShell's Compress-Archive writes backslashes, which
  // Linux hosts such as The Forge can't unpack into folders.
  const entries = fs.readdirSync(stage).map(e => `"${e}"`).join(" ");
  run(`"C:\\Windows\\System32\\tar.exe" -a -c -f "${zip}" ${entries}`, stage);
  fs.copyFileSync(path.join(src, "module.json"), path.join(DIST, `${id}.json`));
}
const assets = MODULES.flatMap(id => [`dist/${id}.zip`, `dist/${id}.json`]).join(" ");
const notes = `Alivas's Engine of Triggers and Alivas's Box of Triggers ${version}.\n\n`
  + MODULES.map(id => `- ${id}: https://github.com/${REPO}/releases/latest/download/${id}.json`).join("\n");
fs.writeFileSync(path.join(DIST, "notes.md"), notes);
run(`gh release create v${version} ${assets} --repo ${REPO} --title "v${version}" --notes-file dist/notes.md`);
console.log(`\nReleased v${version}.`);
