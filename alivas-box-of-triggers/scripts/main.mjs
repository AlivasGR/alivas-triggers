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
    compendiumSource: data._stats?.compendiumSource ?? "", owner: owner ?? ""
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
  return PATCHES.find(p => p.keys.some(k => keyMatches(desc, k))) ?? null;
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
 * Produce the patched version of an item's data.
 * @param {object} patch  A PATCHES entry.
 * @param {object} old    The target item's current source data.
 * @returns {object}      Full item data: the target's ID and preserved fields, the patch's mechanics.
 */
function buildPatched(patch, old) {
  const data = foundry.utils.deepClone(patch.data);
  data._id = old._id;
  const keep = old.type === "spell" ? [...PRESERVE, ...PRESERVE_SPELL] : PRESERVE;
  for ( const path of keep ) {
    const value = foundry.utils.getProperty(old, path);
    if ( value !== undefined ) foundry.utils.setProperty(data, path, foundry.utils.deepClone(value));
  }
  if ( old.type === "spell" ) keepConsumption(data.system.activities, old.system?.activities);
  data.flags = foundry.utils.mergeObject(foundry.utils.deepClone(old.flags ?? {}), data.flags ?? {}, { inplace: false });
  data.flags[MODULE_ID] = { ...data.flags[MODULE_ID], version: patch.version };
  if ( old._stats ) data._stats = foundry.utils.deepClone(old._stats);
  return data;
}

/**
 * Patch an existing item document in place.
 */
async function applyOne(patch, item) {
  const data = buildPatched(patch, item.toObject());
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
  const patched = buildPatched(patch, source);
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
    return buildPatched(patch, itemData);
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
  game.modules.get(MODULE_ID).api = { plan, apply, openDialog, applyWeaponOption, findPatch, buildPatched, loadPatches };
});
