/**
 * Alivas's Box of Triggers — mechanical patches for specific items, applied wherever those items appear.
 *
 * Each patch in the "fixed-items" compendium carries `flags.alivas-box-of-triggers`:
 *   { version: 2, match: [ key, key, ... ] }
 * A key is a set of fields that must ALL equal the target item's; any one key matching is enough:
 *   name, type         always present
 *   book, page         system.source (e.g. Plutonium: "PHB 2024" / "286")
 *   compendiumSource   _stats.compendiumSource (e.g. dragged from dnd5e's compendium)
 *   owner              name of the actor that holds the item — only for generic monster features whose other
 *                      keys are shared across stat blocks (e.g. every monster's "Rend")
 *
 * A patch replaces an item's MECHANICS and keeps everything else:
 *   - kept: ID, description, image, source label, play state (PRESERVE)
 *   - kept for spells: how this actor casts it (method, preparation, uses, casting ability, per-activity consumption)
 *   - replaced: activities and the rest of `system`, and the item's embedded effects
 * The applied version is stamped on the item; a patch is re-applied only when its version goes up.
 *
 * A patch may also carry `keep: { activities: [type, ...], paths: [path, ...] }`: the target's own activities of those
 * types and those system fields are kept instead of the patch's (Unarmed Strike keeps a Monk's Attack and damage).
 *
 * Combat Maneuvers (flag `maneuvers: true` on the "Combat Maneuvers" patch):
 *   - Setting "Combat maneuvers for every creature" (world, default on): every world Actor of type character or npc gets
 *     the item from this pack when created (preCreateActor), and at ready the lead GM adds it to existing world actors
 *     that lack one. Idempotent: an actor that already holds an item flagged `maneuvers` (or with identifier
 *     "combat-maneuvers") is skipped. Nothing is ever removed when the setting is switched off.
 *   - Setting "Include homebrew maneuvers" (world, default off): activities and effects flagged
 *     `flags.alivas-box-of-triggers.homebrew` are REMOVED from the granted copy (not hidden), whenever the copy is built:
 *     on grant, on patch (buildPatched), and on a setting change - the lead GM then re-syncs every actor's copy: it
 *     deletes homebrew activities/effects when off and adds back the missing ones from the pack when on. Only activities
 *     flagged homebrew are ever deleted, so a user's own additions to the item survive. "Review & apply" on an
 *     outdated copy also honours the setting, through buildPatched.
 *
 * Patches are applied:
 *   - on demand: Settings → Alivas's Box of Triggers → Review & apply (choose which items)
 *   - automatically on creation, if the "Patch on import" setting is on: items created on their own (Plutonium,
 *     compendium drags, copies) and items inside newly created actors (monsters dragged from a compendium)
 *   - automatically when Plutonium's "Update existing" import overwrites an already-patched item
 */

const MODULE_ID = "alivas-box-of-triggers";
const PACK_ID = `${MODULE_ID}.fixed-items`;
const OPTIONS_PACK_ID = `${MODULE_ID}.weapon-options`;
const ENGINE_ID = "alivas-engine-of-triggers";

/** Fields that reflect play or presentation rather than mechanics. */
const PRESERVE = [
  "name", "img", "system.description", "system.source", "system.uses.spent", "system.equipped", "system.attuned",
  "system.quantity", "system.identified", "system.container", "sort", "folder", "ownership",
  `flags.${MODULE_ID}.schoolChoice.chosen`
];

/** Additional fields kept on spells: how this actor casts it. */
const PRESERVE_SPELL = ["system.method", "system.prepared", "system.uses", "system.ability", "system.sourceItem"];

/** Loaded patches: { data, version, keys }. Filled at ready; the create hooks need them synchronously. */
let PATCHES = [];

/* -------------------------------------------- */
/*  Matching                                    */
/* -------------------------------------------- */

/**
 * The fields a match key can test, read from raw item data.
 * @param {object} data      Item source data.
 * @param {string} [owner]   Name of the owning actor.
 */
function describe(data, owner) {
  return {
    name: data.name, type: data.type,
    book: data.system?.source?.book ?? "", page: String(data.system?.source?.page ?? ""),
    compendiumSource: data._stats?.compendiumSource ?? "", owner: owner ?? "", identifier: data.system?.identifier ?? ""
  };
}

function keyMatches(desc, key) {
  for ( const [field, value] of Object.entries(key) ) {
    if ( String(desc[field] ?? "") !== String(value ?? "") ) return false;
  }
  return true;
}

/**
 * Find the patch for an item, if any.
 * @param {object} data     Item source data.
 * @param {string} [owner]  Name of the owning actor.
 */
function findPatch(data, owner) {
  // Spells dnd5e keeps in sync for an item's Cast activity (e.g. an Enspelled weapon) are never patched: their
  // consumption belongs to that item.
  if ( data.flags?.dnd5e?.cachedFor ) return null;
  const desc = describe(data, owner);
  const found = PATCHES.find(p => p.keys.some(k => keyMatches(desc, k)));
  if ( found ) return found;
  // A chosen option named after its feature ("Fighting Style: Protection", as Plutonium's Charactermancer names it)
  // matches the option's own patch ("Protection").
  const [parent, ...rest] = String(data.name ?? "").split(/:\s+/);
  const option = rest.join(": ").trim();
  // The other way round: an option imported on its own ("Heightened Spell", from Plutonium's option importer) matches
  // a patch keyed by its full name ("Metamagic: Heightened Spell") — same type and book, any page.
  if ( !option ) return PATCHES.find(p => p.keys.some(k => {
    if ( !String(k.name ?? "").includes(": ") ) return false;
    if ( String(k.name).split(/:\s+/).slice(1).join(": ").trim() !== desc.name ) return false;
    const { name, page, identifier, ...rest } = k;
    return keyMatches(desc, rest);
  })) ?? null;
  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const optionDesc = { ...desc, name: option, identifier: desc.identifier.replace(new RegExp(`^${slug(parent)}-`), "") };
  return PATCHES.find(p => p.keys.some(k => keyMatches(optionDesc, k))) ?? null;
}

async function loadPatches() {
  const pack = game.packs.get(PACK_ID);
  if ( !pack ) return [];
  const docs = await pack.getDocuments();
  PATCHES = docs.map(doc => {
    const { version = 1, match = [] } = doc.flags[MODULE_ID] ?? {};
    return { data: doc.toObject(), version, keys: Array.isArray(match) ? match : [match] };
  });
  return PATCHES;
}

/* -------------------------------------------- */
/*  Building a patched item                     */
/* -------------------------------------------- */

/**
 * Carry each old activity's consumption onto the patch activity of the same type.
 */
function keepConsumption(newActivities, oldActivities) {
  const pool = Object.values(oldActivities ?? {});
  for ( const activity of Object.values(newActivities ?? {}) ) {
    const i = pool.findIndex(a => a.type === activity.type);
    const old = i >= 0 ? pool.splice(i, 1)[0] : null;
    if ( old?.consumption ) activity.consumption = foundry.utils.deepClone(old.consumption);
  }
}

/**
 * Consumption targets written as "identifier:monks-focus|focus-point" (a pool on the same actor, by identifier — the
 * first that has uses) become that item's ID on this actor. Without a match the target is cleared.
 * @param {object} data                 Patched item data (changed in place).
 * @param {Iterable<object>} [items]    The actor's items (documents or source data).
 */
function resolveIdentifierTargets(data, items) {
  const list = Array.from(items ?? []);
  for ( const activity of Object.values(data.system?.activities ?? {}) ) {
    for ( const t of activity.consumption?.targets ?? [] ) {
      if ( (typeof t.target !== "string") || !t.target.startsWith("identifier:") ) continue;
      const found = t.target.slice(11).split("|").map(id => list.find(i => (i.system?.identifier === id) && i.system?.uses?.max)).find(Boolean);
      // Not there yet (the pool is imported after this item): left as is, resolved when the activity is used.
      if ( found?._id ?? found?.id ) t.target = found._id ?? found.id;
    }
  }
}

/** An "identifier:" consumption target still unresolved when the activity is used: resolve it now and save it. */
Hooks.on("dnd5e.preActivityConsumption", activity => {
  const item = activity?.item;
  const actor = activity?.actor;
  if ( !item || !actor ) return;
  const targets = activity.consumption?.targets ?? [];
  if ( !targets.some(t => String(t.target ?? "").startsWith("identifier:")) ) return;
  const source = item.toObject();
  resolveIdentifierTargets(source, actor.items);
  const fixed = source.system.activities?.[activity.id]?.consumption?.targets ?? [];
  targets.forEach((t, i) => { if ( fixed[i]?.target && !fixed[i].target.startsWith("identifier:") ) t.target = fixed[i].target; });
  if ( item.isOwner ) item.update({ [`system.activities.${activity.id}.consumption.targets`]: fixed });
});

/**
 * Produce the patched version of an item's data.
 * @param {object} patch  A PATCHES entry.
 * @param {object} old    The target item's current source data.
 * @param {Iterable<object>} [items]  The owning actor's items, to resolve "identifier:" consumption targets.
 * @returns {object}      Full item data: the target's ID and preserved fields, the patch's mechanics.
 */
function buildPatched(patch, old, items) {
  const data = foundry.utils.deepClone(patch.data);
  data._id = old._id;
  const patchKeep = patch.data.flags?.[MODULE_ID]?.keep ?? {};
  const keep = [...(old.type === "spell" ? [...PRESERVE, ...PRESERVE_SPELL] : PRESERVE), ...(patchKeep.paths ?? [])];
  for ( const path of keep ) {
    const value = foundry.utils.getProperty(old, path);
    if ( value !== undefined ) foundry.utils.setProperty(data, path, foundry.utils.deepClone(value));
  }
  // The target's own activities of these types replace the patch's (e.g. a Monk's Unarmed Strike Attack).
  for ( const type of patchKeep.activities ?? [] ) {
    const own = Object.entries(old.system?.activities ?? {}).filter(([, a]) => a.type === type);
    if ( !own.length ) continue;
    for ( const [aid, a] of Object.entries(data.system.activities) ) if ( a.type === type ) delete data.system.activities[aid];
    for ( const [aid, a] of own ) data.system.activities[aid] = foundry.utils.deepClone(a);
  }
  if ( old.type === "spell" ) keepConsumption(data.system.activities, old.system?.activities);
  resolveIdentifierTargets(data, items);
  data.flags = foundry.utils.mergeObject(foundry.utils.deepClone(old.flags ?? {}), data.flags ?? {}, { inplace: false });
  data.flags[MODULE_ID] = { ...data.flags[MODULE_ID], version: patch.version };
  if ( old._stats ) data._stats = foundry.utils.deepClone(old._stats);
  if ( data.flags[MODULE_ID].maneuvers && !homebrewOn() ) stripHomebrew(data);
  return data;
}

/**
 * Patch an existing item document in place.
 */
async function applyOne(patch, item) {
  const data = buildPatched(patch, item.toObject(), item.actor?.items);
  const options = { recursive: false, diff: false, [MODULE_ID]: { patching: true } };
  await item.update({ img: data.img, system: data.system, flags: data.flags }, options);
  const oldEffectIds = item.effects.map(e => e.id);
  if ( oldEffectIds.length ) await item.deleteEmbeddedDocuments("ActiveEffect", oldEffectIds, options);
  if ( data.effects?.length ) await item.createEmbeddedDocuments("ActiveEffect", data.effects, { ...options, keepId: true });
  if ( item.getFlag(MODULE_ID, "schoolChoice") ) await rebuildSchoolEffect(item);
}

/* -------------------------------------------- */
/*  Automatic patching                          */
/* -------------------------------------------- */

const patchOnCreate = () => game.settings.get(MODULE_ID, "patchOnCreate");

/** A single item is about to be created (Plutonium import, compendium drag, copy between actors…). */
Hooks.on("preCreateItem", (item, data, options, userId) => {
  if ( (userId !== game.userId) || options[MODULE_ID]?.patching ) return;
  syncSchoolEffectSource(item);
  if ( !patchOnCreate() ) return;
  const source = item.toObject();
  const patch = findPatch(source, item.parent?.name);
  if ( !patch || (source.flags?.[MODULE_ID]?.version === patch.version) ) return;
  const patched = buildPatched(patch, source, item.parent?.items);
  item.updateSource({ system: patched.system, flags: patched.flags, effects: patched.effects }, { recursive: false });
  syncSchoolEffectSource(item);
  console.log(`${MODULE_ID} | Patched "${patched.name}" on import (v${patch.version})`);
});

/** An actor is about to be created with items already inside (a monster dragged from a compendium…). */
Hooks.on("preCreateActor", (actor, data, options, userId) => {
  if ( (userId !== game.userId) || !patchOnCreate() ) return;
  const source = actor.toObject();
  let count = 0;
  const items = (source.items ?? []).map(itemData => {
    const patch = findPatch(itemData, source.name);
    if ( !patch || (itemData.flags?.[MODULE_ID]?.version === patch.version) ) return itemData;
    count++;
    return buildPatched(patch, itemData, source.items);
  });
  if ( !count ) return;
  actor.updateSource({ items }, { recursive: false });
  console.log(`${MODULE_ID} | Patched ${count} item(s) on "${source.name}" on import`);
});

/** Plutonium's "Update existing" import overwrote an item: re-apply its patch. */
Hooks.on("updateItem", (item, changes, options, userId) => {
  if ( (userId !== game.userId) || options[MODULE_ID]?.patching || !patchOnCreate() ) return;
  if ( !foundry.utils.hasProperty(changes, "flags.plutonium") ) return;
  const patch = findPatch(item.toObject(), item.parent?.name);
  if ( !patch ) return;
  applyOne(patch, item).then(() => console.log(`${MODULE_ID} | Re-patched "${item.name}" after a Plutonium update`));
});

/* -------------------------------------------- */
/*  Review & apply                              */
/* -------------------------------------------- */

/**
 * Every patchable item in the world and its status.
 * @returns {Promise<object[]>}
 */
async function plan() {
  await loadPatches();
  const candidates = [
    ...game.actors.contents.flatMap(a => a.items.contents.map(item => ({ item, owner: a.name }))),
    ...game.items.contents.map(item => ({ item, owner: "" }))
  ];
  const rows = [];
  for ( const { item, owner } of candidates ) {
    for ( const link of castLinks(item) ) rows.push(link);
    const patch = findPatch(item.toObject(), owner);
    if ( !patch ) continue;
    const current = item.getFlag(MODULE_ID, "version");
    rows.push({ patch, item, owner, current, version: patch.version, status: current === patch.version ? "current" : "outdated" });
  }
  return rows;
}

/* -------------------------------------------- */
/*  Items that cast a patched spell             */
/* -------------------------------------------- */

/**
 * An item with a Cast activity (Enspelled weapon, wand, staff…) whose spell has a patch with reaction popups gets
 * those popups too — paid with the item's own charges, the way the Cast activity pays (dnd5e keeps a linked copy of
 * the spell for it, which is never patched itself). One plan row per such Cast activity.
 * @param {Item5e} item
 * @returns {object[]}  rows: { link: true, item, owner, activity, spell, patch, reactions, current, version, status }
 */
function castLinks(item) {
  const rows = [];
  const actor = item.parent;
  for ( const activity of item.system?.activities ?? [] ) {
    if ( activity.type !== "cast" ) continue;
    const cached = actor?.items.find(i => i.flags?.dnd5e?.cachedFor?.endsWith(`Activity.${activity.id}`));
    const spellData = cached?.toObject() ?? null;
    if ( !spellData ) continue;
    delete spellData.flags?.dnd5e?.cachedFor;
    const patch = findPatch(spellData, actor?.name);
    const decls = patch?.data.flags?.[ENGINE_ID]?.reactions;
    if ( !Array.isArray(decls) || !decls.length ) continue;
    const charges = Number(activity.consumption?.targets?.find(c => c.type === "itemUses" && !c.target)?.value) || 1;
    const level = activity.spell?.level || cached.system.level || 1;
    // If the spell's own activity puts effects on (Shield's +5 AC), cast it for free after paying, so they apply.
    const castsEffects = cached.system.activities?.some(a => a.effects?.length) ?? false;
    const reactions = decls.map(d => {
      const { activity: _, ...rest } = foundry.utils.deepClone(d);
      return { ...rest, label: `${d.label ?? cached.name} (${item.name})`, cost: { uses: charges, level, ...(castsEffects ? { spell: cached.id } : {}) },
        castLink: activity.id, detail: `${charges} charge${charges === 1 ? "" : "s"}${d.detail ? `: ${d.detail}` : ""}` };
    });
    const current = item.getFlag(MODULE_ID, `castLinks.${activity.id}`);
    rows.push({ link: true, item, owner: actor?.name ?? "", activity, spell: cached.name, patch, reactions, current,
      version: patch.version, status: current === patch.version ? "current" : "outdated" });
  }
  return rows;
}

/** Give an item the reaction popups of the spell its Cast activity casts (replacing earlier ones for that activity). */
async function applyCastLink(row) {
  const kept = (row.item.getFlag(ENGINE_ID, "reactions") ?? []).filter(r => r.castLink !== row.activity.id);
  await row.item.update({
    [`flags.${ENGINE_ID}.reactions`]: [...kept, ...row.reactions],
    [`flags.${MODULE_ID}.castLinks.${row.activity.id}`]: row.version
  });
}

/**
 * Apply patches.
 * @param {object} [options]
 * @param {number[]} [options.only]  Indices into plan() to apply; default all outdated.
 */
async function apply({ only }={}) {
  const rows = await plan();
  rows.forEach((row, i) => {
    if ( row.status !== "outdated" ) return;
    if ( only && !only.includes(i) ) row.skip = true;
  });
  for ( const row of rows ) {
    if ( (row.status !== "outdated") || row.skip ) continue;
    try {
      if ( row.link ) await applyCastLink(row);
      else await applyOne(row.patch, row.item);
      row.result = "updated";
    } catch(err) {
      console.error(`${MODULE_ID} | Failed to patch ${row.item.uuid}`, err);
      row.result = `failed: ${err.message}`;
    }
  }
  return rows;
}

function planTable(rows, { selectable=false }={}) {
  const label = r => r.result ?? (r.skip ? "Skipped" : (r.status === "current" ? "Up to date" : "Will be updated"));
  const tr = rows.map((r, i) => `<tr>
    <td>${selectable && r.status === "outdated" ? `<input type="checkbox" name="row" value="${i}" checked>` : ""}</td>
    <td>${r.item.name}${r.link ? ` <em>(casts ${r.spell})</em>` : ""}</td><td>${r.owner || "World item"}</td>
    <td>${r.current ?? "—"} → ${r.version}</td><td>${label(r)}</td></tr>`).join("");
  return `<div style="max-height:60vh;overflow-y:auto"><table><thead><tr><th></th><th>Item</th><th>On</th><th>Version</th><th>Status</th></tr></thead>
    <tbody>${tr || `<tr><td colspan="5">No patchable items in this world.</td></tr>`}</tbody></table></div>`;
}

async function openDialog() {
  const rows = await plan();
  const pending = rows.filter(r => r.status === "outdated").length;
  const { DialogV2 } = foundry.applications.api;
  if ( !pending ) return DialogV2.prompt({
    window: { title: "Alivas's Box of Triggers" }, content: `<p>Everything is up to date.</p>${planTable(rows)}`, ok: { label: "Close" }
  });
  const intro = `<p>Tick the items to patch. Mechanics are replaced; description, image, uses spent, preparation, `
    + `equipment, attunement and how spells are cast are kept. Best done outside combat.</p>`;
  const selected = await DialogV2.confirm({
    window: { title: "Alivas's Box of Triggers" }, position: { width: 640 }, content: intro + planTable(rows, { selectable: true }),
    yes: { label: "Patch selected", callback: (event, button, dialog) => Array.from(
      dialog.element.querySelectorAll('input[name="row"]:checked'), input => Number(input.value)
    ) },
    no: { label: "Cancel" }
  });
  if ( !Array.isArray(selected) || !selected.length ) return;
  const results = await apply({ only: selected });
  const done = results.filter(r => r.result === "updated").length;
  const failed = results.filter(r => r.result?.startsWith("failed")).length;
  ui.notifications[failed ? "warn" : "info"](`Alivas's Box of Triggers: patched ${done}${failed ? `, failed ${failed}` : ""}.`);
  return DialogV2.prompt({
    window: { title: "Alivas's Box of Triggers — result" }, position: { width: 640 }, content: planTable(results), ok: { label: "Close" }
  });
}

/** Settings-menu entry point. registerMenu needs an application class; this one only opens the dialog. */
class FixesMenu extends foundry.applications.api.ApplicationV2 {
  async render() {
    await openDialog();
    return this;
  }
}

/* -------------------------------------------- */
/*  Combat Maneuvers                            */
/* -------------------------------------------- */

const MANEUVER_TYPES = ["character", "npc"];
/** A creature that should have Combat Maneuvers: a character or npc that isn't an Item Piles pile, merchant or vault. */
const wantsManeuvers = actor => MANEUVER_TYPES.includes(actor?.type)
  && !(actor.flags?.["item-piles"]?.data?.enabled ?? actor.getFlag?.("item-piles", "data")?.enabled);
const grantOn = () => game.settings.get(MODULE_ID, "grantManeuvers");
const homebrewOn = () => game.settings.get(MODULE_ID, "homebrewManeuvers");
const maneuverPatch = () => PATCHES.find(p => p.data.flags?.[MODULE_ID]?.maneuvers) ?? null;
/** Source data of an item, or an Item document: is it the Combat Maneuvers item? */
const isManeuvers = i => !!(i.flags?.[MODULE_ID]?.maneuvers || (i.system?.identifier === "combat-maneuvers"));

/** Remove homebrew activities and effects from item data, in place. */
function stripHomebrew(data) {
  for ( const [aid, a] of Object.entries(data.system?.activities ?? {}) ) {
    if ( a.flags?.[MODULE_ID]?.homebrew ) delete data.system.activities[aid];
  }
  data.effects = (data.effects ?? []).filter(e => !e.flags?.[MODULE_ID]?.homebrew);
}

/** A fresh copy of the Combat Maneuvers item for an actor, honouring the homebrew setting. */
function maneuverData() {
  const patch = maneuverPatch();
  if ( !patch ) return null;
  const data = foundry.utils.deepClone(patch.data);
  data._id = foundry.utils.randomID();
  data.flags[MODULE_ID] = { ...data.flags[MODULE_ID], version: patch.version };
  delete data._key;
  if ( !homebrewOn() ) stripHomebrew(data);
  return data;
}

/** A world actor is about to be created: include Combat Maneuvers. */
Hooks.on("preCreateActor", (actor, data, options, userId) => {
  if ( (userId !== game.userId) || !wantsManeuvers(actor) || !grantOn() ) return;
  const items = actor.toObject().items ?? [];
  if ( items.some(isManeuvers) ) return;
  const item = maneuverData();
  if ( item ) actor.updateSource({ items: [...items, item] });
});

/** Make an existing copy match the homebrew setting: delete homebrew parts when off, add the missing ones when on. */
async function syncManeuverItem(item, patch) {
  const want = foundry.utils.deepClone(patch.data);
  if ( !homebrewOn() ) stripHomebrew(want);
  const options = { [MODULE_ID]: { patching: true } };
  const update = {};
  for ( const a of item.system.activities ) {
    if ( !(a.id in want.system.activities) && a.flags?.[MODULE_ID]?.homebrew ) update[`system.activities.-=${a.id}`] = null;
  }
  for ( const [aid, a] of Object.entries(want.system.activities) ) {
    if ( !item.system.activities.has(aid) ) update[`system.activities.${aid}`] = a;
  }
  if ( !foundry.utils.isEmpty(update) ) await item.update(update, { ...options, diff: false });
  const gone = item.effects.filter(e => e.getFlag(MODULE_ID, "homebrew") && !want.effects.some(w => w._id === e.id)).map(e => e.id);
  if ( gone.length ) await item.deleteEmbeddedDocuments("ActiveEffect", gone, options);
  const missing = want.effects.filter(w => !item.effects.has(w._id)).map(w => { const { _key, ...rest } = w; return rest; });
  if ( missing.length ) await item.createEmbeddedDocuments("ActiveEffect", missing, { ...options, keepId: true });
}

/**
 * Lead GM: every world character/npc gets the item (setting on) and every copy matches the homebrew setting.
 * Idempotent; safe to run again on any setting change.
 */
async function syncManeuvers() {
  if ( !isLeadGM() ) return;
  await loadPatches();
  const patch = maneuverPatch();
  if ( !patch ) return;
  for ( const actor of game.actors.contents ) {
    if ( !wantsManeuvers(actor) ) continue;
    try {
      const have = actor.items.filter(i => isManeuvers(i));
      if ( !have.length ) {
        if ( !grantOn() ) continue;
        const data = maneuverData();
        if ( data ) await actor.createEmbeddedDocuments("Item", [data], { keepId: true, [MODULE_ID]: { patching: true } });
      } else for ( const item of have ) await syncManeuverItem(item, patch);
    } catch(err) {
      console.error(`${MODULE_ID} | Combat Maneuvers sync failed for "${actor.name}"`, err);
    }
  }
}

/** The Engine's lead-GM test (one GM window does shared work). */
function isLeadGM() {
  const lead = game.modules.get(ENGINE_ID)?.api?.creatures?.isLeadGM;
  return lead ? lead() : (game.user.isGM && (game.users.activeGM === game.user));
}

/* -------------------------------------------- */
/*  Weapon options                              */
/* -------------------------------------------- */

/**
 * Weapon options are carrier items in the "weapon-options" compendium, flagged
 * `flags.alivas-box-of-triggers.weaponOption = { id, melee }`. Dropping one onto a weapon's sheet copies its activities and
 * effects into the weapon (fresh IDs, activity→effect links remapped), permanently. Re-dropping replaces the copy.
 */
async function applyWeaponOption(weapon, option) {
  const spec = option.flags[MODULE_ID]?.weaponOption;
  if ( !spec?.id ) throw new Error(`${option.name} is not a weapon option`);
  if ( weapon.type !== "weapon" ) {
    ui.notifications.warn(`${option.name} can only be added to a weapon.`);
    return false;
  }
  if ( spec.melee && !weapon.system.type?.value?.endsWith("M") && (weapon.system.type?.value !== "natural") ) {
    ui.notifications.warn(`${option.name} needs a melee weapon.`);
    return false;
  }
  const mark = { option: spec.id, source: option.uuid };

  const oldActivities = weapon.system.activities.filter(a => a.flags?.[MODULE_ID]?.option === spec.id).map(a => a.id);
  const oldEffects = weapon.effects.filter(e => e.flags?.[MODULE_ID]?.option === spec.id).map(e => e.id);
  if ( oldEffects.length ) await weapon.deleteEmbeddedDocuments("ActiveEffect", oldEffects);
  if ( oldActivities.length ) {
    await weapon.update(Object.fromEntries(oldActivities.map(id => [`system.activities.-=${id}`, null])));
  }

  const idMap = {};
  const effects = option.effects.map(e => {
    const data = e.toObject();
    idMap[data._id] = foundry.utils.randomID();
    data._id = idMap[e.id];
    data.transfer = false;
    foundry.utils.setProperty(data, `flags.${MODULE_ID}`, { ...(data.flags?.[MODULE_ID] ?? {}), ...mark });
    return data;
  });
  if ( effects.length ) await weapon.createEmbeddedDocuments("ActiveEffect", effects, { keepId: true });

  const updates = {};
  for ( const activity of option.system.activities ) {
    const data = activity.toObject();
    const spec = data.flags?.[MODULE_ID]?.weaponDamage;
    data._id = foundry.utils.randomID();
    data.effects = (data.effects ?? []).map(e => ({ ...e, _id: idMap[e._id] ?? e._id }));
    if ( spec ) data.damage = { ...(data.damage ?? {}), includeBase: false, parts: weaponDamageParts(weapon, spec) };
    if ( spec?.matchRange ) foundry.utils.setProperty(data, "attack.type.value", /R$/.test(weapon.system.type?.value ?? "") ? "ranged" : "melee");
    foundry.utils.setProperty(data, `flags.${MODULE_ID}`, { ...mark, ...(spec ? { weaponDamage: spec } : {}) });
    updates[`system.activities.${data._id}`] = data;
  }
  await weapon.update(updates);
  ui.notifications.info(`${weapon.name} can now use ${option.name.replace(/\s*\(Weapon Option\)$/, "")}.`);
  return true;
}

/** One die size up: d4 → d6 → d8 → d10 → d12 (a d12 stays a d12). */
const STEP = { 4: 6, 6: 8, 8: 10, 10: 12, 12: 12 };

/**
 * Damage parts for a weapon option built from the weapon it's dropped on (activity flag "weaponDamage"):
 *   { step: 1,              the weapon's die one size up (only if it has a single damage die)
 *     explode: true,        dice explode on their highest number
 *     weaponTypes: true,    offer the weapon's own damage types too (chosen when rolling)
 *     types: ["cold"],      the spell's damage type(s), offered first
 *     extra: { formula, type },    extra dice, e.g. the cantrip's level-based damage
 *     matchRange: true }    melee or ranged attack to match the weapon
 */
function weaponDamageParts(weapon, spec) {
  const base = weapon.system.damage?.base ?? {};
  let number = base.number || 1;
  let die = base.denomination || 4;
  if ( spec.step && (number === 1) ) die = STEP[die] ?? die;
  const x = spec.explode ? "x" : "";
  const types = [...new Set([...(spec.types ?? []), ...(spec.weaponTypes ? Array.from(base.types ?? []) : [])])];
  const parts = [{ number: null, denomination: null, bonus: "", types, custom: { enabled: true, formula: `${number}d${die}${x} + @mod` },
    scaling: { mode: "", number: null, formula: "" } }];
  if ( spec.extra?.formula ) parts.push({ number: null, denomination: null, bonus: "", types: [spec.extra.type],
    custom: { enabled: true, formula: `${spec.extra.formula}${x}` }, scaling: { mode: "", number: null, formula: "" } });
  return parts;
}

Hooks.on("dnd5e.dropItemSheetData", (item, sheet, data) => {
  if ( (data?.type !== "Item") || !data.uuid?.startsWith(`Compendium.${OPTIONS_PACK_ID}.`) ) return;
  if ( !item.isOwner ) return false;
  fromUuid(data.uuid).then(option => applyWeaponOption(item, option)).catch(err => {
    console.error(`${MODULE_ID} | Could not add weapon option`, err);
    ui.notifications.error(`${MODULE_ID}: could not add weapon option — see console.`);
  });
  return false;
});

/* -------------------------------------------- */
/*  School choice                               */
/* -------------------------------------------- */

/*
 * An item flagged `flags.alivas-box-of-triggers.schoolChoice` lets its owner pick schools of magic:
 *   { groups: [{ id, label, count, value }], keys: ["attack", "dc"], chosen: { <group id>: [school, …] } }
 * Its effect flagged `schoolEffect: true` is generated from `chosen`: for every chosen school and every key, a
 * Rules → Bonus change of the group's value, conditioned on item.school ("attack" is dnd5e's attack rule, "dc" is
 * the engine's save/check DC rule). Make that effect transfer to the actor; dnd5e suppresses it while the item
 * needs attunement and isn't attuned.
 * The owner chooses when attuning, and again with any activity flagged `chooseSchools: true` (give it its own
 * uses, e.g. 1 per long rest).
 */

const schoolLabel = id => CONFIG.DND5E.spellSchools[id]?.label ?? id;

function schoolEffectChanges(spec) {
  const changes = [];
  for ( const group of spec?.groups ?? [] ) {
    for ( const school of spec.chosen?.[group.id] ?? [] ) {
      for ( const key of spec.keys ?? ["attack", "dc"] ) changes.push({
        key, type: "dnd5e.bonus", value: String(group.value), phase: "initial",
        conditions: JSON.stringify([{ k: "item.school", v: school }])
      });
    }
  }
  return changes;
}

function schoolSummary(spec) {
  const parts = (spec?.groups ?? []).map(group => {
    const chosen = spec.chosen?.[group.id] ?? [];
    const sign = group.value > 0 ? `+${group.value}` : `${group.value}`.replace("-", "−");
    return chosen.length ? `${sign} ${chosen.map(schoolLabel).join(", ")}` : null;
  }).filter(Boolean);
  return parts.length ? parts.join("; ") : "no schools chosen";
}

/** Generated fields of the school effect. */
function schoolEffectUpdate(itemName, spec) {
  const summary = schoolSummary(spec);
  return {
    name: `${itemName} (${summary})`,
    description: `<p>Spell attack rolls and spell save DCs: ${summary}.</p>`,
    system: { changes: schoolEffectChanges(spec) }
  };
}

/** Before creation: make the school effect match the item's chosen schools. */
function syncSchoolEffectSource(item) {
  const spec = item._source.flags?.[MODULE_ID]?.schoolChoice;
  if ( !spec ) return;
  const effects = (item._source.effects ?? []).map(e => e.flags?.[MODULE_ID]?.schoolEffect
    ? foundry.utils.mergeObject(e, schoolEffectUpdate(item._source.name, spec), { inplace: false })
    : e);
  item.updateSource({ effects });
}

/** An existing item: make the school effect match its chosen schools. */
async function rebuildSchoolEffect(item) {
  const spec = item.getFlag(MODULE_ID, "schoolChoice");
  const effect = item.effects.find(e => e.getFlag(MODULE_ID, "schoolEffect"));
  if ( !spec || !effect ) return;
  await effect.update(schoolEffectUpdate(item.name, spec));
}

/**
 * Ask the owner to choose schools, then store them and rebuild the effect.
 * @returns {Promise<boolean>}  Whether a choice was saved.
 */
async function chooseSchools(item) {
  item = item.parent?.items?.get(item.id) ?? item; // activity use can hand over a temporary copy of the item
  const spec = item.getFlag(MODULE_ID, "schoolChoice");
  if ( !spec?.groups?.length ) return false;
  const { DialogV2 } = foundry.applications.api;
  let chosen = foundry.utils.deepClone(spec.chosen ?? {});
  for ( ;; ) {
    const header = spec.groups.map(g => `<th>${g.label}<br><small>choose ${g.count}</small></th>`).join("");
    const rows = Object.keys(CONFIG.DND5E.spellSchools).map(school => `<tr><td>${schoolLabel(school)}</td>${
      spec.groups.map(g => `<td style="text-align:center"><input type="checkbox" name="${g.id}" value="${school}"${
        (chosen[g.id] ?? []).includes(school) ? " checked" : ""}></td>`).join("")}</tr>`).join("");
    const result = await DialogV2.prompt({
      window: { title: `${item.name}: choose schools` },
      content: `<table><thead><tr><th>School</th>${header}</tr></thead><tbody>${rows}</tbody></table>`,
      ok: {
        label: "Save",
        callback: (event, button, dialog) => Object.fromEntries(spec.groups.map(g => [g.id, Array.from(
          dialog.element.querySelectorAll(`input[name="${g.id}"]:checked`), input => input.value
        )]))
      },
      rejectClose: false
    });
    if ( !result ) return false;
    chosen = result;
    const wrongCount = spec.groups.find(g => chosen[g.id].length !== g.count);
    const all = spec.groups.flatMap(g => chosen[g.id]);
    if ( wrongCount ) ui.notifications.warn(`${wrongCount.label}: choose exactly ${wrongCount.count}.`);
    else if ( new Set(all).size !== all.length ) ui.notifications.warn("A school can only be in one column.");
    else break;
  }
  await item.update({ [`flags.${MODULE_ID}.schoolChoice.chosen`]: chosen });
  await rebuildSchoolEffect(item);
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor: item.actor }),
    content: `<p><strong>${item.name}</strong>: ${schoolSummary(item.getFlag(MODULE_ID, "schoolChoice"))} `
      + `(spell attacks and save DCs).</p>`
  });
  return true;
}

/** Attuning to a school-choice item asks for the schools. Only the window that attuned asks. */
const attuning = new Set();
Hooks.on("preUpdateItem", (item, changes) => {
  if ( (foundry.utils.getProperty(changes, "system.attuned") === true) && !item.system.attuned
    && item.getFlag(MODULE_ID, "schoolChoice") ) attuning.add(item.uuid);
});
Hooks.on("updateItem", item => {
  if ( attuning.delete(item.uuid) && item.isOwner ) chooseSchools(item);
});

/** A "Choose Schools" activity: its own uses pay for the change; cancelling refunds the use. */
Hooks.on("dnd5e.postUseActivity", activity => {
  if ( !activity.flags?.[MODULE_ID]?.chooseSchools ) return;
  chooseSchools(activity.item).then(saved => {
    const real = activity.actor?.items.get(activity.item.id)?.system.activities.get(activity.id);
    if ( saved || !real?.uses?.max ) return;
    return real.update({ "uses.spent": Math.max(0, (real.uses.spent ?? 0) - 1) });
  });
});

/* -------------------------------------------- */
/*  Setup                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "patchOnCreate", {
    name: "Patch on import",
    hint: "Automatically patch items as they are created — imported with Plutonium, dragged from a compendium, copied "
      + "between actors, or inside a newly created actor — and re-patch items overwritten by Plutonium's "
      + "\"Update existing\" import.",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "grantManeuvers", {
    name: "Combat maneuvers for every creature",
    hint: "Give every character and NPC the Combat Maneuvers item (Dash, Disengage, Dodge, Help, Hide, Shove Aside, Tumble...) "
      + "when it is created, and add it to existing ones when the world loads.",
    scope: "world", config: true, type: Boolean, default: true, onChange: () => syncManeuvers()
  });
  game.settings.register(MODULE_ID, "homebrewManeuvers", {
    name: "Include homebrew maneuvers",
    hint: "Also offer the homebrew maneuvers (Pin, Hurl Creature, Overrun, Climb onto a Bigger Creature, Dislodge Rider, "
      + "Lift Ally, Drop Ally). When off they are removed from every creature's Combat Maneuvers item.",
    scope: "world", config: true, type: Boolean, default: false, onChange: () => syncManeuvers()
  });
  game.settings.registerMenu(MODULE_ID, "apply", {
    name: "Items already in this world",
    label: "Review & apply",
    hint: "Find items in this world that have a patch and choose which ones to bring up to date.",
    icon: "fa-solid fa-screwdriver-wrench",
    type: FixesMenu,
    restricted: true
  });
});

Hooks.once("ready", async () => {
  await loadPatches();
  game.modules.get(MODULE_ID).api = { plan, apply, openDialog, applyWeaponOption, findPatch, buildPatched, loadPatches, syncManeuvers };
  // The lead-GM test comes from the Engine: wait for its API if it is not up yet.
  if ( game.modules.get(ENGINE_ID)?.api ) syncManeuvers();
  else Hooks.once("alivasTriggers.ready", () => syncManeuvers());
});
