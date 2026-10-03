/**
 * Alivas's Engine of Triggers — loot and locks: an OPTIONAL Item Piles integration (module id "item-piles", v3.x).
 * Everything here is inert unless Item Piles is installed and active; `initLoot` returns without registering anything
 * otherwise, and the exported functions warn and return null/false.
 *
 * Item Piles API used (every call is feature-detected through `ip()`; a missing or failing function logs a warning):
 *   game.itempiles.API.createItemPile({ position, sceneId, items, itemPileFlags, tokenOverrides })
 *   game.itempiles.API.addItems(target, [{ item, quantity }])           (merge into an existing pile)
 *   game.itempiles.API.removeItems(actor, [{ _id, quantity }])          (take the items off the dropper)
 *   game.itempiles.API.isValidItemPile / isRegularItemPile / isItemPileContainer / isItemPileLocked(target)
 *   game.itempiles.API.lockItemPile / unlockItemPile(target, interactingToken)
 *   game.itempiles.API.updateItemPile(target, { type, closed, locked, … })   (a non-container pile → container)
 * Item Piles routes all of those through an active GM itself (ItemPileSocket.executeAsGM), so players may call them.
 * Hooks used:
 *   item-piles-preRattleItemPile(pileActor, pileData, interactingActor)  a player clicked a locked container (local)
 *   item-piles-updateItemPile(pileToken, diff, interactingToken)         lock/unlock sync (lead GM writes the flag)
 *   item-piles-preDropItem                                               combat timing for canvas drag-and-drop
 * Item Piles' own canvas drag-and-drop from a sheet to the map is left alone (it needs the "Item Piles → Enable
 * dropping items" setting); only the 2024 combat timing below is checked on it.
 * dnd5e: hook `dnd5e.getItemContextOptions(item, menuItems)` (sheet context menu), `actor.rollToolCheck`, `actor.rollSkill`.
 * Engine: `Creatures.runAs` / `Creatures.HANDLERS` for GM-only writes, `renderTokenHUD` for the HUD button.
 *
 * DROPPING (api.loot.dropItems(actor, items, { position, pile, skipTiming, verb }))
 *   items: Item documents, { item, quantity } entries or item ids belonging to `actor`. The quantity defaults to the
 *   whole stack. Each is moved into a pile: an existing REGULAR pile in the same grid space is added to (no second
 *   token), otherwise a pile token is created at `position` (default: the actor's token's top-left, snapped).
 *   The pile is created with displayOne / showItemName / overrideSingleItemScale, so a single item shows its own icon
 *   at 0.75 scale; several items get the combined image (see PILE APPEARANCE).
 *   Dropped items are unequipped/unattuned in the pile. Containers take their contents along (whole stack only).
 *   Order: pile created/extended first, then the items removed from the actor (a failure never loses items).
 *   Sheet entry: "Drop on the ground" in the item context menu (owned weapon/equipment/consumable/tool/loot/container).
 *
 * COMBAT TIMING (2024 PHB: Equipment > Armor table; Actions > Utilize; Attack action) — only when the actor is in a
 *   started combat, and only notices and confirmations (no action-economy tracking):
 *     held weapon / other item     free
 *     equipped armor               refused (doffing: light 1 min, medium 1 min, heavy 5 min)
 *     equipped shield              confirm (doffing a shield is the Utilize action)
 *     container / backpack         free
 *   Unequipped armor or shields (in a pack) are ordinary items: free.
 *
 * DISARM (api.loot.disarm(target, { item }))
 *   Drops the target's held weapon (equipped, not natural) into a pile in the target's space. Several weapons: the GM
 *   picks (pickOption popup), or `item` names it. One of a stack is dropped. Not subject to the combat timing above.
 *   Engine action `dropHeld { to? }` (registered into deps.ACTIONS): disarm each creature of the selector `to`
 *   (default: the activity's targets / the triggering subject). Returns { success } (anything dropped).
 *   From a non-owner player client the whole thing is routed to the active GM (handler `lootDisarm`).
 *
 * LOCKS — obstacle data on the pile actor (for an unlinked pile token that is the token's synthetic actor):
 *   flags["alivas-engine-of-triggers"].obstacle = {
 *     locked, lockDC (default 15), forceDC (default 15 when unset, and the chat says so), keyItem (name, case-insens.),
 *     trap?: { detectDC, disarmDC, trigger, effect, armed }      // TODO: traps are not implemented; the key is reserved
 *   }
 *   `locked` mirrors Item Piles' own flag (flags["item-piles"].data.locked, only meaningful on type "container"):
 *   updateItemPile on any client → the lead GM copies a changed `locked` into the obstacle; the config dialog writes
 *   both. With no obstacle flag the lock state is read from Item Piles and the DCs default.
 *   A player who clicks a locked container (Item Piles rattles it) or, for a locked pile, uses the token HUD button, is
 *   asked: Pick Lock | Force open | Use key (only when a keyItem is set and the character carries it).
 *     Pick Lock   needs a tool item with system.type.baseItem "thief" or named /thieves' tools/i. Tool check with
 *                 actor.rollToolCheck({ tool: "thief", skill: "slt", ability: "dex", target: lockDC }): dnd5e itself
 *                 gives Advantage when also proficient in Sleight of Hand (passing `skill` is what enables it).
 *                 Without tools: a notice and an offer to Force instead.
 *     Force open  Strength (Athletics) via actor.rollSkill({ skill: "ath", target: forceDC }).
 *     Use key     unlocks if an item with the keyItem's name is carried.
 *   Success → the lead GM unlocks the pile (unlockItemPile + obstacle.locked = false) and a chat line is posted.
 *   The GM sets it up from the token HUD (lock icon on any item pile): locked, lock DC (Inferior 10 / Good 15 /
 *   Superior 20 per 2024 DMG Locked Door), force DC (glass 10 / wood 15 / stone 20 / metal 25), key item name. A
 *   non-container pile that is set locked is converted to a container (Item Piles can only lock containers).
 *
 * DOORS — the same flow on a door Wall: wall.flags[MODULE_ID].obstacle = { lockDC, forceDC, keyItem }; "locked" is the wall's own
 *   door state (ds === LOCKED). pickLockDoor / forceOpenDoor / useKeyDoor / interactDoor share the pile check code. Pick or
 *   key sets ds CLOSED, force sets OPEN (written by a GM client: handler `lootDoorUnlock`). GM config: a fieldset injected into
 *   WallConfig (renderWallConfig) with flags.<id>.obstacle.lockDC / forceDC / keyItem, shown for doors. A player right-clicking a
 *   locked door control with a controlled token within 5 ft gets Pick Lock / Force open / Use key (DoorControl#_onRightDown wrapped).
 * PILE APPEARANCE — a pile of several items shows a composite (2x2 of the first four item images, 1x2 for two) rendered in the
 *   lead GM's browser, uploaded to <user data>/alivas-engine-of-triggers-loot/pile-<hash>.webp and set as the token (and, when
 *   linked, prototype) texture; one item shows its own icon. The pile is named after its single item, or "Loot pile (N)", only
 *   while its name still equals the auto-name flag (flags[MODULE_ID].autoName). Piles with obstacle data are left untouched.
 *   Triggered (debounced 300 ms, lead GM) by createItem / deleteItem / updateItem on a pile and after dropItems.
 * TRAPS — TODO: not implemented.
 *
 * Exports are also on game.modules.get("alivas-engine-of-triggers").api.loot.
 */

import * as Creatures from "./creatures.mjs";

const MODULE_ID = "alivas-engine-of-triggers";
const IP_ID = "item-piles";
const DEFAULT_DC = 15;
const SINGLE_ITEM_SCALE = 0.75;
const LOCK_PRESETS = { Inferior: 10, Good: 15, Superior: 20 };
const FORCE_PRESETS = { Glass: 10, Wood: 15, Stone: 20, Metal: 25 };
const DROPPABLE_TYPES = ["weapon", "equipment", "consumable", "tool", "loot", "container"];
const ARMOR_TYPES = ["light", "medium", "heavy"];
const DOFF_TIME = { light: "1 minute", medium: "1 minute", heavy: "5 minutes" };
const PILE_FLAGS = {
  // displayOne / showItemName off: Item Piles would override the token's image and name at render time; this module
  // sets them itself (refreshPile: the item's icon or a composite, the item's name or "Loot pile (N)").
  enabled: true, type: "pile", displayOne: false, showItemName: false, overrideSingleItemScale: false, deleteWhenEmpty: true
};

let deps = {};
let initialized = false;

/* -------------------------------------------- */
/*  Item Piles access                           */
/* -------------------------------------------- */

/** Is Item Piles installed and active? */
export const isActive = () => !!game.modules.get(IP_ID)?.active;

const warned = new Set();
function warn(message, { notify=false }={}) {
  console.warn(`${MODULE_ID} | loot: ${message}`);
  if ( notify && !warned.has(message) ) {
    warned.add(message);
    ui.notifications?.warn(`Loot: ${message}`);
  }
}

/** Call a game.itempiles.API function if it exists; log and resolve undefined on any failure. */
async function ip(name, ...args) {
  const fn = game.itempiles?.API?.[name];
  if ( typeof fn !== "function" ) { warn(`Item Piles API "${name}" is not available (version mismatch?)`, { notify: true }); return undefined; }
  try { return await fn.apply(game.itempiles.API, args); }
  catch(err) { warn(`Item Piles API "${name}" failed: ${err?.message ?? err}`, { notify: true }); console.error(err); return undefined; }
}

/** Synchronous predicate calls (isValidItemPile, isItemPileLocked, …); false when missing or failing. */
function ipTest(name, ...args) {
  const fn = game.itempiles?.API?.[name];
  if ( typeof fn !== "function" ) { warn(`Item Piles API "${name}" is not available`); return false; }
  try { return !!fn.apply(game.itempiles.API, args); } catch(err) { warn(`"${name}" failed: ${err?.message ?? err}`); return false; }
}

function needIP(what) {
  if ( isActive() && game.itempiles?.API ) return true;
  warn(`${what}: Item Piles is not active`, { notify: true });
  return false;
}

/* -------------------------------------------- */
/*  Normalisers and small helpers               */
/* -------------------------------------------- */

const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/** A Token / TokenDocument / Actor / uuid → the actor. */
function actorOf(x) {
  if ( typeof x === "string" ) x = fromUuidSync(x);
  if ( !x ) return null;
  if ( x.document?.documentName === "Token" ) return x.document.actor ?? null;
  if ( x.documentName === "Token" ) return x.actor ?? null;
  return x.documentName === "Actor" ? x : null;
}

/** A Token / TokenDocument / Actor / uuid → a token document. */
function tokenOf(x) {
  if ( typeof x === "string" ) x = fromUuidSync(x);
  if ( !x ) return null;
  if ( x.document?.documentName === "Token" ) return x.document;
  if ( x.documentName === "Token" ) return x;
  if ( x.documentName === "Actor" ) return x.token ?? Creatures.tokenFor(x);
  return null;
}

const chat = (actor, content) => ChatMessage.implementation.create({
  speaker: actor ? ChatMessage.implementation.getSpeaker({ actor }) : undefined, content: `<p>${content}</p>` });

const inStartedCombat = actor => game.combats.some(c => c.started && c.combatants.some(cb => cb.actorId === actor?.id));

/** Snap a point to its grid space's top-left (gridless: unchanged). */
function snap(scene, { x, y }) {
  if ( scene.grid.type === CONST.GRID_TYPES.GRIDLESS ) return { x, y };
  if ( canvas?.ready && (canvas.scene === scene) ) return canvas.grid.getTopLeftPoint({ x, y });
  const s = scene.grid.size;
  return { x: Math.floor(x / s) * s, y: Math.floor(y / s) * s };
}

/** A regular (non-container, non-merchant) pile token sitting in the same grid space as a position. */
function findPileAt(scene, position) {
  const spot = snap(scene, position);
  return scene.tokens.find(t => {
    if ( !ipTest("isRegularItemPile", t) ) return false;
    const p = snap(scene, { x: t._source.x, y: t._source.y });
    return (p.x === spot.x) && (p.y === spot.y);
  }) ?? null;
}

/** A carried body (bodies.mjs: a container flagged `body`), and putting it down through that module. */
const isCarriedBody = item => (item?.type === "container") && !!item.flags?.[MODULE_ID]?.body;
const putDownBody = (actor, item, position) => game.modules.get(MODULE_ID)?.api?.bodies?.putDown?.(actor, item, position ?? undefined);

/** Is a GM client available to do privileged writes? Returns the user to run on, or null. */
const gmUser = () => (game.user.isGM ? game.user : (game.users.activeGM ?? null));

/* -------------------------------------------- */
/*  Combat timing (2024)                        */
/* -------------------------------------------- */

/** "ok" | "refuse" | "confirm" for dropping this item now. Only meaningful in a started combat. */
export function dropTiming(actor, item) {
  if ( !inStartedCombat(actor) ) return "ok";
  const kind = item.system?.type?.value;
  if ( (item.type === "equipment") && item.system.equipped && ARMOR_TYPES.includes(kind) ) return "refuse";
  if ( (item.type === "equipment") && item.system.equipped && (kind === "shield") ) return "confirm";
  return "ok";
}

/** Apply dropTiming with its notice/confirmation. Resolves true when the drop may go ahead. */
async function allowDrop(actor, item) {
  const verdict = dropTiming(actor, item);
  if ( verdict === "ok" ) return true;
  if ( verdict === "refuse" ) {
    const t = DOFF_TIME[item.system.type.value];
    ui.notifications.warn(`${item.name}: armor can't be taken off in combat (doffing takes ${t}).`);
    return false;
  }
  return !!(await foundry.applications.api.DialogV2.confirm({
    window: { title: `${actor.name} — drop ${item.name}` }, rejectClose: false,
    content: `<p>Doffing a shield takes the <strong>Utilize action</strong>. Drop <strong>${esc(item.name)}</strong> now?</p>`
  }));
}

/* -------------------------------------------- */
/*  Dropping                                    */
/* -------------------------------------------- */

/** Items → [{ item: Item, quantity }] belonging to the actor. */
function normalizeEntries(actor, items) {
  const out = [];
  for ( let e of (Array.isArray(items) ? items : [items]) ) {
    let quantity = null;
    if ( typeof e === "string" ) e = actor.items.get(e) ?? fromUuidSync(e);
    else if ( e && !(e instanceof Item) && e.item ) { quantity = e.quantity ?? null; e = (typeof e.item === "string") ? (actor.items.get(e.item) ?? fromUuidSync(e.item)) : e.item; }
    if ( !(e instanceof Item) || (e.parent !== actor) ) { warn(`dropItems: ignoring an item that doesn't belong to ${actor.name}`); continue; }
    const have = Number(e.system.quantity ?? 1) || 1;
    out.push({ item: e, quantity: Math.min(have, Math.max(1, Math.floor(Number(quantity ?? have) || have))) });
  }
  return out;
}

/** The data a dropped item has in the pile: unequipped, unattuned, the given quantity. */
function pileData(item, quantity) {
  const data = item.toObject();
  if ( "equipped" in (data.system ?? {}) ) data.system.equipped = false;
  if ( "attuned" in (data.system ?? {}) ) data.system.attuned = false;
  if ( "quantity" in (data.system ?? {}) ) data.system.quantity = quantity;
  return data;
}

/**
 * Drop items from an actor into a pile (see the header).
 * @param {Actor|Token|TokenDocument} actor
 * @param {Array} items
 * @param {object} [options]
 * @param {{x:number,y:number}} [options.position]  Where (default: the actor's token's space).
 * @param {TokenDocument} [options.pile]            Add to this pile instead of looking for one at the position.
 * @param {boolean} [options.skipTiming=false]      Skip the combat timing checks (Disarm).
 * @param {string} [options.verb="drops"]           Chat verb.
 * @returns {Promise<{tokenUuid:string, dropped:string[]}|null>}
 */
export async function dropItems(actor, items, { position=null, pile=null, skipTiming=false, verb="drops", quiet=false }={}) {
  if ( !needIP("dropItems") ) return null;
  actor = actorOf(actor);
  if ( !actor ) return null;

  // Not ours to change: let a GM client do it.
  if ( !game.user.isGM && !actor.isOwner ) {
    const gm = gmUser();
    if ( !gm ) { warn("dropItems: no GM is connected to drop another creature's items", { notify: true }); return null; }
    const entries = normalizeEntries(actor, items).map(e => ({ itemId: e.item.id, quantity: e.quantity }));
    return Creatures.runAs(gm, "lootDrop", { actorUuid: actor.uuid, entries, position, pileUuid: pile?.uuid ?? null, verb });
  }

  // A carried body (bodies.mjs) isn't loot: dropping it puts the creature's token down there.
  const list = Array.isArray(items) ? items : [items];
  const bodyOf = e => { const i = (e instanceof Item) ? e : (e?.item instanceof Item ? e.item : actor.items.get(e?.item ?? e)); return isCarriedBody(i) ? i : null; };
  const bodies = list.map(bodyOf).filter(Boolean);
  if ( bodies.length ) {
    for ( const body of bodies ) await putDownBody(actor, body, position);
    items = list.filter(e => !bodyOf(e));
    if ( !items.length ) return { tokenUuid: null, dropped: bodies.map(b => b.name) };
  }

  const token = Creatures.tokenFor(actor);
  const scene = token?.parent ?? pile?.parent ?? canvas?.scene;
  const where = position ?? (token ? { x: token._source.x, y: token._source.y } : null);
  if ( !scene || !where ) { ui.notifications.warn(`${actor.name} has no token on a scene to drop things at.`); return null; }

  // What actually goes: timing checks, then contents for containers.
  const moving = [];
  for ( const entry of normalizeEntries(actor, items) ) {
    if ( !skipTiming && !(await allowDrop(actor, entry.item)) ) continue;
    moving.push(entry);
  }
  if ( !moving.length ) return null;
  const ids = new Set(moving.map(e => e.item.id));
  const datas = [], removals = [];
  for ( const { item, quantity } of moving ) {
    const whole = quantity >= (Number(item.system.quantity ?? 1) || 1);
    if ( (item.type === "container") && whole ) {
      for ( const inner of (item.system.allContainedItems ?? []) ) {
        if ( ids.has(inner.id) ) continue;
        ids.add(inner.id);
        const q = Number(inner.system.quantity ?? 1) || 1;
        datas.push({ item: pileData(inner, q), quantity: q });
        removals.push({ _id: inner.id, quantity: q });
      }
    }
    datas.push({ item: pileData(item, quantity), quantity });
    removals.push({ _id: item.id, quantity });
  }

  // Pile: extend the one in this space, else make one.
  const spot = snap(scene, where);
  const existing = pile ?? findPileAt(scene, where);
  let tokenUuid = null;
  if ( existing ) {
    const added = await ip("addItems", existing, datas);
    if ( added === undefined ) return null;
    tokenUuid = existing.uuid;
  } else {
    const created = await ip("createItemPile", {
      position: spot, sceneId: scene.id, items: datas.map(d => d.item), itemPileFlags: { ...PILE_FLAGS },
      tokenOverrides: { elevation: token?.elevation ?? 0 }
    });
    if ( !created?.tokenUuid ) { warn("createItemPile returned no token; nothing was removed from the actor", { notify: true }); return null; }
    tokenUuid = created.tokenUuid;
  }

  scheduleRefresh(actorOf(tokenUuid));

  // Contents first: deleting a container may take its contents with it.
  const removed = await ip("removeItems", actor, removals);
  if ( removed === undefined ) warn(`items were put in the pile but could not be removed from ${actor.name}; remove them by hand`, { notify: true });

  const names = moving.map(e => (e.quantity > 1 ? `${e.item.name} ×${e.quantity}` : e.item.name));
  if ( !quiet ) await chat(actor, `<strong>${esc(actor.name)}</strong> ${esc(verb)} ${names.map(esc).join(", ")}.`);
  return { tokenUuid, dropped: names };
}

/** Sheet entry: ask for a quantity when there is a stack, then drop. */
async function dropFromSheet(item) {
  const actor = item.actor;
  if ( !actor ) return;
  let quantity = Number(item.system.quantity ?? 1) || 1;
  if ( quantity > 1 ) {
    const q = await foundry.applications.api.DialogV2.prompt({
      window: { title: `Drop ${item.name}` }, rejectClose: false,
      content: `<div class="form-group"><label>Quantity</label><input type="number" name="quantity" min="1" max="${quantity}" step="1" value="${quantity}" autofocus></div>`,
      ok: { label: "Drop", callback: (event, button) => button.form.elements.quantity.valueAsNumber }
    });
    if ( !q ) return;
    quantity = Math.min(quantity, Math.max(1, Math.floor(q)));
  }
  await dropItems(actor, [{ item, quantity }]);
}

/* -------------------------------------------- */
/*  Disarm                                      */
/* -------------------------------------------- */

/** The weapons a creature is holding: equipped, not natural. */
export const heldWeapons = actor => actor.items.filter(i => (i.type === "weapon") && i.system.equipped && (i.system.type?.value !== "natural"));

/**
 * Disarm: the target drops a held weapon into a pile in its space.
 * @param {Actor|Token|TokenDocument} target
 * @param {object} [options]
 * @param {Item|string} [options.item]  The weapon (or its id); otherwise the only one, or the GM chooses.
 * @returns {Promise<{dropped:string[]}|null>}
 */
export async function disarm(target, { item=null }={}) {
  if ( !needIP("disarm") ) return null;
  const actor = actorOf(target);
  if ( !actor ) return null;
  const itemId = (typeof item === "string") ? item : (item?.id ?? null);

  if ( !game.user.isGM && !actor.isOwner ) {
    const gm = gmUser();
    if ( !gm ) { warn("disarm: no GM is connected", { notify: true }); return null; }
    return Creatures.runAs(gm, "lootDisarm", { actorUuid: actor.uuid, itemId });
  }

  const weapons = heldWeapons(actor);
  let weapon = itemId ? actor.items.get(itemId) : null;
  if ( !weapon ) {
    if ( !weapons.length ) { ui.notifications.info(`${actor.name} isn't holding a weapon.`); return { dropped: [] }; }
    if ( weapons.length === 1 ) weapon = weapons[0];
    else {
      const user = gmUser() ?? game.user;
      const picked = await Creatures.runAs(user, "pickOption", { title: `Disarm ${actor.name}`,
        prompt: `<p>Which weapon does ${esc(actor.name)} drop?</p>`, options: weapons.map(w => ({ value: w.id, label: w.name })) });
      weapon = actor.items.get(picked);
    }
  }
  if ( !weapon ) return null;
  const result = await dropItems(actor, [{ item: weapon, quantity: 1 }], { skipTiming: true, verb: "is disarmed and drops" });
  return result ? { dropped: result.dropped } : null;
}

/* -------------------------------------------- */
/*  Obstacle data                               */
/* -------------------------------------------- */

/**
 * The obstacle on a pile (actor or token), with defaults filled in. `locked` falls back to Item Piles' own flag.
 * @returns {{locked:boolean, lockDC:number, forceDC:number|null, keyItem:string, trap?:object}}
 */
export function readObstacle(pile) {
  const token = tokenOf(pile), actor = actorOf(pile) ?? token?.actor;
  const own = actor?.getFlag?.(MODULE_ID, "obstacle") ?? {};
  const locked = (typeof own.locked === "boolean") ? own.locked : (token ? ipTest("isItemPileLocked", token) : false);
  return { ...own, locked, lockDC: Number(own.lockDC) || DEFAULT_DC, forceDC: Number(own.forceDC) || null, keyItem: own.keyItem ?? "" };
}

/** Merge values into the obstacle on the pile actor. GM only (players go through the lootUnlock handler). */
export async function writeObstacle(pile, patch) {
  const actor = actorOf(pile) ?? tokenOf(pile)?.actor;
  if ( !actor || !game.user.isGM ) return false;
  const next = foundry.utils.mergeObject(foundry.utils.deepClone(actor.getFlag(MODULE_ID, "obstacle") ?? {}), patch, { inplace: false });
  await actor.update({ [`flags.${MODULE_ID}.==obstacle`]: next });
  // Keep Item Piles' own lock in step (it's what players' clicks obey).
  const token = tokenOf(pile);
  if ( token && (typeof patch.locked === "boolean") && (ipTest("isItemPileLocked", token) !== patch.locked) ) {
    await ip(patch.locked ? "lockItemPile" : "unlockItemPile", token);
  }
  return true;
}

/* -------------------------------------------- */
/*  Locks: unlocking                            */
/* -------------------------------------------- */

const findKey = (actor, name) => !name ? null
  : (actor?.items.find(i => i.name.trim().toLowerCase() === String(name).trim().toLowerCase()) ?? null);
const findThievesTools = actor => actor?.items.find(i => (i.type === "tool")
  && ((i.system.type?.baseItem === "thief") || /thieves'? tools/i.test(i.name))) ?? null;

/** Run the unlock on a GM client: Item Piles' own state, the obstacle flag, a chat line. */
async function unlockLocal({ pileUuid, actorUuid, how }) {
  const token = tokenOf(pileUuid), actor = actorOf(actorUuid);
  if ( !token ) return false;
  const interacting = (actor && Creatures.tokenFor(actor)) || false;
  // unlockItemPile resolves to nothing: judge by the pile's state afterwards.
  await ip("unlockItemPile", token, interacting);
  if ( ipTest("isItemPileLocked", token) ) return false;
  await writeObstacle(token, { locked: false });
  await chat(actor, `<strong>${esc(actor?.name ?? "Someone")}</strong> ${esc(how)} <strong>${esc(token.name)}</strong> — it's unlocked.`);
  return true;
}

/** Ask the GM to unlock (or do it ourselves as GM). */
async function requestUnlock(pile, actor, how) {
  const user = gmUser();
  if ( !user ) { warn("no GM is connected to unlock this", { notify: true }); return false; }
  const result = await Creatures.runAs(user, "lootUnlock", { pileUuid: tokenOf(pile).uuid, actorUuid: actor?.uuid ?? null, how });
  return !!result;
}

/**
 * Shared Pick Lock check (piles and doors). `unlock(how)` performs the unlock; `force()` is the fallback when the
 * character has no thieves' tools.
 */
async function attemptPick({ name, lockDC, actor, unlock, force }) {
  if ( !findThievesTools(actor) ) {
    ui.notifications.warn(`${actor.name} has no thieves' tools.`);
    const go = await foundry.applications.api.DialogV2.confirm({ window: { title: "No thieves' tools" }, rejectClose: false,
      content: `<p>${esc(actor.name)} has no thieves' tools. Try to force it open instead?</p>` });
    return go ? force() : { success: false, noTools: true };
  }
  const config = { tool: "thief", skill: "slt", ability: "dex", target: lockDC };
  const rolls = (typeof actor.rollToolCheck === "function") ? await actor.rollToolCheck(config, { configure: false }, {})
    : await actor.rollAbilityCheck({ ability: "dex", target: lockDC }, { configure: false }, {});
  const total = rolls?.[0]?.total;
  if ( total === undefined || total === null ) return { success: false, cancelled: true };
  const success = total >= lockDC;
  if ( success ) await unlock("picks the lock of");
  else await chat(actor, `<strong>${esc(actor.name)}</strong> fails to pick the lock of <strong>${esc(name)}</strong> (${total} vs DC ${lockDC}).`);
  return { success, total, dc: lockDC };
}

/** Shared Force open check: Strength (Athletics) against the force DC (15 when none is set, and it says so). */
async function attemptForce({ name, forceDC, actor, unlock }) {
  const dc = forceDC ?? DEFAULT_DC;
  if ( !forceDC ) ui.notifications.info(`No force DC is set on ${name}: using ${DEFAULT_DC}.`);
  const rolls = (typeof actor.rollSkill === "function") ? await actor.rollSkill({ skill: "ath", ability: "str", target: dc }, { configure: false }, {})
    : await actor.rollAbilityCheck({ ability: "str", target: dc }, { configure: false }, {});
  const total = rolls?.[0]?.total;
  if ( total === undefined || total === null ) return { success: false, cancelled: true };
  const success = total >= dc;
  if ( success ) await unlock(`forces open${forceDC ? "" : ` (no force DC set, used ${DEFAULT_DC})`}`);
  return { success, total, dc, defaulted: !forceDC };
}

/** Shared Use key. */
async function attemptKey({ keyItem, actor, unlock }) {
  const key = findKey(actor, keyItem);
  if ( !key ) { ui.notifications.warn(`${actor.name} doesn't carry the key.`); return { success: false }; }
  return { success: !!(await unlock(`uses ${key.name} to unlock`)) };
}

/** Pick Lock: a thieves' tools check against the lock's DC. */
export async function pickLock(pile, actor) {
  if ( !needIP("pickLock") ) return null;
  const token = tokenOf(pile);
  actor = actorOf(actor);
  if ( !token || !actor ) return null;
  return attemptPick({ name: token.name, lockDC: readObstacle(token).lockDC, actor,
    unlock: how => requestUnlock(token, actor, how), force: () => forceOpen(token, actor) });
}

/** Force open: a Strength (Athletics) check against the force DC (15 when none is set, and it says so). */
export async function forceOpen(pile, actor) {
  if ( !needIP("forceOpen") ) return null;
  const token = tokenOf(pile);
  actor = actorOf(actor);
  if ( !token || !actor ) return null;
  return attemptForce({ name: token.name, forceDC: readObstacle(token).forceDC, actor, unlock: how => requestUnlock(token, actor, how) });
}

/** Use key: unlock if the character carries the obstacle's key item. */
export async function useKey(pile, actor) {
  if ( !needIP("useKey") ) return null;
  const token = tokenOf(pile);
  actor = actorOf(actor);
  if ( !token || !actor ) return null;
  return attemptKey({ keyItem: readObstacle(token).keyItem, actor, unlock: how => requestUnlock(token, actor, how) });
}

const choosing = new Set();

/** The Pick Lock / Force open / Use key dialog. Resolves "pick" | "force" | "key" | "no" | null. */
function askLockedChoice({ title, name, actor, keyItem }) {
  const buttons = [
    { action: "pick", label: "Pick Lock", icon: "fa-solid fa-key" },
    { action: "force", label: "Force open", icon: "fa-solid fa-hammer" }
  ];
  if ( keyItem && findKey(actor, keyItem) ) buttons.push({ action: "key", label: `Use ${keyItem}`, icon: "fa-solid fa-key" });
  buttons.push({ action: "no", label: "Leave it", default: true });
  return foundry.applications.api.DialogV2.wait({
    window: { title }, rejectClose: false, buttons,
    content: `<p><strong>${esc(actor.name)}</strong> at <strong>${esc(name)}</strong>.</p>`
  });
}

/**
 * The player's choices at a locked pile: Pick Lock / Force open / Use key.
 * @param {Token|TokenDocument} pile
 * @param {Actor|Token|TokenDocument} actor  The interacting character.
 */
export async function interact(pile, actor) {
  if ( !needIP("interact") ) return null;
  const token = tokenOf(pile);
  actor = actorOf(actor);
  if ( !token || !actor ) return null;
  if ( !ipTest("isItemPileLocked", token) ) return null;
  if ( choosing.has(token.uuid) ) return null;
  choosing.add(token.uuid);
  try {
    const choice = await askLockedChoice({ title: `${token.name} is locked`, name: token.name, actor, keyItem: readObstacle(token).keyItem });
    if ( choice === "pick" ) return await pickLock(token, actor);
    if ( choice === "force" ) return await forceOpen(token, actor);
    if ( choice === "key" ) return await useKey(token, actor);
    return null;
  } finally { choosing.delete(token.uuid); }
}

/* -------------------------------------------- */
/*  GM configuration dialog                     */
/* -------------------------------------------- */

const presetOptions = presets => `<option value="">Preset…</option>${Object.entries(presets).map(([k, v]) => `<option value="${v}">${k} (${v})</option>`).join("")}`;

/** GM dialog: locked, lock DC, force DC, key item. Writes the obstacle and applies the lock to Item Piles. */
export async function configureObstacle(pile) {
  if ( !needIP("configureObstacle") ) return null;
  if ( !game.user.isGM ) return null;
  const token = tokenOf(pile);
  if ( !token ) return null;
  const o = readObstacle(token);
  const content = `
    <div class="form-group"><label>Locked</label><div class="form-fields"><input type="checkbox" name="locked" ${o.locked ? "checked" : ""}></div></div>
    <div class="form-group"><label>Lock DC</label><div class="form-fields">
      <input type="number" name="lockDC" min="1" step="1" value="${o.lockDC}">
      <select name="lockPreset">${presetOptions(LOCK_PRESETS)}</select></div>
      <p class="hint">Thieves' tools, Dexterity (Sleight of Hand). Inferior 10 / Good 15 / Superior 20.</p></div>
    <div class="form-group"><label>Force DC</label><div class="form-fields">
      <input type="number" name="forceDC" min="1" step="1" value="${o.forceDC ?? ""}" placeholder="${DEFAULT_DC}">
      <select name="forcePreset">${presetOptions(FORCE_PRESETS)}</select></div>
      <p class="hint">Strength (Athletics). Blank uses ${DEFAULT_DC}.</p></div>
    <div class="form-group"><label>Key item</label><div class="form-fields"><input type="text" name="keyItem" value="${esc(o.keyItem)}" placeholder="Item name"></div></div>`;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: `Lock — ${token.name}` }, position: { width: 420 }, rejectClose: false, content,
    render: (event, dialog) => {
      const el = dialog.element;
      for ( const [preset, field] of [["lockPreset", "lockDC"], ["forcePreset", "forceDC"]] ) {
        el.querySelector(`[name=${preset}]`)?.addEventListener("change", e => {
          if ( e.target.value ) el.querySelector(`[name=${field}]`).value = e.target.value;
        });
      }
    },
    buttons: [
      { action: "save", label: "Save", icon: "fa-solid fa-check", default: true, callback: (event, button) => {
        const f = button.form.elements;
        return { locked: f.locked.checked, lockDC: f.lockDC.valueAsNumber || DEFAULT_DC, forceDC: f.forceDC.valueAsNumber || null, keyItem: f.keyItem.value.trim() };
      } },
      { action: "cancel", label: "Cancel" }
    ]
  });
  if ( !result || (result === "cancel") ) return null;

  await writeObstacle(token, result);
  // Item Piles can only lock containers.
  if ( result.locked && !ipTest("isItemPileContainer", token) ) {
    await ip("updateItemPile", token, { enabled: true, type: "container", closed: true, locked: true });
  } else if ( result.locked !== ipTest("isItemPileLocked", token) ) {
    await ip(result.locked ? "lockItemPile" : "unlockItemPile", token, false);
  }
  return result;
}

/* -------------------------------------------- */
/*  Doors                                       */
/* -------------------------------------------- */

const doorStates = () => CONST.WALL_DOOR_STATES ?? { CLOSED: 0, OPEN: 1, LOCKED: 2 };
const wallOf = x => {
  if ( typeof x === "string" ) x = fromUuidSync(x);
  if ( x?.document?.documentName === "Wall" ) return x.document;
  return (x?.documentName === "Wall") ? x : null;
};

/**
 * The obstacle on a door Wall: wall.flags[MODULE_ID].obstacle = { lockDC, forceDC, keyItem }. `locked` is the wall's own
 * door state (ds === LOCKED), never the flag.
 * @param {WallDocument|Wall} wall
 * @returns {{locked:boolean, lockDC:number, forceDC:number|null, keyItem:string}}
 */
export function readDoorObstacle(wall) {
  wall = wallOf(wall) ?? wall;
  const own = wall?.flags?.[MODULE_ID]?.obstacle ?? {};
  return { ...own, locked: wall?.ds === doorStates().LOCKED, lockDC: Number(own.lockDC) || DEFAULT_DC,
    forceDC: Number(own.forceDC) || null, keyItem: own.keyItem ?? "" };
}

/** GM client: set the door's state (CLOSED after a pick or key, OPEN after forcing) and post the chat line. */
async function unlockDoorLocal({ wallUuid, actorUuid, how, open=false }) {
  const wall = wallOf(wallUuid), actor = actorOf(actorUuid);
  if ( !wall ) return false;
  await wall.update({ ds: open ? doorStates().OPEN : doorStates().CLOSED });
  await chat(actor, `<strong>${esc(actor?.name ?? "Someone")}</strong> ${esc(how)} <strong>the door</strong> — it's ${open ? "open" : "unlocked"}.`);
  return true;
}

async function requestDoorUnlock(wall, actor, how, open=false) {
  const user = gmUser();
  if ( !user ) { warn("no GM is connected to unlock this", { notify: true }); return false; }
  return !!(await Creatures.runAs(user, "lootDoorUnlock", { wallUuid: wall.uuid, actorUuid: actor?.uuid ?? null, how, open }));
}

/** Pick Lock on a locked door Wall (same check, DC and chat as a pile). */
export async function pickLockDoor(wall, actor) {
  wall = wallOf(wall);
  actor = actorOf(actor);
  if ( !wall || !actor ) return null;
  return attemptPick({ name: "the door", lockDC: readDoorObstacle(wall).lockDC, actor,
    unlock: how => requestDoorUnlock(wall, actor, how), force: () => forceOpenDoor(wall, actor) });
}

/** Force open a door Wall: success sets it OPEN. */
export async function forceOpenDoor(wall, actor) {
  wall = wallOf(wall);
  actor = actorOf(actor);
  if ( !wall || !actor ) return null;
  return attemptForce({ name: "the door", forceDC: readDoorObstacle(wall).forceDC, actor, unlock: how => requestDoorUnlock(wall, actor, how, true) });
}

/** Use key on a door Wall: success sets it CLOSED. */
export async function useKeyDoor(wall, actor) {
  wall = wallOf(wall);
  actor = actorOf(actor);
  if ( !wall || !actor ) return null;
  return attemptKey({ keyItem: readDoorObstacle(wall).keyItem, actor, unlock: how => requestDoorUnlock(wall, actor, how) });
}

/** The player's choices at a locked door. */
export async function interactDoor(wall, actor) {
  wall = wallOf(wall);
  actor = actorOf(actor);
  if ( !wall || !actor || (wall.ds !== doorStates().LOCKED) ) return null;
  const id = wall.uuid;
  if ( choosing.has(id) ) return null;
  choosing.add(id);
  try {
    const choice = await askLockedChoice({ title: "The door is locked", name: "the door", actor, keyItem: readDoorObstacle(wall).keyItem });
    if ( choice === "pick" ) return await pickLockDoor(wall, actor);
    if ( choice === "force" ) return await forceOpenDoor(wall, actor);
    if ( choice === "key" ) return await useKeyDoor(wall, actor);
    return null;
  } finally { choosing.delete(id); }
}

/** Distance in scene units from a token's bounds to the nearest point of a wall segment (0 when they touch). */
function tokenToWallDistance(token, wall) {
  const [x0, y0, x1, y1] = wall.c;
  const size = canvas.dimensions.size;
  const left = token.document.x, top = token.document.y;
  const right = left + (token.document.width * size), bottom = top + (token.document.height * size);
  const segDist = (px, py) => {
    const dx = x1 - x0, dy = y1 - y0, len2 = (dx * dx) + (dy * dy);
    const t = len2 ? Math.max(0, Math.min(1, (((px - x0) * dx) + ((py - y0) * dy)) / len2)) : 0;
    return Math.hypot(px - (x0 + (t * dx)), py - (y0 + (t * dy)));
  };
  const rectDist = (px, py) => Math.hypot(Math.max(left - px, 0, px - right), Math.max(top - py, 0, py - bottom));
  // Does the segment cross the rectangle? (Liang-Barsky clip.)
  let t0 = 0, t1 = 1, crosses = true;
  const dx = x1 - x0, dy = y1 - y0;
  for ( const [p, q] of [[-dx, x0 - left], [dx, right - x0], [-dy, y0 - top], [dy, bottom - y0]] ) {
    if ( p === 0 ) { if ( q < 0 ) { crosses = false; break; } continue; }
    const r = q / p;
    if ( p < 0 ) { if ( r > t1 ) { crosses = false; break; } t0 = Math.max(t0, r); }
    else { if ( r < t0 ) { crosses = false; break; } t1 = Math.min(t1, r); }
  }
  const pixels = crosses ? 0 : Math.min(
    ...[[left, top], [right, top], [left, bottom], [right, bottom]].map(([x, y]) => segDist(x, y)),
    rectDist(x0, y0), rectDist(x1, y1));
  return (pixels / size) * canvas.dimensions.distance;
}

/** The player's controlled token within 5 ft of the wall (nearest first), or null. */
function characterNearDoor(wall) {
  let best = null, bestD = Infinity;
  for ( const t of (canvas.tokens?.controlled ?? []) ) {
    if ( !t.actor || !t.isOwner ) continue;
    const d = tokenToWallDistance(t, wall.document);
    if ( (d <= 5.01) && (d < bestD) ) { best = t; bestD = d; }
  }
  return best;
}

/** Wrap DoorControl#_onRightDown: a player right-clicking a locked door beside their token gets the choices. */
function wrapDoorControl() {
  const cls = foundry.canvas?.containers?.DoorControl ?? globalThis.DoorControl ?? CONFIG.Canvas?.doorControlClass;
  const proto = cls?.prototype;
  if ( !proto || (typeof proto._onRightDown !== "function") ) { warn("DoorControl#_onRightDown not found; players can't pick door locks from the map"); return; }
  const original = proto._onRightDown;
  proto._onRightDown = function(event, ...rest) {
    try {
      const wall = this.wall?.document;
      if ( !game.user.isGM && wall && (wall.ds === doorStates().LOCKED) ) {
        const near = characterNearDoor(this.wall);
        if ( near ) {
          event?.stopPropagation?.();
          interactDoor(wall, near.actor);
          return;
        }
      }
    } catch(err) { console.error(err); }
    return original.call(this, event, ...rest);
  };
}

/** WallConfig: lock DC, force DC and key item for doors, saved with the form. */
function injectWallConfig(app, html) {
  if ( !game.user.isGM ) return;
  const root = html instanceof HTMLElement ? html : (html?.[0] ?? app.element);
  const wall = app.document ?? app.object;
  if ( !root || !wall ) return;
  root.querySelector(".alivas-door-obstacle")?.remove();
  const o = wall.flags?.[MODULE_ID]?.obstacle ?? {};
  const name = k => `flags.${MODULE_ID}.obstacle.${k}`;
  const fs = document.createElement("fieldset");
  fs.className = "alivas-door-obstacle";
  fs.innerHTML = `<legend>Lock (Engine of Triggers)</legend>
    <div class="form-group"><label>Lock DC</label><div class="form-fields">
      <input type="number" name="${name("lockDC")}" min="1" step="1" value="${o.lockDC ?? ""}" placeholder="${DEFAULT_DC}"></div>
      <p class="hint">Thieves' tools, Dexterity (Sleight of Hand). Blank uses ${DEFAULT_DC}.</p></div>
    <div class="form-group"><label>Force DC</label><div class="form-fields">
      <input type="number" name="${name("forceDC")}" min="1" step="1" value="${o.forceDC ?? ""}" placeholder="${DEFAULT_DC}"></div>
      <p class="hint">Strength (Athletics). Blank uses ${DEFAULT_DC}.</p></div>
    <div class="form-group"><label>Key item</label><div class="form-fields">
      <input type="text" name="${name("keyItem")}" value="${esc(o.keyItem ?? "")}" placeholder="Item name"></div></div>`;
  const form = root.matches?.("form") ? root : (root.querySelector("form") ?? root);
  const footer = form.querySelector("footer");
  if ( footer ) footer.before(fs); else form.append(fs);
  const doorSelect = form.querySelector("select[name=door]");
  const sync = () => {
    const none = CONST.WALL_DOOR_TYPES?.NONE ?? 0;
    fs.hidden = Number(doorSelect ? doorSelect.value : wall.door) === none;
  };
  sync();
  doorSelect?.addEventListener("change", sync);
}

/*
 * TODO (traps): obstacle.trap = { detectDC, disarmDC, trigger, effect: <engine action list>, armed }.
 * Detect (Perception/Investigation vs detectDC), Disarm (thieves' tools DC 15 per 2024 PHB Tools, or disarmDC), and
 * trigger → run `effect` through the engine's action runner. Nothing reads or writes `trap` yet.
 */

/* -------------------------------------------- */
/*  Pile appearance                             */
/* -------------------------------------------- */

const IMG_DIR = `${MODULE_ID}-loot`;
const REFRESH_DELAY = 300;
const TILE = 256;
const DEFAULT_PILE_NAMES = new Set(["item pile", "loot pile"]);
const refreshTimers = new Map();
const knownFiles = new Set();

/** Deterministic 53-bit string hash (cyrb53), hex. */
function hashString(str, seed=0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for ( let i = 0; i < str.length; i++ ) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

const filePicker = () => foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;

function loadImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = /^(https?:|data:|blob:|\/)/i.test(src) ? src : (foundry.utils.getRoute?.(src) ?? src);
  });
}

/** Cell rectangles for n images on a TILE square: 1x2 for two, 2x2 otherwise. */
function layoutCells(n) {
  const h = TILE / 2;
  if ( n === 2 ) return [{ x: 0, y: h / 2, w: h, h }, { x: h, y: h / 2, w: h, h }];
  return [{ x: 0, y: 0, w: h, h }, { x: h, y: 0, w: h, h }, { x: 0, y: h, w: h, h }, { x: h, y: h, w: h, h }].slice(0, n);
}

/** Render the first four images into a transparent webp blob; null when none could be drawn. */
async function renderComposite(paths) {
  const imgs = await Promise.all(paths.slice(0, 4).map(loadImage));
  const canvasEl = document.createElement("canvas");
  canvasEl.width = canvasEl.height = TILE;
  const ctx = canvasEl.getContext("2d");
  const cells = layoutCells(paths.slice(0, 4).length);
  let drawn = 0;
  imgs.forEach((img, i) => {
    if ( !img ) return;
    const c = cells[i], iw = img.naturalWidth || c.w, ih = img.naturalHeight || c.h;
    const k = Math.min(c.w / iw, c.h / ih);
    ctx.drawImage(img, c.x + ((c.w - (iw * k)) / 2), c.y + ((c.h - (ih * k)) / 2), iw * k, ih * k);
    drawn++;
  });
  if ( !drawn ) return null;
  return new Promise(resolve => canvasEl.toBlob(b => resolve(b), "image/webp", 0.9));
}

/** Make sure the upload folder exists (the error from an existing one is ignored). */
async function ensureImageDir(FP) {
  try { await FP.browse("data", IMG_DIR); return; } catch(err) { /* missing: create it below */ }
  try { await FP.createDirectory("data", IMG_DIR); } catch(err) { /* already exists */ }
}

/**
 * The path of the composite image for these item images, uploading it when it isn't there yet.
 * @returns {Promise<string|null>} null when it can't be made or uploaded (the caller keeps the current image).
 */
async function compositePath(paths) {
  const FP = filePicker();
  if ( !FP?.upload ) { warn("no FilePicker to upload the combined pile image with; keeping the current image", { notify: true }); return null; }
  if ( game.user.can && !game.user.can("FILES_UPLOAD") ) {
    warn("not permitted to upload files; pile images are left as they are", { notify: true });
    return null;
  }
  const name = `pile-${hashString(paths.slice(0, 4).join("|"))}.webp`;
  const path = `${IMG_DIR}/${name}`;
  if ( knownFiles.has(path) ) return path;
  await ensureImageDir(FP);
  try {
    const listing = await FP.browse("data", IMG_DIR);
    if ( listing?.files?.some(f => decodeURIComponent(f).endsWith(`/${name}`) || (f === path)) ) { knownFiles.add(path); return path; }
  } catch(err) { /* fall through to upload */ }
  try {
    const blob = await renderComposite(paths);
    if ( !blob ) return null;
    const res = await FP.upload("data", IMG_DIR, new File([blob], name, { type: "image/webp" }), {}, { notify: false });
    if ( !res || (res.status === "error") ) throw new Error(res?.message ?? "upload refused");
    knownFiles.add(path);
    return res.path ?? path;
  } catch(err) {
    warn(`could not upload the combined pile image (${err?.message ?? err}); keeping the current image`, { notify: true });
    return null;
  }
}

/** Physical items in a pile (features such as Combat Maneuvers never count). */
const pileItems = actor => actor.items.filter(i => ("quantity" in (i.system ?? {})) && ((Number(i.system.quantity) || 0) > 0));

/** The token documents that show a pile actor. */
function pileTokens(actor) {
  if ( actor.isToken ) return actor.token ? [actor.token] : [];
  return game.scenes.contents.flatMap(sc => sc.tokens.filter(t => t.actorId === actor.id && t.actorLink));
}

/** Refresh one pile's name and token image from its contents (lead GM only). */
async function refreshPile(actor) {
  if ( !Creatures.isLeadGM() || !actor || !isActive() ) return;
  try {
    if ( !ipTest("isValidItemPile", actor) ) return;
    if ( actor.flags?.[MODULE_ID]?.obstacle ) return;
    const items = pileItems(actor);
    if ( !items.length ) return;
    const single = items.length === 1;

    let src;
    if ( single ) src = items[0].img;
    else {
      const paths = items.map(i => i.img).filter(Boolean);
      src = paths.length ? await compositePath(paths) : null;
    }

    const wanted = single ? items[0].name : `Loot pile (${items.length})`;
    const current = actor.isToken ? (actor.token?.name ?? actor.name) : actor.name;
    const auto = actor.getFlag(MODULE_ID, "autoName");
    // Only names this module (or Item Piles) gave are replaced; a name the GM typed stays.
    const rename = (current !== wanted) && ((current === auto) || DEFAULT_PILE_NAMES.has(String(current).toLowerCase())
      || actor.items.some(i => i.name === current) || /^Loot pile \(\d+\)$/.test(current));
    const scale = single ? SINGLE_ITEM_SCALE : 1;

    const tokens = pileTokens(actor);
    const linked = !actor.isToken;
    const actorUpdate = {};
    if ( rename ) {
      actorUpdate[`flags.${MODULE_ID}.autoName`] = wanted;
      if ( linked ) { actorUpdate.name = wanted; actorUpdate["prototypeToken.name"] = wanted; }
    }
    if ( src && linked && (actor.prototypeToken?.texture?.src !== src) ) actorUpdate["prototypeToken.texture.src"] = src;
    if ( Object.keys(actorUpdate).length ) await actor.update(actorUpdate);
    for ( const t of tokens ) {
      const update = {};
      if ( src && (t.texture?.src !== src) ) update["texture.src"] = src;
      if ( src && (t.texture?.scaleX !== scale) ) Object.assign(update, { "texture.scaleX": scale, "texture.scaleY": scale });
      if ( rename && (t.name !== wanted) ) update.name = wanted;
      if ( Object.keys(update).length ) await t.update(update);
    }
  } catch(err) { console.error(`${MODULE_ID} | loot: pile refresh failed`, err); }
}

/** Debounced (per actor) refresh; does nothing on clients that are not the lead GM. */
function scheduleRefresh(actor) {
  if ( !actor || !Creatures.isLeadGM() || !isActive() ) return;
  const key = actor.uuid;
  clearTimeout(refreshTimers.get(key));
  refreshTimers.set(key, setTimeout(() => { refreshTimers.delete(key); refreshPile(actor); }, REFRESH_DELAY));
}

/* -------------------------------------------- */
/*  Engine action                               */
/* -------------------------------------------- */

const LOOT_ACTIONS = {
  /** The creatures of the selector `to` (default: the targets / the subject) drop a held weapon. */
  async dropHeld(trigger, effect, bearer, event, context={}) {
    const a = trigger.action ?? {};
    const targets = a.to
      ? await Creatures.selectCreatures(bearer, a.to, deps.selectorContext(effect, bearer, context, trigger))
      : (context.targets?.length ? context.targets : (context.subject ? [context.subject] : []));
    const dropped = [];
    for ( const t of targets ) {
      const r = await disarm(t);
      if ( r?.dropped?.length ) dropped.push(`${t.name} drops ${r.dropped.join(", ")}`);
    }
    if ( dropped.length ) await deps.announce?.(trigger, effect, bearer, event, `${dropped.join("; ")}.`);
    return { success: dropped.length > 0 };
  }
};

/* -------------------------------------------- */
/*  Hooks and init                              */
/* -------------------------------------------- */

function registerHandlers() {
  Creatures.HANDLERS.lootUnlock = payload => unlockLocal(payload);
  Creatures.HANDLERS.lootDoorUnlock = payload => unlockDoorLocal(payload);
  Creatures.HANDLERS.lootDisarm = async ({ actorUuid, itemId }) => disarm(fromUuidSync(actorUuid), { item: itemId });
  Creatures.HANDLERS.lootDrop = async ({ actorUuid, entries, position, pileUuid, verb }) => {
    const actor = actorOf(actorUuid);
    return dropItems(actor, entries.map(e => ({ item: e.itemId, quantity: e.quantity })), { position, pile: pileUuid ? tokenOf(pileUuid) : null, verb });
  };
}

function registerHooks() {
  // Sheet: "Drop on the ground".
  Hooks.on("dnd5e.getItemContextOptions", (item, menuItems) => {
    if ( !Array.isArray(menuItems) ) return;
    menuItems.push({
      label: "Drop on the ground", icon: "fa-solid fa-arrow-down", group: "action",
      visible: () => isActive() && !!item.actor && item.isOwner && !item.actor.system?.isGroup && DROPPABLE_TYPES.includes(item.type),
      onClick: () => dropFromSheet(item)
    });
  });

  // Item Piles' own canvas drag-and-drop stays; only the 2024 combat timing is checked on it. The argument order of this
  // hook differs between the docs and the source, so the arguments are recognised by shape.
  Hooks.on("item-piles-preDropItem", (...args) => {
    const [source, ...rest] = args;
    const itemData = rest.find(a => a && (typeof a === "object") && (a.uuid || a.item) && !("x" in a));
    const position = rest.find(a => a && (typeof a === "object") && Number.isFinite(a.x) && Number.isFinite(a.y)) ?? null;
    const target = rest.find(a => a && (a.documentName === "Token")) ?? null;
    const item = itemData?.uuid ? fromUuidSync(itemData.uuid) : null;
    const actor = actorOf(source);
    // A carried body dragged to the map: put its token down there instead of making a pile.
    if ( (item instanceof Item) && actor && (item.parent === actor) && isCarriedBody(item) ) {
      putDownBody(actor, item, position ? canvas.grid.getTopLeftPoint?.(position) ?? position : null);
      return false;
    }
    if ( !(item instanceof Item) || !actor || (item.parent !== actor) || !inStartedCombat(actor) ) return;
    const verdict = dropTiming(actor, item);
    if ( verdict === "ok" ) return;
    if ( verdict === "refuse" ) {
      ui.notifications.warn(`${item.name}: armor can't be taken off in combat (doffing takes ${DOFF_TIME[item.system.type.value]}).`);
      return false;
    }
    // Shield: stop Item Piles, ask, and redo the drop ourselves.
    allowDrop(actor, item).then(ok => {
      if ( ok ) dropItems(actor, [{ item, quantity: Number(itemData.quantity) || 1 }], { position, pile: target, skipTiming: true });
    });
    return false;
  });

  // A player clicked a locked container: Item Piles rattles it, and we offer the choices. (GMs bypass locks.)
  Hooks.on("item-piles-preRattleItemPile", (pileActor, pileData, interacting) => {
    if ( game.user.isGM ) return;
    const token = tokenOf(pileActor);
    const actor = actorOf(interacting) ?? game.user.character;
    if ( token && actor ) interact(token, actor);
  });

  // Keep obstacle.locked in step with Item Piles' own flag.
  Hooks.on("item-piles-updateItemPile", (target, diff) => {
    if ( !Creatures.isLeadGM() || (typeof diff?.locked !== "boolean") ) return;
    const token = tokenOf(target);
    if ( token && (token.actor?.getFlag(MODULE_ID, "obstacle")?.locked !== diff.locked) ) writeObstacle(token, { locked: diff.locked });
  });

  // Doors: GM config on WallConfig, player right-click on a locked door control.
  Hooks.on("renderWallConfig", injectWallConfig);
  wrapDoorControl();

  // Pile appearance follows its contents.
  for ( const hook of ["createItem", "deleteItem"] ) Hooks.on(hook, item => scheduleRefresh(item.parent));
  Hooks.on("updateItem", (item, changes) => {
    if ( foundry.utils.hasProperty(changes, "system.quantity") || ("img" in changes) || ("name" in changes) ) scheduleRefresh(item.parent);
  });

  // Token HUD: GM → lock settings; a player at a locked pile → the pick/force/key choices for their controlled character.
  Hooks.on("renderTokenHUD", (app, html) => {
    const token = app.document ?? app.object?.document;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if ( !isActive() || !token || !root || !ipTest("isValidItemPile", token) ) return;
    const locked = ipTest("isItemPileLocked", token);
    if ( !game.user.isGM && !locked ) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "control-icon";
    button.dataset.tooltip = game.user.isGM ? "Lock settings" : "Open the lock";
    button.innerHTML = `<i class="fa-solid ${locked ? "fa-lock" : "fa-lock-open"}"></i>`;
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      if ( game.user.isGM ) return configureObstacle(token);
      const actor = canvas.tokens.controlled.find(t => t.document !== token)?.actor ?? game.user.character;
      if ( !actor ) return ui.notifications.warn("Select your token first.");
      return interact(token, actor);
    });
    (root.querySelector(".col.right") ?? root.querySelector(".col.left") ?? root).append(button);
  });
}

/**
 * Register the integration (no-op without Item Piles). Call once from the engine's `ready` hook.
 * @param {object} d  The engine's maneuver deps: { ACTIONS, announce, selectorContext, … }; ACTIONS gains `dropHeld`.
 */
export function initLoot(d) {
  if ( initialized ) return;
  if ( !isActive() ) { console.debug(`${MODULE_ID} | loot: Item Piles is not active; integration off`); return; }
  initialized = true;
  deps = d;
  Object.assign(d.ACTIONS, LOOT_ACTIONS);
  registerHandlers();
  registerHooks();
  console.log(`${MODULE_ID} | loot: Item Piles integration on`);
}
