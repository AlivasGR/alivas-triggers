/**
 * Alivas's Engine of Triggers — bodies: carrying, putting down, looting and pickpocketing. Every feature is an
 * interaction registered in interact.mjs (right-click menu for non-owners, Token HUD button for owners/GM).
 *
 * PICK UP A BODY (interaction "Pick up", 5 ft; api.bodies.pickUp(carrierActor, bodyToken))
 *   Available on an unconscious, dead or 0-HP creature (statuses unconscious / dead, or hp.value <= 0 with hp.max > 0).
 *   The carrier gets a dnd5e container item "<Name> (carried)" (img = the actor's img) whose own weight is the body's:
 *   system.details.weight parsed (e.g. "150 lb", "68 kg"), else BODY_WEIGHT_BY_SIZE for the actor's size. Every PHYSICAL item
 *   the body carries moves INTO that container, keeping containment (nested containers stay nested); natural weapons and
 *   natural armor stay. Equipped/attuned state is cleared and remembered (flags[MODULE_ID].wasEquipped / wasAttuned), and
 *   restored when the body is put down. dnd5e then counts the container plus its contents for encumbrance, and the
 *   container works as a bag the carrier can take things out of. The body token is deleted (a linked actor stays in the world).
 *   Flag on the container item: flags[MODULE_ID].body = { actorUuid, actorLink, tokenData, sceneId, combat? }
 *   (tokenData = the token's toObject() after its items were removed, including the delta of an unlinked token;
 *   combat = { id, initiative } when the body was a combatant).
 *   World setting `bodyWeightBySize` (JSON string, config: false) overrides the per-size defaults.
 *   Chat: "X picks up Y."
 *
 * PUT DOWN (api.bodies.putDown(carrierActor, containerItem, position?))
 *   The token is recreated from tokenData in a free space adjacent to the carrier (or at `position`, top-left px). The
 *   container's current contents move to the body's actor (items taken out meanwhile stay with whoever has them, items
 *   added go to the body), then the container is deleted. Offered as a Token HUD button on the carrier's token and as
 *   "Put down" in the item's sheet context menu. Chat: "X puts down Y."
 *   Deleting the container (or dropping it as loot, which deletes it from the dropper) puts the body down at the carrier's
 *   feet instead of losing it. A copy of a body container that shows up on an Item Pile actor is removed again (best effort).
 *
 * LOOT (interaction "Loot", 5 ft; api.bodies.openLoot(target, looter, { mode }))
 *   On an unconscious/dead/0-HP creature. An ApplicationV2 window lists the target's physical items grouped by container,
 *   with Take buttons and a quantity for stacks; it refreshes when the target's items change. Taking a container takes its
 *   contents. No action cost outside combat; in combat each Take is an object interaction (Economy.spendInteraction).
 *
 * PICKPOCKET (interaction "Pickpocket", 5 ft; api.bodies.pickpocket(target, actor))
 *   On a conscious creature that isn't the actor itself. The actor must be hidden (status "hiding" or "invisible"), else the
 *   interaction is disabled ("You must be hidden"). Cost: Utilize (Economy.spendUtilize, Fast Hands may use the Bonus Action).
 *   The GM is asked whether the target is alert or suspicious (disadvantage; 20 s, default No). Sleight of Hand against the
 *   target's passive Perception. Success opens the loot window in LIMITED mode: only items that aren't equipped, aren't
 *   containers and weigh at most PICKPOCKET_MAX_LB per unit can be taken (the rest are greyed out); Take takes ONE unit,
 *   then the window closes. Success chat is whispered to the GM and the pickpocket's owners; failure is whispered to the GM
 *   (nothing ends Hidden automatically).
 *
 * Handlers (Creatures.HANDLERS, run on a GM client): bodiesPickUp, bodiesPutDown, bodiesMove, bodiesAskDisadvantage.
 * Hooks: renderTokenHUD (Put down), dnd5e.getItemContextOptions (Put down), preDeleteItem / createItem (body containers),
 *   createItem / updateItem / deleteItem (loot window refresh).
 * Deletions made by this module pass the operation option `alivasBodiesSkip` so the preDeleteItem guard ignores them.
 * Exports are also on game.modules.get("alivas-engine-of-triggers").api.bodies.
 */

import * as Creatures from "./creatures.mjs";
import * as Economy from "./economy.mjs";
import { registerInteraction } from "./interact.mjs";

const MODULE_ID = "alivas-engine-of-triggers";

/**
 * PLACEHOLDERS — the maintainer has not confirmed these numbers.
 * Body weight in lb by creature size (used when the actor has no parsable system.details.weight).
 */
const BODY_WEIGHT_BY_SIZE = { tiny: 8, sm: 35, med: 150, lg: 500, huge: 2000, grg: 10000 };
/** PLACEHOLDER — heaviest single unit (lb) a pickpocket can lift; the maintainer has not confirmed it. */
const PICKPOCKET_MAX_LB = 1;

const RANGE = 5;
const ASK_TIMEOUT_MS = 20000;
const PHYSICAL_TYPES = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container"]);
/** lb per unit of dnd5e weight units. */
const LB_PER_UNIT = { lb: 1, tn: 2000, kg: 2.20462, Mg: 2204.62 };
const SKIP = { alivasBodiesSkip: true };

const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
const warn = (message, notify=false) => {
  console.warn(`${MODULE_ID} | bodies: ${message}`);
  if ( notify ) ui.notifications?.warn(`Bodies: ${message}`);
};
const gmUser = () => (game.user.isGM ? game.user : (game.users.activeGM ?? null));

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

const chat = (actor, content) => ChatMessage.implementation.create({
  speaker: actor ? ChatMessage.implementation.getSpeaker({ actor }) : undefined, content: `<p>${content}</p>` });

/** User ids that should see a private line: every GM plus the actor's owners. */
function privateAudience(actor) {
  const ids = new Set(game.users.filter(u => u.isGM).map(u => u.id));
  for ( const u of game.users ) if ( actor?.testUserPermission?.(u, "OWNER") ) ids.add(u.id);
  return [...ids];
}

const whisper = (actor, content, ids) => ChatMessage.implementation.create({
  speaker: actor ? ChatMessage.implementation.getSpeaker({ actor }) : undefined, content: `<p>${content}</p>`, whisper: ids });

const isItemPile = actor => !!actor?.flags?.["item-piles"]?.data?.enabled;

/** A creature that can be carried / looted / pickpocketed (not a pile, vehicle or group). */
function isCreature(actor) {
  return !!actor && ["character", "npc"].includes(actor.type) && !isItemPile(actor);
}

/** Unconscious, dead or at 0 HP. */
function isDown(actor) {
  if ( !isCreature(actor) ) return false;
  if ( actor.statuses?.has("unconscious") || actor.statuses?.has("dead") ) return true;
  const hp = actor.system?.attributes?.hp;
  return !!hp && (Number(hp.max) > 0) && (Number(hp.value) <= 0);
}

const isHidden = actor => !!(actor?.statuses?.has("hiding") || actor?.statuses?.has("invisible"));

/** Items that move with a body: physical items, except natural weapons / natural armor. */
function isPhysical(item) {
  if ( !PHYSICAL_TYPES.has(item.type) ) return false;
  if ( !("quantity" in (item.system ?? {})) ) return false;
  if ( ((item.type === "weapon") || (item.type === "equipment")) && (item.system.type?.value === "natural") ) return false;
  // Unarmed Strike is a "weapon" item but part of the creature, not something it carries.
  if ( (item.system.identifier === "unarmed-strike") || /^unarmed strike$/i.test(item.name ?? "") ) return false;
  return true;
}

const isBodyContainer = item => (item?.type === "container") && !!item.flags?.[MODULE_ID]?.body;

/** Weight of one unit of an item, in lb. */
function unitWeightLb(item) {
  const w = item.system?.weight;
  return (Number(w?.value) || 0) * (LB_PER_UNIT[w?.units] ?? 1);
}

/** A free-text weight ("150 lb", "68 kg", "10 st") → lb, or null. */
function parseWeight(text) {
  if ( text === undefined || text === null ) return null;
  const m = String(text).replace(/,/g, ".").match(/(\d+(?:\.\d+)?)\s*([a-z]*)/i);
  if ( !m ) return null;
  const n = Number(m[1]);
  if ( !(n > 0) ) return null;
  const unit = m[2].toLowerCase();
  if ( /^(kg|kilo)/.test(unit) ) return n * 2.20462;
  if ( /^(st|stone)/.test(unit) ) return n * 14;
  if ( /^(g|gram)/.test(unit) ) return n / 453.592;
  return n; // lb, lbs, pounds, or a bare number
}

function bodyWeightTable() {
  let custom = {};
  try {
    const raw = game.settings.get(MODULE_ID, "bodyWeightBySize");
    custom = (typeof raw === "string") ? JSON.parse(raw || "{}") : (raw ?? {});
  } catch(err) { /* setting missing or malformed: defaults */ }
  return { ...BODY_WEIGHT_BY_SIZE, ...custom };
}

function bodyWeightLb(actor) {
  const parsed = parseWeight(actor.system?.details?.weight);
  if ( parsed ) return Math.round(parsed * 10) / 10;
  const table = bodyWeightTable();
  const size = actor.system?.traits?.size ?? "med";
  return Number(table[size]) || BODY_WEIGHT_BY_SIZE[size] || BODY_WEIGHT_BY_SIZE.med;
}

const actorFromUuid = uuid => {
  const doc = uuid ? fromUuidSync(uuid) : null;
  if ( !doc ) return null;
  if ( doc.documentName === "Actor" ) return doc;
  return doc.actor ?? null;
};

/** Run a handler on a GM client (or directly when this user is one). Null when no GM is connected. */
async function viaGM(handler, payload) {
  const gm = gmUser();
  if ( !gm ) { warn("no GM is connected to do this", true); return null; }
  return Creatures.runAs(gm, handler, payload);
}

/**
 * Copy items (with their containment) from one actor to another, level by level so nested containers stay nested.
 * @param {Item[]} items            Items of one actor (a container's children must be in the set to move with it).
 * @param {Actor} dest
 * @param {string|null} rootId      The container on `dest` the top level goes into (null: loose).
 * @param {object} [options]
 * @param {boolean} [options.unequip]  Clear equipped/attuned, remembering it in flags.
 * @param {boolean} [options.restore]  Re-apply remembered equipped/attuned.
 * @returns {Promise<Item[]>} created documents
 */
async function copyTree(items, dest, rootId, { unequip=false, restore=false }={}) {
  const ids = new Set(items.map(i => i.id));
  const idMap = new Map();
  const created = [];
  let level = items.filter(i => !i.system.container || !ids.has(i.system.container));
  while ( level.length ) {
    const datas = level.map(i => {
      const d = i.toObject();
      delete d._id;
      d.system.container = (i.system.container && idMap.get(i.system.container)) || rootId || null;
      const flags = foundry.utils.getProperty(d, `flags.${MODULE_ID}`) ?? {};
      if ( unequip ) {
        if ( d.system.equipped ) flags.wasEquipped = true;
        if ( d.system.attuned ) flags.wasAttuned = true;
        if ( "equipped" in d.system ) d.system.equipped = false;
        if ( "attuned" in d.system ) d.system.attuned = false;
        foundry.utils.setProperty(d, `flags.${MODULE_ID}`, flags);
      } else if ( restore ) {
        if ( flags.wasEquipped ) d.system.equipped = true;
        if ( flags.wasAttuned ) d.system.attuned = true;
        delete flags.wasEquipped;
        delete flags.wasAttuned;
      }
      return d;
    });
    const docs = await dest.createEmbeddedDocuments("Item", datas);
    level.forEach((i, k) => { if ( docs[k] ) idMap.set(i.id, docs[k].id); });
    created.push(...docs);
    const done = new Set(level.map(i => i.id));
    level = items.filter(i => i.system.container && done.has(i.system.container));
  }
  return created;
}

/* -------------------------------------------- */
/*  Pick up                                     */
/* -------------------------------------------- */

/** GM client: do the pick up. */
async function pickUpLocal({ carrierUuid, tokenUuid }) {
  try {
    const carrier = actorFromUuid(carrierUuid);
    const token = fromUuidSync(tokenUuid);
    const body = token?.actor;
    if ( !carrier || !token || !body || (carrier === body) ) return false;
    if ( !isDown(body) ) { ui.notifications.warn(`${body.name} is no longer down.`); return false; }

    const moving = body.items.filter(isPhysical);
    const combatant = game.combats.contents.map(c => c.combatants.find(cb => cb.tokenId === token.id)).find(Boolean);

    const container = (await carrier.createEmbeddedDocuments("Item", [{
      name: `${body.name} (carried)`, type: "container", img: body.img,
      system: { weight: { value: bodyWeightLb(body), units: "lb" }, quantity: 1 },
      flags: { [MODULE_ID]: { body: { actorUuid: null, actorLink: token.actorLink, tokenData: null, sceneId: token.parent?.id ?? null } } }
    }]))[0];
    if ( !container ) return false;

    // Create on the carrier first, delete from the body after: a failure never loses items.
    await copyTree(moving, carrier, container.id, { unequip: true });
    if ( moving.length ) await body.deleteEmbeddedDocuments("Item", moving.map(i => i.id), { ...SKIP });

    const tokenData = token.toObject();
    const bodyFlag = { actorUuid: token.actorLink ? `Actor.${token.actorId}` : body.uuid, actorLink: token.actorLink,
      tokenData, sceneId: token.parent?.id ?? null };
    if ( combatant ) bodyFlag.combat = { id: combatant.parent.id, initiative: combatant.initiative };
    await container.update({ [`flags.${MODULE_ID}.body`]: bodyFlag });
    await token.delete();
    await chat(carrier, `<strong>${esc(carrier.name)}</strong> picks up <strong>${esc(body.name)}</strong>.`);
    return true;
  } catch(err) { console.error(`${MODULE_ID} | bodies: pick up failed`, err); return false; }
}

/**
 * Pick up a downed creature: its token is removed and it becomes a container item on the carrier.
 * @param {Actor|TokenDocument} carrier
 * @param {TokenDocument|Token} bodyToken
 * @returns {Promise<boolean>}
 */
export async function pickUp(carrier, bodyToken) {
  carrier = carrier?.documentName === "Token" ? carrier.actor : carrier;
  const token = bodyToken?.document ?? bodyToken;
  if ( !carrier || !token?.actor ) return false;
  const payload = { carrierUuid: carrier.uuid, tokenUuid: token.uuid };
  return !!(game.user.isGM ? await pickUpLocal(payload) : await viaGM("bodiesPickUp", payload));
}

/* -------------------------------------------- */
/*  Put down                                    */
/* -------------------------------------------- */

/** Does a straight move from one point to another hit a movement wall? Only checkable on the viewed scene. */
function blockedByWall(scene, from, to) {
  try {
    if ( !canvas?.ready || (canvas.scene !== scene) ) return false;
    const backend = CONFIG.Canvas?.polygonBackends?.move;
    if ( typeof backend?.testCollision !== "function" ) return false;
    return !!backend.testCollision(from, to, { type: "move", mode: "any" });
  } catch(err) { return false; }
}

/** The nearest free spot touching the carrier's token for a token of the body's size (top-left px), or null. */
function findFreeSpot(scene, carrier, tokenData) {
  const size = scene.grid.size;
  const bw = tokenData.width ?? 1, bh = tokenData.height ?? 1;
  const cx = carrier._source.x, cy = carrier._source.y, cw = carrier.width, ch = carrier.height;
  const probe = { id: null, parent: scene, width: bw, height: bh };
  const center = { x: cx + (cw * size / 2), y: cy + (ch * size / 2) };
  const spots = [];
  for ( let dx = -bw; dx <= cw; dx++ ) {
    for ( let dy = -bh; dy <= ch; dy++ ) {
      if ( (dx > -bw) && (dx < cw) && (dy > -bh) && (dy < ch) ) continue; // overlaps the carrier
      const x = cx + (dx * size), y = cy + (dy * size);
      spots.push({ x, y, d: Math.hypot((x + (bw * size / 2)) - center.x, (y + (bh * size / 2)) - center.y) });
    }
  }
  spots.sort((a, b) => a.d - b.d);
  const { width, height } = scene.dimensions ?? {};
  for ( const s of spots ) {
    if ( (width && ((s.x < 0) || ((s.x + (bw * size)) > width))) || (height && ((s.y < 0) || ((s.y + (bh * size)) > height))) ) continue;
    if ( !Creatures.spaceFree(probe, s.x, s.y) ) continue;
    if ( blockedByWall(scene, center, { x: s.x + (bw * size / 2), y: s.y + (bh * size / 2) }) ) continue;
    return { x: s.x, y: s.y };
  }
  return null;
}

/** GM client: do the put down. */
async function putDownLocal({ carrierUuid, itemId, position=null }) {
  try {
    const carrier = actorFromUuid(carrierUuid);
    const container = carrier?.items.get(itemId);
    const flag = container?.flags?.[MODULE_ID]?.body;
    if ( !carrier || !flag?.tokenData ) { warn("put down: that isn't a carried body", true); return false; }

    const carrierToken = Creatures.tokenFor(carrier);
    const scene = carrierToken?.parent ?? game.scenes.get(flag.sceneId);
    if ( !scene ) { warn(`${carrier.name} has no token on a scene to put the body down on`, true); return false; }

    const data = foundry.utils.deepClone(flag.tokenData);
    delete data._id;
    let spot = position ? { x: position.x, y: position.y } : (carrierToken ? findFreeSpot(scene, carrierToken, data) : null);
    if ( !spot ) {
      if ( !carrierToken ) { warn("put down: nowhere to put the body", true); return false; }
      spot = { x: carrierToken._source.x, y: carrierToken._source.y };
      warn("no free space beside the carrier; the body is put down in its space", true);
    }
    Object.assign(data, { x: spot.x, y: spot.y, hidden: false });

    const token = (await scene.createEmbeddedDocuments("Token", [data]))[0];
    if ( !token ) return false;
    const body = flag.actorLink ? (game.actors.get(data.actorId) ?? token.actor) : token.actor;
    if ( !body ) { warn("put down: the body's actor no longer exists", true); await token.delete(); return false; }

    // Contents back to the body (create first, delete after).
    const contents = [...container.system.allContainedItems];
    if ( contents.length ) await copyTree(contents, body, null, { restore: true });

    if ( flag.combat ) {
      try {
        const combat = game.combats.get(flag.combat.id);
        if ( combat && !combat.combatants.some(cb => cb.tokenId === token.id) ) {
          await combat.createEmbeddedDocuments("Combatant", [{ tokenId: token.id, sceneId: scene.id, actorId: body.id,
            initiative: flag.combat.initiative ?? null }]);
        }
      } catch(err) { console.error(`${MODULE_ID} | bodies: could not re-add to combat`, err); }
    }

    await container.delete({ deleteContents: true, ...SKIP });
    await chat(carrier, `<strong>${esc(carrier.name)}</strong> puts down <strong>${esc(body.name)}</strong>.`);
    return true;
  } catch(err) { console.error(`${MODULE_ID} | bodies: put down failed`, err); return false; }
}

/**
 * Put a carried body back on the map beside its carrier.
 * @param {Actor} carrierActor
 * @param {Item|string} containerItem   The "(carried)" container, or its id.
 * @param {{x:number,y:number}} [position]  Top-left in pixels; default the nearest free space adjacent to the carrier.
 * @returns {Promise<boolean>}
 */
export async function putDown(carrierActor, containerItem, position) {
  const carrier = carrierActor?.documentName === "Token" ? carrierActor.actor : carrierActor;
  const item = (typeof containerItem === "string") ? carrier?.items.get(containerItem) : containerItem;
  if ( !carrier || !isBodyContainer(item) ) return false;
  const payload = { carrierUuid: carrier.uuid, itemId: item.id, position: position ?? null };
  return !!(game.user.isGM ? await putDownLocal(payload) : await viaGM("bodiesPutDown", payload));
}

const carriedBodies = actor => actor?.items?.filter(isBodyContainer) ?? [];

async function putDownMenu(actor) {
  const bodies = carriedBodies(actor);
  if ( !bodies.length ) return false;
  let item = bodies[0];
  if ( bodies.length > 1 ) {
    const pick = await foundry.applications.api.DialogV2.wait({ window: { title: `${actor.name} — put down` }, rejectClose: false,
      content: "<p>Which body?</p>",
      buttons: [...bodies.map(b => ({ action: b.id, label: b.name })), { action: "cancel", label: "Cancel" }] });
    item = bodies.find(b => b.id === pick);
  }
  return item ? putDown(actor, item) : false;
}

/* -------------------------------------------- */
/*  Moving single items (loot / pickpocket)     */
/* -------------------------------------------- */

/** GM client: move `quantity` of an item (a container goes whole, with its contents) between actors. */
async function moveLocal({ sourceUuid, destUuid, itemId, quantity=null }) {
  try {
    const source = actorFromUuid(sourceUuid), dest = actorFromUuid(destUuid);
    const item = source?.items.get(itemId);
    if ( !source || !dest || !item || !isPhysical(item) ) return null;
    const have = Number(item.system.quantity ?? 1) || 1;
    const qty = Math.min(have, Math.max(1, Math.floor(Number(quantity ?? have) || have)));
    const name = item.name;

    if ( item.type === "container" ) {
      const set = [item, ...item.system.allContainedItems];
      await copyTree(set, dest, null, { unequip: true });
      await source.deleteEmbeddedDocuments("Item", set.map(i => i.id), { ...SKIP });
      return { name, quantity: 1 };
    }
    const data = item.toObject();
    delete data._id;
    data.system.container = null;
    data.system.quantity = qty;
    if ( "equipped" in data.system ) data.system.equipped = false;
    if ( "attuned" in data.system ) data.system.attuned = false;
    await dest.createEmbeddedDocuments("Item", [data]);
    if ( qty >= have ) await source.deleteEmbeddedDocuments("Item", [item.id], { ...SKIP });
    else await item.update({ "system.quantity": have - qty });
    return { name, quantity: qty };
  } catch(err) { console.error(`${MODULE_ID} | bodies: move failed`, err); return null; }
}

async function moveItem(source, dest, itemId, quantity) {
  const payload = { sourceUuid: source.uuid, destUuid: dest.uuid, itemId, quantity };
  if ( game.user.isGM || (source.isOwner && dest.isOwner) ) return moveLocal(payload);
  return viaGM("bodiesMove", payload);
}

/* -------------------------------------------- */
/*  Loot window                                 */
/* -------------------------------------------- */

const openWindows = new Set();
let LootWindow = null;

/** Build the window class on first use (foundry.applications is only guaranteed once the game is up). */
function lootWindowClass() {
  if ( LootWindow ) return LootWindow;
  const { ApplicationV2 } = foundry.applications.api;
  LootWindow = class AetLootWindow extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      classes: ["aet-loot"], tag: "div",
      window: { title: "Loot", icon: "fa-solid fa-sack-xmark", resizable: true },
      position: { width: 440, height: "auto" }
    };

    /** @param {{target:Actor, looter:Actor, mode:"full"|"limited", onTaken?:Function}} cfg */
    constructor(cfg) {
      super({ id: `aet-loot-${cfg.target.uuid.replace(/\W/g, "-")}-${cfg.looter.id}` });
      this.cfg = cfg;
    }

    get title() {
      return this.cfg.mode === "limited" ? `Pickpocket — ${this.cfg.target.name}` : `Loot — ${this.cfg.target.name}`;
    }

    /** Can this item be taken in this mode? */
    eligible(item) {
      if ( this.cfg.mode !== "limited" ) return true;
      return !item.system.equipped && (item.type !== "container") && (unitWeightLb(item) <= PICKPOCKET_MAX_LB);
    }

    async _renderHTML() {
      const items = this.cfg.target.items.filter(isPhysical);
      const ids = new Set(items.map(i => i.id));
      const children = new Map();
      const roots = [];
      for ( const i of items ) {
        const parent = i.system.container;
        if ( parent && ids.has(parent) ) children.set(parent, [...(children.get(parent) ?? []), i]);
        else roots.push(i);
      }
      const limited = this.cfg.mode === "limited";
      const row = (i, depth) => {
        const qty = Number(i.system.quantity ?? 1) || 1;
        const ok = this.eligible(i);
        const qtyInput = (qty > 1) && !limited
          ? `<input type="number" class="aet-loot-qty" min="1" max="${qty}" step="1" value="${qty}">` : "";
        const note = i.system.equipped ? ` <span class="aet-muted">(equipped)</span>` : "";
        return `<li class="aet-loot-row${ok ? "" : " aet-loot-grey"}" data-item-id="${i.id}" style="padding-left:${depth * 18}px">
          <img src="${esc(i.img)}" width="24" height="24">
          <span class="aet-loot-name">${esc(i.name)}${qty > 1 ? ` ×${qty}` : ""}${note}</span>
          ${ok ? `${qtyInput}<button type="button" class="aet-loot-take"><i class="fa-solid fa-hand"></i> Take${limited ? " one" : ""}</button>` : ""}
        </li>${(children.get(i.id) ?? []).map(c => row(c, depth + 1)).join("")}`;
      };
      return `<ul class="aet-loot-list">${roots.length ? roots.map(i => row(i, 0)).join("") : `<li class="aet-muted">Nothing to take.</li>`}</ul>`;
    }

    _replaceHTML(result, content) { content.innerHTML = result; }

    _onRender() {
      this.element.querySelectorAll(".aet-loot-take").forEach(btn => btn.addEventListener("click", ev => {
        ev.preventDefault();
        const row = btn.closest("[data-item-id]");
        const qty = row.querySelector(".aet-loot-qty")?.valueAsNumber;
        this.take(row.dataset.itemId, qty);
      }));
    }

    async take(itemId, quantity) {
      if ( this.busy ) return;
      this.busy = true;
      try {
        const { target, looter, mode } = this.cfg;
        const item = target.items.get(itemId);
        if ( !item || !this.eligible(item) ) return;
        const limited = mode === "limited";
        // Worn armor can't be taken off a body in combat: doffing takes minutes (as for dropping it, loot.mjs).
        if ( Economy.inCombat(looter) && item.system?.equipped && ["light", "medium", "heavy"].includes(item.system?.type?.value) ) {
          ui.notifications.warn(`${item.name}: worn armor can't be taken off in combat (doffing takes minutes).`);
          return;
        }
        if ( !limited && !(await Economy.spendInteraction(looter, { label: `Take ${item.name}` })) ) return;
        const result = await moveItem(target, looter, itemId, limited ? 1 : quantity);
        if ( !result ) return;
        if ( limited ) {
          await this.cfg.onTaken?.(result);
          this.close();
        }
      } catch(err) { console.error(`${MODULE_ID} | bodies: take failed`, err); }
      finally { this.busy = false; }
    }

    _onClose() { openWindows.delete(this); }
  };
  return LootWindow;
}

/**
 * Open the loot window.
 * @param {Actor|TokenDocument} target
 * @param {Actor} looter
 * @param {object} [options]
 * @param {"full"|"limited"} [options.mode="full"]  "limited": one unit of one small unequipped item, then it closes.
 * @param {Function} [options.onTaken]              Called with { name, quantity } after a limited take.
 */
export function openLoot(target, looter, { mode="full", onTaken=null }={}) {
  const t = target?.documentName === "Token" ? target.actor : target;
  const l = looter?.documentName === "Token" ? looter.actor : looter;
  if ( !t || !l ) return null;
  try {
    const app = new (lootWindowClass())({ target: t, looter: l, mode, onTaken });
    openWindows.add(app);
    app.render({ force: true });
    return app;
  } catch(err) { console.error(`${MODULE_ID} | bodies: loot window failed`, err); warn("could not open the loot window", true); return null; }
}

function refreshWindows(item) {
  const actor = item?.parent;
  if ( !actor ) return;
  for ( const app of openWindows ) if ( app.cfg.target === actor ) app.render();
}

/* -------------------------------------------- */
/*  Pickpocket                                  */
/* -------------------------------------------- */

/** GM client: ask whether the attempt has disadvantage (20 s, default No). */
async function askDisadvantageLocal({ pickpocket, target }) {
  try {
    const answer = await foundry.applications.api.DialogV2.wait({
      window: { title: "Pickpocket" }, rejectClose: false,
      content: `<p>Impose disadvantage on <strong>${esc(pickpocket)}</strong>'s pickpocket attempt against <strong>${esc(target)}</strong>? (alert or suspicious)</p>`,
      buttons: [{ action: "yes", label: "Yes" }, { action: "no", label: "No", default: true }],
      render: (event, dialog) => setTimeout(() => { try { dialog.close(); } catch(err) { /* already closed */ } }, ASK_TIMEOUT_MS)
    });
    return answer === "yes";
  } catch(err) { return false; }
}

/**
 * Pickpocket a conscious creature (see the header).
 * @param {TokenDocument|Actor} target
 * @param {Actor} actor  The pickpocket.
 */
export async function pickpocket(target, actor) {
  const tActor = target?.documentName === "Token" ? target.actor : target;
  if ( !tActor || !actor ) return null;
  if ( !isHidden(actor) ) { ui.notifications.warn("You must be hidden."); return null; }
  if ( !(await Economy.spendUtilize(actor, { label: "Pickpocket", fastHands: true })) ) return null;

  const gm = gmUser();
  const disadvantage = gm
    ? !!(await Creatures.runAs(gm, "bodiesAskDisadvantage", { pickpocket: actor.name, target: tActor.name }))
    : false;

  const prc = tActor.system?.skills?.prc;
  const dc = Number(prc?.passive) || (10 + (Number(prc?.total) || 0));
  const config = { skill: "slt", target: dc };
  if ( disadvantage ) config.disadvantage = true;
  const rolls = await actor.rollSkill(config, { configure: false }, {});
  const total = rolls?.[0]?.total;
  if ( (total === undefined) || (total === null) ) return null;

  if ( total < dc ) {
    await whisper(actor, `<strong>${esc(actor.name)}</strong> fails to pickpocket <strong>${esc(tActor.name)}</strong> (${total} vs DC ${dc}).`,
      game.users.filter(u => u.isGM).map(u => u.id));
    return { success: false, total, dc };
  }
  openLoot(tActor, actor, { mode: "limited", onTaken: ({ name }) => whisper(actor,
    `<strong>${esc(actor.name)}</strong> pickpockets <strong>${esc(name)}</strong> from <strong>${esc(tActor.name)}</strong>.`,
    privateAudience(actor)) });
  return { success: true, total, dc };
}

/* -------------------------------------------- */
/*  Hooks, interactions and registration        */
/* -------------------------------------------- */

function registerInteractions() {
  const notSelf = (target, actor) => !!target.actor && (target.actor !== actor);
  registerInteraction({
    id: "bodies.pickUp", label: "Pick up", icon: "fa-solid fa-person-walking-luggage", range: RANGE,
    available: (target, actor) => notSelf(target, actor) && isDown(target.actor),
    run: (target, actor) => pickUp(actor, target)
  });
  registerInteraction({
    id: "bodies.loot", label: "Loot", icon: "fa-solid fa-sack-xmark", range: RANGE,
    available: (target, actor) => notSelf(target, actor) && isDown(target.actor),
    run: async (target, actor) => { openLoot(target.actor, actor, { mode: "full" }); }
  });
  registerInteraction({
    id: "bodies.pickpocket", label: "Pickpocket", icon: "fa-solid fa-hand-holding", range: RANGE,
    available: (target, actor) => notSelf(target, actor) && isCreature(target.actor) && !isDown(target.actor)
      && (game.user.isGM || !target.isOwner),
    blocked: (target, actor) => (isHidden(actor) ? null : "You must be hidden"),
    run: (target, actor) => pickpocket(target.actor, actor)
  });
}

function registerHandlers() {
  Creatures.HANDLERS.bodiesPickUp = payload => pickUpLocal(payload);
  Creatures.HANDLERS.bodiesPutDown = payload => putDownLocal(payload);
  Creatures.HANDLERS.bodiesMove = payload => moveLocal(payload);
  Creatures.HANDLERS.bodiesAskDisadvantage = payload => askDisadvantageLocal(payload);
}

function registerHooks() {
  // Token HUD on a carrier: Put down.
  Hooks.on("renderTokenHUD", (app, html) => {
    try {
      const token = app.document ?? app.object?.document;
      const root = html instanceof HTMLElement ? html : html?.[0];
      if ( !token?.actor || !root || !token.isOwner || !carriedBodies(token.actor).length ) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "control-icon aet-bodies";
      btn.dataset.tooltip = "Put down the body you carry";
      btn.innerHTML = `<i class="fa-solid fa-arrow-down-to-line"></i>`;
      btn.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); app.close?.(); putDownMenu(token.actor); });
      (root.querySelector(".col.left") ?? root.querySelector(".left") ?? root).append(btn);
    } catch(err) { console.error(err); }
  });

  // Sheet context menu on the container.
  Hooks.on("dnd5e.getItemContextOptions", (item, menuItems) => {
    if ( !Array.isArray(menuItems) ) return;
    menuItems.push({
      label: "Put down", icon: "fa-solid fa-arrow-down-to-line", group: "action",
      visible: () => !!item.actor && item.isOwner && isBodyContainer(item),
      onClick: () => putDown(item.actor, item)
    });
  });

  // Deleting a carried body (or dropping it, which deletes it from the dropper) puts the body down instead.
  Hooks.on("preDeleteItem", (item, options) => {
    if ( options?.alivasBodiesSkip || !isBodyContainer(item) || !item.actor ) return;
    if ( !item.flags[MODULE_ID].body.tokenData ) return;
    putDown(item.actor, item);
    return false;
  });

  // A body container copied onto an Item Pile actor: remove the copy again (the dropper's own copy puts the body down).
  Hooks.on("createItem", item => {
    try {
      if ( !isBodyContainer(item) || !item.parent || !isItemPile(item.parent) || !Creatures.isLeadGM() ) return;
      item.delete({ deleteContents: true, ...SKIP });
    } catch(err) { console.error(err); }
  });

  // Loot window refresh.
  for ( const hook of ["createItem", "updateItem", "deleteItem"] ) Hooks.on(hook, item => refreshWindows(item));
  Hooks.on("deleteActor", actor => { for ( const app of [...openWindows] ) if ( app.cfg.target === actor ) app.close(); });
}

/** Called once at ready by main.mjs with the engine's shared helpers. */
export function registerBodies(deps) {
  try {
    game.settings.register(MODULE_ID, "bodyWeightBySize", {
      name: "Body weight by size (lb)", scope: "world", config: false, type: String,
      default: JSON.stringify(BODY_WEIGHT_BY_SIZE)
    });
  } catch(err) { console.warn(`${MODULE_ID} | bodies: could not register bodyWeightBySize`, err); }
  registerHandlers();
  registerInteractions();
  registerHooks();
  console.log(`${MODULE_ID} | bodies: ready`);
}

export const api = { pickUp, putDown, openLoot, pickpocket };
