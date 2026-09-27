/**
 * Stamp both modules' module.json with a version and the public URLs for it.
 *   node scripts/set-version.cjs 0.3.0
 */
const fs = require("fs");
const path = require("path");

const REPO = "AlivasGR/alivas-triggers";
const BASE = `https://github.com/${REPO}`;
const version = process.argv[2];
if ( !/^\d+\.\d+\.\d+$/.test(version ?? "") ) throw new Error("Usage: node scripts/set-version.cjs X.Y.Z");

const common = {
  version,
  authors: [{ name: "Alivas", url: "https://github.com/AlivasGR" }],
  url: BASE,
  license: `${BASE}/blob/main/LICENSE`,
  readme: `${BASE}/blob/main/README.md`,
  bugs: `${BASE}/issues`,
  changelog: `${BASE}/releases`
};
const manifestUrl = id => `${BASE}/releases/latest/download/${id}.json`;
const downloadUrl = id => `${BASE}/releases/download/v${version}/${id}.zip`;

for ( const id of ["alivas-engine-of-triggers", "alivas-box-of-triggers"] ) {
  const p = path.join(__dirname, "..", id, "module.json");
  const m = JSON.parse(fs.readFileSync(p, "utf8"));
  Object.assign(m, common, { manifest: manifestUrl(id), download: downloadUrl(id) });
  if ( id === "alivas-box-of-triggers" ) {
    m.relationships ??= {};
    m.relationships.requires = [{ id: "alivas-engine-of-triggers", type: "module", manifest: manifestUrl("alivas-engine-of-triggers"),
      compatibility: { minimum: version } }];
  }
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
  console.log(`${id} → ${version}`);
}
