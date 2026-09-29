/**
 * Replace copyrighted rules text in the Box's pack sources with short stubs.
 * Patches keep the TARGET item's own description (PRESERVE), so the text in a patch is never shown in play; only
 * someone dragging the patch item straight from the compendium sees the stub.
 *
 *   node scripts/strip-rules-text.cjs          rewrite the sources
 *   node scripts/strip-rules-text.cjs --check  fail if any long text is left (used by the release script)
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "alivas-box-of-triggers", "packs", "_source");
const KEEP = new Set(["staff-of-the-savants-homebrew.json"]);   // our own text
const KEEP_DIRS = new Set(["weapon-options"]);   // weapon options are written by us
const LIMIT = 450;   // longest text allowed in a published patch (our own effect summaries are shorter)

/** Our own wording for texts copied from books. */
const REWRITE = {
  "Imperceptible Barrier": "+5 AC until the start of your next turn (including against the attack that triggered it); no damage from Magic Missile.",
  "Enlarged": "One size larger; Advantage on Strength checks and saves; weapon attacks deal +1d4 damage.",
  "Reduced": "One size smaller; Disadvantage on Strength checks and saves; weapon attacks deal −1d4 damage.",
  "Cursed": "Mummy Rot: can't regain Hit Points; Hit Point maximum drops by 3d6 every 24 hours; ends with Remove Curse."
};
/** Markup that only appears in text copied from a book or importer (enrichers, references). */
const COPIED = /\[\[\/|&amp;Reference|&Reference|@UUID|\{@/;

const check = process.argv.includes("--check");
const problems = [];
const text = v => String(v ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function scan(o, where, file) {
  if ( typeof o === "string" ) {
    if ( text(o).length > LIMIT ) problems.push(`${file}: ${where} (${text(o).length} chars)`);
    else if ( /\.description$/.test(where) && COPIED.test(o) ) problems.push(`${file}: ${where} (copied markup)`);
  } else if ( o && (typeof o === "object") ) {
    for ( const [k, v] of Object.entries(o) ) scan(v, `${where}.${k}`, file);
  }
}

for ( const dir of fs.readdirSync(ROOT) ) {
  for ( const file of fs.readdirSync(path.join(ROOT, dir)) ) {
    const p = path.join(ROOT, dir, file);
    const d = JSON.parse(fs.readFileSync(p, "utf8"));
    const ours = KEEP.has(file) || KEEP_DIRS.has(dir);
    if ( !check && !ours ) {
      const src = d.system?.source ?? {};
      const where = [src.book, src.page ? `p. ${src.page}` : ""].filter(Boolean).join(" ");
      d.system.description = {
        value: `<p><em>Alivas's Box of Triggers — mechanics patch for ${d.name}${where ? ` (${where})` : ""}. `
          + `Patched items keep their own description; this entry carries no rules text.</em></p>`,
        chat: ""
      };
      if ( d.system.unidentified ) d.system.unidentified.description = "";
      if ( d.system.activation?.condition ) d.system.activation.condition = "";
      for ( const a of Object.values(d.system.activities ?? {}) ) {
        if ( a.activation?.condition ) a.activation.condition = "";
        if ( text(a.description?.value).length > 60 ) a.description.value = "";
        if ( text(a.description?.chatFlavor).length > 60 ) a.description.chatFlavor = "";
      }
      for ( const e of d.effects ?? [] ) {
        if ( REWRITE[e.name] ) e.description = `<p>${REWRITE[e.name]}</p>`;
        else if ( COPIED.test(e.description ?? "") ) e.description = "";
      }
      fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
    }
    if ( !ours ) scan(d, "", `${dir}/${file}`);
  }
}
if ( problems.length ) {
  console.error("Long text left in pack sources:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(check ? "No long rules text in pack sources." : "Rules text stripped.");
