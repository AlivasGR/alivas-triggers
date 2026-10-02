/**
 * Offline contributions: work on a plain copy of this repository (no git, no GitHub account) and send the result to
 * the maintainer as ONE file. Node only, no dependencies.
 *
 * Contributor (an agent runs these; skill: offline-contribution)
 *   npm run contrib -- setup --name "Your Name"   once, before any edit: records the baseline (.contrib/base/) and the
 *                                                  name, then recommends tasks; safe to re-run (reports the state)
 *   npm run contrib -- tasks [--foundry]           recommended tasks: yours first, then open ones without an owner,
 *                                                  fully-offline before offline-then-live-test (--foundry: all)
 *   npm run contrib -- claim T-013                 owner = you, status in-progress (task file + tasks/README.md)
 *   …work…  (tasks/ file updated, as in AGENTS.md §8)
 *   npm run contrib -- status                      setup state and what changed since the baseline
 *   npm run contrib -- pack --title "T-004: Push mastery"
 *                                                  checks, writes send-to-alivas/contrib-<name>-<nn>-<stamp>.json (nn =
 *                                                  bundle number) + send-to-alivas/README.txt, opens that folder,
 *                                                  then re-baselines so the next bundle holds only newer work
 *   → send that file to the maintainer (email, chat, USB…)
 *   (start [--force] re-records the baseline by hand)
 *
 * Maintainer (needs git)
 *   npm run contrib -- intake <bundle.json>        verifies it, applies it on a new branch contrib/<name>-<stamp>
 *                                                  with a 3-way merge per file; commits if clean, never pushes
 *
 * Bundle (JSON): { format, name, seq, title, created, baseVersion, files: [{ path, op: add|modify|delete, base?, new? }],
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
const OUTBOX = path.join(ROOT, "send-to-alivas");
const FORMAT = "alivas-triggers-contribution/1";

/* -------------------------------------------- */
/*  Files                                       */
/* -------------------------------------------- */

/** Paths that are never part of a contribution (generated, private or local). */
function excluded(rel) {
  if ( /^(\.git|\.contrib|send-to-alivas|node_modules|private|dist|work)(\/|$)/.test(rel) ) return true;
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
const CONFIG = path.join(WORK, "config.json");
const readConfig = () => fs.existsSync(CONFIG) ? JSON.parse(fs.readFileSync(CONFIG, "utf8")) : {};
const writeConfig = data => { fs.mkdirSync(WORK, { recursive: true }); fs.writeFileSync(CONFIG, JSON.stringify({ ...readConfig(), ...data }, null, 2)); };
const slugOf = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "contributor";
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
/*  Tasks                                       */
/* -------------------------------------------- */

const TASKS = path.join(ROOT, "tasks");
const FOUNDRY_NEED = { no: "fully offline", test: "offline work; someone with Foundry does the final check", yes: "needs Foundry throughout" };

/** Every task file's header fields and goal. */
function readTasks() {
  if ( !fs.existsSync(TASKS) ) return [];
  return fs.readdirSync(TASKS).filter(n => /^T-\d+.*\.md$/.test(n)).sort().map(n => {
    const text = fs.readFileSync(path.join(TASKS, n), "utf8").replace(/\r\n/g, "\n");
    const field = key => (text.match(new RegExp(`^- \\*\\*${key}:\\*\\*[ \\t]*(.*)$`, "m"))?.[1] ?? "").trim();
    // First sentence of the Goal section.
    const section = text.split(/^## Goal[ \t]*$/m)[1]?.split(/^## /m)[0] ?? "";
    const goal = (section.replace(/\s+/g, " ").trim().match(/^.*?[.!?](?=\s|$)/)?.[0] ?? section.replace(/\s+/g, " ").trim());
    return { file: n, id: n.match(/^T-\d+/)[0], title: (text.match(/^# T-\d+\s*[—-]\s*(.*)$/m)?.[1] ?? n).trim(),
      status: field("Status").split(/[\s(]/)[0], foundry: field("Foundry").split(/[\s(]/)[0], owner: field("Owner"),
      area: field("Area"), goal };
  });
}

/** Print the tasks worth picking: the contributor's own first, then open unowned ones, most offline-friendly first. */
function recommend({ foundry=false }={}) {
  const me = String(readConfig().name ?? "").toLowerCase();
  const tasks = readTasks();
  const mine = tasks.filter(t => me && (t.owner.toLowerCase() === me) && (t.status !== "done"));
  const rank = { no: 0, test: 1, yes: 2 };
  const open = tasks.filter(t => !t.owner && ((t.status === "open") || (foundry && (t.status === "needs-live-test"))))
    .filter(t => foundry || (t.foundry !== "yes"))
    .sort((a, b) => (rank[a.foundry] ?? 3) - (rank[b.foundry] ?? 3));
  const line = t => {
    const goal = t.goal.length > 220 ? `${t.goal.slice(0, 217)}…` : t.goal;
    return `  ${t.id}  ${t.title}\n        ${FOUNDRY_NEED[t.foundry] ?? t.foundry}${t.area ? ` · ${t.area}` : ""}${t.status !== "open" ? ` · ${t.status}` : ""}\n        ${goal}`;
  };
  if ( mine.length ) console.log(`\nYour tasks (continue these first):\n${mine.map(line).join("\n")}`);
  if ( open.length ) console.log(`\nRecommended tasks${foundry ? "" : " (no Foundry needed to do the work)"}:\n${open.map(line).join("\n")}`);
  if ( !mine.length && !open.length ) console.log("\nNo open tasks without an owner. Propose one: copy the template in tasks/README.md.");
  else console.log('\nTake one with: npm run contrib -- claim T-<nnn>');
}

function tasks(args) {
  recommend({ foundry: !!args.foundry });
}

/** Take a task: Owner = the contributor, Status in-progress, in the task file and the tasks/README.md index. */
function claim(args) {
  const name = String(readConfig().name ?? "").trim();
  if ( !name ) fail('Set your name first: npm run contrib -- setup --name "Your Name"');
  const id = String(args._[0] ?? "").toUpperCase();
  const task = readTasks().find(t => t.id === id);
  if ( !task ) fail(`No task ${id || "(none given)"}. See: npm run contrib -- tasks`);
  if ( task.owner && (task.owner.toLowerCase() !== name.toLowerCase()) && !args.force ) {
    fail(`${id} is owned by ${task.owner}. Pick another (or claim --force if they handed it to you).`);
  }
  const status = ["open", "blocked", ""].includes(task.status) ? "in-progress" : task.status;
  const file = path.join(TASKS, task.file);
  const text = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, text
    .replace(/^(- \*\*Owner:\*\*)[ \t]*.*$/m, `$1 ${name}`)
    .replace(/^(- \*\*Status:\*\*)[ \t]*.*$/m, `$1 ${status}`));
  const index = path.join(TASKS, "README.md");
  if ( fs.existsSync(index) ) {
    const lines = fs.readFileSync(index, "utf8").split("\n").map(l => {
      if ( !l.startsWith(`| [${id}]`) ) return l;
      const cells = l.split("|");
      if ( cells.length > 4 ) cells[3] = ` ${status} `;
      return cells.join("|");
    });
    fs.writeFileSync(index, lines.join("\n"));
  }
  console.log(`Claimed ${id} — ${task.title}. Owner: ${name}, status: ${status}.\nRead tasks/${task.file} and start; log progress there.`);
}

/* -------------------------------------------- */
/*  Commands                                    */
/* -------------------------------------------- */

function recordBaseline() {
  fs.rmSync(BASE, { recursive: true, force: true });
  for ( const [rel, abs] of listFiles(ROOT) ) {
    fs.mkdirSync(path.dirname(path.join(BASE, rel)), { recursive: true });
    fs.copyFileSync(abs, path.join(BASE, rel));
  }
  fs.writeFileSync(path.join(WORK, "baseline.json"), JSON.stringify({ version: version(), created: new Date().toISOString() }, null, 2));
}

function start(args) {
  if ( fs.existsSync(BASE) && !args.force ) {
    fail("A baseline already exists (.contrib/base). Pack or discard your work first; `start --force` replaces it.");
  }
  recordBaseline();
  console.log(`Baseline recorded (version ${version()}).`);
}

/** One-shot and idempotent: baseline + contributor name. Re-running reports the state. */
function setup(args) {
  if ( fs.existsSync(path.join(ROOT, ".git")) && !args.force ) {
    console.log("This is a git checkout: contribute with branches and pull requests (AGENTS.md §9). "
      + "Use `setup --force` only if you really can't use git here.");
    return;
  }
  if ( (typeof args.name === "string") && args.name.trim() ) writeConfig({ name: args.name.trim() });
  const who = readConfig().name ?? 'not set — run setup --name "Your Name"';
  if ( fs.existsSync(BASE) ) {
    const from = JSON.parse(fs.readFileSync(path.join(WORK, "baseline.json"), "utf8")).version;
    console.log(`Already set up (baseline from version ${from}, ${changes().length} file(s) changed since). Contributor: ${who}.`);
    recommend({ foundry: !!args.foundry });
    return;
  }
  recordBaseline();
  console.log(`Set up for offline contribution (version ${version()}). Contributor: ${who}.`
    + '\nEdit freely now; when done: npm run contrib -- pack --title "T-<nnn>: …"');
  recommend({ foundry: !!args.foundry });
}

function status() {
  const config = readConfig();
  console.log(`Contributor: ${config.name ?? "(not set)"} · bundles packed: ${config.seq ?? 0}`);
  const list = changes();
  if ( !list.length ) return console.log("No changes since the baseline.");
  for ( const c of list ) console.log(`${{ add: "A", modify: "M", delete: "D" }[c.op]}  ${c.path}`);
}

function pack(args) {
  if ( (typeof args.name === "string") && args.name.trim() ) writeConfig({ name: args.name.trim() });
  const name = String(readConfig().name ?? "").trim();
  const title = String(args.title ?? "").trim();
  if ( !name || !title ) fail('Usage: npm run contrib -- pack --title "T-<nnn>: what this does"  (name: setup --name "Your Name")');
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
  const seq = (readConfig().seq ?? 0) + 1;
  const bundle = { format: FORMAT, name, seq, title, created: new Date().toISOString(), baseVersion: baseline.version, files };
  bundle.checksum = hash(JSON.stringify(files));
  const stamp = bundle.created.replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
  fs.mkdirSync(OUTBOX, { recursive: true });
  const file = path.join(OUTBOX, `contrib-${slugOf(name)}-${String(seq).padStart(2, "0")}-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(bundle, null, 1));
  writeConfig({ seq });
  // The next bundle holds only work done after this one.
  recordBaseline();
  console.log(`Packed ${files.length} file(s):`);
  for ( const c of list ) console.log(`  ${{ add: "A", modify: "M", delete: "D" }[c.op]}  ${c.path}`);
  const others = writeOutboxReadme(path.basename(file));
  const rule = "=".repeat(78);
  console.log(`\n${rule}\n  READY TO SEND: bundle #${seq}, "${title}"\n\n  ${file}\n\n`
    + "  Send this one file to Alivas, as an attachment (email, Discord, chat, USB stick…).\n"
    + "  Don't rename, unzip or edit it. It's in the folder \"send-to-alivas\" at the top of your copy"
    + (args["no-open"] ? ".\n" : ", which is opening now.\n")
    + (others ? `  That folder also holds ${others} earlier bundle(s): send any you haven't yet, lowest number first.\n` : "")
    + `${rule}\nKeep working here as usual; the next pack holds only newer changes.`);
  if ( !args["no-open"] ) reveal(file);
}

/** (Re)write send-to-alivas/README.txt listing the bundles, newest first. Returns how many older ones there are. */
function writeOutboxReadme(newest) {
  const bundles = fs.readdirSync(OUTBOX).filter(n => /^contrib-.*\.json$/.test(n)).map(n => {
    try {
      const b = JSON.parse(fs.readFileSync(path.join(OUTBOX, n), "utf8"));
      return { n, seq: b.seq ?? 0, title: b.title, created: String(b.created).slice(0, 16).replace("T", " ") };
    } catch { return { n, seq: 0, title: "(unreadable)", created: "" }; }
  }).sort((a, b) => b.seq - a.seq);
  const text = [
    "SEND THESE FILES TO ALIVAS (the maintainer of Alivas's Triggers)",
    "",
    "Attach them to an email, a Discord or chat message, or copy them to a USB stick: any way works.",
    "Don't rename, unzip or edit them; a checksum inside detects changes.",
    "Send them in number order. Sending one twice is harmless.",
    "",
    ...bundles.map(b => `  #${String(b.seq).padStart(2, "0")}  ${b.n}\n       ${b.title} · packed ${b.created} UTC${b.n === newest ? "   <- newest" : ""}`),
    ""
  ].join("\n");
  fs.writeFileSync(path.join(OUTBOX, "README.txt"), text);
  return bundles.length - 1;
}

/** Show the file in the system file manager (best effort; never fails the pack). */
function reveal(file) {
  try {
    const { spawn } = require("child_process");
    const [cmd, argv] = process.platform === "win32" ? ["explorer.exe", [`/select,${file}`]]
      : process.platform === "darwin" ? ["open", ["-R", file]] : ["xdg-open", [path.dirname(file)]];
    spawn(cmd, argv, { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  } catch {}
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
  const slug = slugOf(bundle.name);
  const seq = bundle.seq ?? 1;
  if ( (seq > 1) && !args.force
    && !git("log", "--all", "--fixed-strings", `--grep=bundle #${seq - 1} from ${bundle.name},`, "--format=%h") ) {
    fail(`Bundle #${seq - 1} from ${bundle.name} has not been taken in yet: bundles apply in order. Take that one in first `
      + "(or `intake <file> --force` if it was lost and you accept the conflicts).");
  }
  const branch = `contrib/${slug}-${String(seq).padStart(2, "0")}-${bundle.created.replace(/[-:]/g, "").replace("T", "-").slice(0, 13)}`;
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

  console.log(`${bundle.title} — bundle #${seq} by ${bundle.name}, made from ${bundle.baseVersion}, ${bundle.created}`);
  console.log(`Branch: ${branch}`);
  for ( const line of report.applied ) console.log(`  ${line}`);
  for ( const p of report.merged ) console.log(`  merged  ${p}`);
  for ( const p of report.same ) console.log(`  already here  ${p}`);
  const author = `${bundle.name} <${slug}@contributors.invalid>`;
  const body = `Offline contribution: bundle #${seq} from ${bundle.name}, made from ${bundle.baseVersion}.`;
  if ( report.conflicts.length ) {
    // The commit message carries "bundle #N from <name>," — the next bundle's order check looks for it.
    console.log(`\nConflicts (resolve, then commit with exactly this — the next bundle's order check needs the message):\n  `
      + `${report.conflicts.join("\n  ")}\n\n  git add -A && git commit --author "${author}" -m "${bundle.title.replace(/"/g, "'")}" -m "${body}"`);
    return;
  }
  git("add", "-A");
  execFileSync("git", ["commit", "-q", "--author", author, "-m", `${bundle.title}\n\n${body}`], { cwd: ROOT, stdio: "inherit" });
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
const COMMANDS = { setup, tasks, claim, start, status, pack, intake };
if ( !COMMANDS[command] ) fail('Usage: npm run contrib -- setup --name "…" | tasks | claim T-<nnn> | status | pack --title "…" | intake <bundle.json>');
COMMANDS[command](args);
