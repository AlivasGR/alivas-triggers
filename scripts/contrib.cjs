/**
 * Offline contributions: work on a plain copy of this repository (no git, no GitHub account) and send the result to
 * the maintainer as ONE file. Node only, no dependencies.
 *
 * Contributor
 *   npm run contrib -- start                       records the baseline (copies the repo into .contrib/base/)
 *   …work…  (tasks/ file updated, as in AGENTS.md §8)
 *   npm run contrib -- status                      what changed since the baseline
 *   npm run contrib -- pack --name "Your Name" --title "T-004: Push mastery"
 *                                                  checks, then writes .contrib/out/contrib-<name>-<stamp>.json
 *   → send that file to the maintainer (email, chat, USB…)
 *
 * Maintainer (needs git)
 *   npm run contrib -- intake <bundle.json>        verifies it, applies it on a new branch contrib/<name>-<stamp>
 *                                                  with a 3-way merge per file; commits if clean, never pushes
 *
 * Bundle (JSON): { format, name, title, created, baseVersion, files: [{ path, op: add|modify|delete, base?, new? }],
 * checksum }. File contents are { encoding: "utf8" | "base64", data }. `base` (the file as it was at the baseline)
 * makes the merge 3-way, so a bundle made from an older copy still applies onto newer work.
 */
const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WORK = path.join(ROOT, ".contrib");
const BASE = path.join(WORK, "base");
const OUT = path.join(WORK, "out");
const FORMAT = "alivas-triggers-contribution/1";

/* -------------------------------------------- */
/*  Files                                       */
/* -------------------------------------------- */

/** Paths that are never part of a contribution (generated, private or local). */
function excluded(rel) {
  if ( /^(\.git|\.contrib|node_modules|private|dist|work)(\/|$)/.test(rel) ) return true;
  if ( /^alivas-box-of-triggers\/packs\/(?!_source(\/|$))[^/]+/.test(rel) ) return true;   // built compendia
  if ( /(^|\/)(CLAUDE\.local\.md|\.DS_Store|Thumbs\.db)$/.test(rel) || rel.endsWith(".log") ) return true;
  return false;
}

/** Every contributable file under dir: rel path → absolute path. */
function listFiles(dir) {
  const files = new Map();
  const walk = sub => {
    for ( const entry of fs.readdirSync(path.join(dir, sub), { withFileTypes: true }) ) {
      const rel = sub ? `${sub}/${entry.name}` : entry.name;
      if ( excluded(rel) ) continue;
      if ( entry.isDirectory() ) walk(rel);
      else if ( entry.isFile() ) files.set(rel, path.join(dir, rel));
    }
  };
  walk("");
  return files;
}

const hash = buf => crypto.createHash("sha256").update(buf).digest("hex");
const encode = buf => buf.includes(0) ? { encoding: "base64", data: buf.toString("base64") }
  : { encoding: "utf8", data: buf.toString("utf8") };
const decode = c => Buffer.from(c.data, c.encoding === "base64" ? "base64" : "utf8");
/** Text compared and merged with LF line endings (checkouts differ: Windows CRLF, archives LF); binary as is. */
const lf = buf => buf.includes(0) ? buf : Buffer.from(buf.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
const same = (a, b) => !!a && !!b && (hash(lf(a)) === hash(lf(b)));
/** Write text in the line-ending style of the file it replaces. */
const styled = (buf, like) => (like && !buf.includes(0) && like.includes("\r\n"))
  ? Buffer.from(lf(buf).toString("utf8").replace(/\n/g, "\r\n"), "utf8") : buf;
const version = () => JSON.parse(fs.readFileSync(path.join(ROOT, "alivas-engine-of-triggers", "module.json"), "utf8")).version;

/** Changes from the baseline to the working copy. */
function changes() {
  if ( !fs.existsSync(BASE) ) fail("No baseline. Run `npm run contrib -- start` before you begin working.");
  const base = listFiles(BASE);
  const now = listFiles(ROOT);
  const list = [];
  for ( const [rel, abs] of now ) {
    const buf = fs.readFileSync(abs);
    if ( !base.has(rel) ) list.push({ path: rel, op: "add", buf });
    else {
      const old = fs.readFileSync(base.get(rel));
      if ( !same(old, buf) ) list.push({ path: rel, op: "modify", buf, old });
    }
  }
  for ( const [rel, abs] of base ) if ( !now.has(rel) ) list.push({ path: rel, op: "delete", old: fs.readFileSync(abs) });
  return list.sort((a, b) => a.path.localeCompare(b.path));
}

/* -------------------------------------------- */
/*  Commands                                    */
/* -------------------------------------------- */

function start(args) {
  if ( fs.existsSync(BASE) && !args.force ) {
    fail("A baseline already exists (.contrib/base). Pack or discard your work first; `start --force` replaces it.");
  }
  fs.rmSync(BASE, { recursive: true, force: true });
  for ( const [rel, abs] of listFiles(ROOT) ) {
    fs.mkdirSync(path.dirname(path.join(BASE, rel)), { recursive: true });
    fs.copyFileSync(abs, path.join(BASE, rel));
  }
  fs.writeFileSync(path.join(WORK, "baseline.json"), JSON.stringify({ version: version(), created: new Date().toISOString() }, null, 2));
  console.log(`Baseline recorded (version ${version()}). Work as usual; then \`npm run contrib -- pack --name … --title …\`.`);
}

function status() {
  const list = changes();
  if ( !list.length ) return console.log("No changes since the baseline.");
  for ( const c of list ) console.log(`${{ add: "A", modify: "M", delete: "D" }[c.op]}  ${c.path}`);
}

function pack(args) {
  const name = String(args.name ?? "").trim();
  const title = String(args.title ?? "").trim();
  if ( !name || !title ) fail('Usage: npm run contrib -- pack --name "Your Name" --title "T-<nnn>: what this does"');
  const list = changes();
  if ( !list.length ) fail("Nothing changed since the baseline.");
  const problems = [];
  // The state of the work travels in a task file (AGENTS.md §8).
  if ( !list.some(c => c.path.startsWith("tasks/")) ) problems.push("No tasks/ file changed: update the task's Status, Done, Left and Log (skill: handoff).");
  // Versions are the maintainer's.
  for ( const c of list.filter(c => c.path.endsWith("module.json") && c.op === "modify") ) {
    const before = JSON.parse(c.old.toString("utf8")).version, after = JSON.parse(c.buf.toString("utf8")).version;
    if ( before !== after ) problems.push(`${c.path}: version changed (${before} → ${after}); leave versions to the maintainer.`);
  }
  // Scripts parse; JSON parses.
  for ( const c of list.filter(c => c.op !== "delete") ) {
    if ( /\.(mjs|cjs|js)$/.test(c.path) ) {
      try { execFileSync(process.execPath, ["--check", path.join(ROOT, c.path)], { stdio: "pipe" }); }
      catch(err) { problems.push(`${c.path}: syntax error\n${String(err.stderr ?? err.message).trim()}`); }
    }
    if ( c.path.endsWith(".json") ) {
      try { JSON.parse(c.buf.toString("utf8")); } catch(err) { problems.push(`${c.path}: invalid JSON (${err.message})`); }
    }
  }
  // No rules text in the Box.
  try { execFileSync(process.execPath, [path.join(ROOT, "scripts", "strip-rules-text.cjs"), "--check"], { cwd: ROOT, stdio: "pipe" }); }
  catch(err) { problems.push(`Rules text found — run \`npm run strip-rules-text\`:\n${String(err.stdout ?? "").trim()}`); }
  if ( problems.length ) fail(`Not packed:\n- ${problems.join("\n- ")}`);

  const baseline = JSON.parse(fs.readFileSync(path.join(WORK, "baseline.json"), "utf8"));
  const files = list.map(c => ({ path: c.path, op: c.op,
    ...(c.old ? { base: encode(c.old) } : {}), ...(c.buf ? { new: encode(c.buf) } : {}) }));
  const bundle = { format: FORMAT, name, title, created: new Date().toISOString(), baseVersion: baseline.version, files };
  bundle.checksum = hash(JSON.stringify(files));
  const stamp = bundle.created.replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "contributor";
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `contrib-${slug}-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(bundle, null, 1));
  console.log(`Packed ${files.length} file(s):`);
  for ( const c of list ) console.log(`  ${{ add: "A", modify: "M", delete: "D" }[c.op]}  ${c.path}`);
  console.log(`\nSend this file to the maintainer:\n  ${file}\n\nTo keep working on top of it, run \`npm run contrib -- start --force\` (the next bundle then holds only newer changes).`);
}

function intake(args) {
  const file = args._[0];
  if ( !file ) fail("Usage: npm run contrib -- intake <bundle.json>");
  const bundle = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  if ( bundle.format !== FORMAT ) fail(`Not a contribution bundle (format ${bundle.format}).`);
  if ( hash(JSON.stringify(bundle.files)) !== bundle.checksum ) fail("Checksum mismatch: the file was altered or truncated in transit.");
  for ( const f of bundle.files ) {
    const rel = String(f.path);
    if ( path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..") || excluded(rel) ) fail(`Refused: unsafe or excluded path ${rel}`);
    if ( !["add", "modify", "delete"].includes(f.op) ) fail(`Refused: unknown op ${f.op} for ${rel}`);
  }
  const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
  if ( git("status", "--porcelain") ) fail("Working tree not clean — commit or stash first.");
  const slug = bundle.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "contributor";
  const branch = `contrib/${slug}-${bundle.created.replace(/[-:]/g, "").replace("T", "-").slice(0, 13)}`;
  if ( git("branch", "--list", branch) ) fail(`Branch ${branch} exists: this bundle was taken in already (delete the branch to redo it).`);
  git("switch", "-c", branch);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-"));
  const report = { applied: [], merged: [], conflicts: [], same: [] };
  const restyle = [];
  for ( const f of bundle.files ) {
    const abs = path.join(ROOT, f.path);
    const current = fs.existsSync(abs) ? fs.readFileSync(abs) : null;
    const base = f.base ? decode(f.base) : null;
    const next = f.new ? decode(f.new) : null;
    if ( f.op === "delete" ) {
      if ( !current ) report.same.push(f.path);
      else if ( same(current, base) ) { fs.rmSync(abs); report.applied.push(`D ${f.path}`); }
      else report.conflicts.push(`${f.path}: deleted by the contributor, changed here since — decide by hand`);
      continue;
    }
    if ( same(current, next) ) { report.same.push(f.path); continue; }
    if ( !current || same(current, base) ) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, styled(next, current));
      report.applied.push(`${current ? "M" : "A"} ${f.path}`);
      continue;
    }
    // Changed on both sides (or added on both): 3-way merge into the working file, conflict markers on overlap.
    if ( f.new.encoding === "base64" ) { report.conflicts.push(`${f.path}: binary, changed on both sides — decide by hand`); continue; }
    const theirs = path.join(tmp, "theirs"), ancestor = path.join(tmp, "base");
    fs.writeFileSync(theirs, lf(next));
    fs.writeFileSync(ancestor, base ? lf(base) : "");
    fs.writeFileSync(abs, lf(current));
    restyle.push([abs, current]);
    try {
      execFileSync("git", ["merge-file", "-L", "ours", "-L", "base", "-L", bundle.name, abs, ancestor, theirs], { cwd: ROOT, stdio: "pipe" });
      report.merged.push(f.path);
    } catch {
      report.conflicts.push(`${f.path}: conflict markers written`);
    }
  }
  for ( const [abs, like] of restyle ) fs.writeFileSync(abs, styled(fs.readFileSync(abs), like));
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`${bundle.title} — by ${bundle.name}, made from ${bundle.baseVersion}, ${bundle.created}`);
  console.log(`Branch: ${branch}`);
  for ( const line of report.applied ) console.log(`  ${line}`);
  for ( const p of report.merged ) console.log(`  merged  ${p}`);
  for ( const p of report.same ) console.log(`  already here  ${p}`);
  if ( report.conflicts.length ) {
    console.log(`\nConflicts (resolve, then commit):\n  ${report.conflicts.join("\n  ")}`);
    return;
  }
  git("add", "-A");
  const author = `${bundle.name} <${slug}@contributors.invalid>`;
  execFileSync("git", ["commit", "-q", "--author", author, "-m", `${bundle.title}\n\nOffline contribution by ${bundle.name}, made from ${bundle.baseVersion}.`],
    { cwd: ROOT, stdio: "inherit" });
  console.log(`\nCommitted on ${branch}. Review with \`git diff main...${branch}\`, then merge (or delete the branch).`);
}

/* -------------------------------------------- */

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [] };
  for ( let i = 0; i < argv.length; i++ ) {
    const a = argv[i];
    if ( !a.startsWith("--") ) { args._.push(a); continue; }
    const key = a.slice(2);
    if ( (i + 1 < argv.length) && !argv[i + 1].startsWith("--") ) args[key] = argv[++i];
    else args[key] = true;
  }
  return args;
}

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const COMMANDS = { start, status, pack, intake };
if ( !COMMANDS[command] ) fail("Usage: npm run contrib -- start | status | pack --name … --title … | intake <bundle.json>");
COMMANDS[command](args);
