/**
 * Alivas's Engine of Triggers — trading: handing an item to another creature, throwing it, catching it, and taking it out
 * of a container in combat. Item Piles (module id "item-piles", v3.x) is OPTIONAL: its give flow is intercepted when it is
 * there, and a drop handler of our own covers the case where it is missing or its giving setting is off.
 *
 * TRIGGER — dragging an item from a sheet onto another creature's token ("passing it over to them").
 *   Item Piles: hook `item-piles-preGiveItem(sourceActor, targetActor, itemData, userId)` (itemData = { item, quantity };
 *     it fires after Item Piles' own quantity prompt). We return false (Item Piles' receiver-side confirm never appears) and
 *     run our own flow asynchronously. Item Piles only gives when its world setting `item-piles.enableGivingItems` is on
 *     (default: on) and the drop lands on a token that is not an item pile.
 *   Fallback: hook `dropCanvasData` (data.type === "Item", an item on an actor the user owns, dropped on another creature's
 *     token) — used ONLY when Item Piles is missing or its giving setting is off, so the two never both act.
 *
 * RULES (the maintainer's table rulings; 2024 PHB: Utilize action, free object interaction)
 *   Containers   An item inside a container (`system.container` set) can't be traded: "Take it out of <container> first".
 *                Trading something held or worn on the belt, or a whole container (a backpack), is one free interaction.
 *   Retrieving   In combat, taking an item out of a container is the Utilize action and needs a free hand
 *                (Maneuvers.hasFreeHand); a Thief's Fast Hands may use the Bonus Action. So: Utilize to retrieve, then the
 *                free interaction to hand it over. Hook `preUpdateItem`: an item on an actor in a started combat whose
 *                `system.container` goes from an id to empty. The update is cancelled, the cost is paid, then the same
 *                update is re-applied with the option flag `alivasRetrieve` (which skips the check). Dragging out of a
 *                container on the sheet is the same update, so it is covered too.
 *   In reach     Within reach the hand-over succeeds. Reach is 5 ft, 10 ft with an equipped reach weapon (property "rch",
 *                as maneuvers.mjs). In combat it costs the free object interaction (Economy.spendInteraction: else
 *                Utilize, asked); refused: cancelled.
 *   Out of reach Outside combat a hand-over succeeds at any distance on the same scene, with no throw (the maintainer's
 *                accepted default). In combat the target must "catch" it: a throw.
 *   Throw        The thrower's Utilize action (no Fast Hands). At most 20 ft; further is refused with a notice. No attack
 *                roll. If a conscious hostile (Creatures.relation === "enemy") is within 5 ft of the thrower, the GM is asked
 *                (Yes by default) whether to require a DC 10 Strength or Dexterity check (the better modifier). On a failure
 *                the item lands in a random free square adjacent to the catcher as a loot pile (Loot.dropItems, verb
 *                "throws") and nobody catches it.
 *   Catch        The catcher's Reaction (Reactions.ask: Catch it / Skip). Needs a Reaction left and a free hand, else it falls.
 *                The GM is asked whether the item is awkward or heavy (DC 15; default No, Yes preselected at 10 lb or more).
 *                Dexterity check vs DC 10/15; Advantage with Sleight of Hand or Acrobatics proficiency, or any gaming set.
 *   Outcome      Success: the item is transferred and the Reaction is spent. A natural 20 catches it without spending the
 *                Reaction (and always succeeds). Failure: it falls into the catcher's space as a loot pile, or, if fragile,
 *                shatters and is lost (see isFragile).
 *
 * TRANSFER — a container goes with its contents (re-created on the receiver with nesting kept, then deleted from the giver);
 *   anything else goes through game.itempiles.API.transferItems(source, target, [{ _id, quantity }]) when available, else
 *   by creating on the receiver and deleting/reducing on the giver. Equipped/attuned state is cleared on arrival. When the
 *   user can't write both actors the work is routed to a GM client (handler `tradeTransfer`).
 *
 * Item Piles API used: game.itempiles.API.transferItems (feature-detected; failure falls back to the manual path).
 * Hooks used: item-piles-preGiveItem, dropCanvasData, preUpdateItem.
 * Engine: Economy (spendInteraction / spendUtilize / inCombat), Maneuvers.hasFreeHand, Reactions (ask / reactionUsed /
 *   markReactionUsed), Loot.dropItems, Creatures (runAs, HANDLERS, distanceFt, tokenFor, relation, spaceFree, controllerOf).
 *   HANDLERS added: tradeAsk, tradeRoll, tradeTransfer, tradeRemove.
 *
 * API (engine api.trade):
 *   give(giver, receiver, item, { quantity }) → Promise<boolean>   the whole flow above; true when the item changed hands
 *   retrieve(actor, item) → Promise<boolean>                        take an item out of its container (combat cost applies)
 *   isFragile(item) → boolean
 */

import * as Creatures from "./creatures.mjs";
import * as Economy from "./economy.mjs";
import * as Maneuvers from "./maneuvers.mjs";
import * as Reactions from "./reactions.mjs";
import * as Loot from "./loot.mjs";

const MODULE_ID = "alivas-engine-of-triggers";
const IP_ID = "item-piles";
const THROW_RANGE = 20;
const HEAVY_LB = 10;
const RETRIEVE_FLAG = "alivasRetrieve";
const INCAPACITATED = ["incapacitated", "unconscious", "paralyzed", "petrified", "stunned", "dead"];

let deps = {};
let registered = false;
const busy = new Set();

const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
const warn = (message, err) => { console.warn(`${MODULE_ID} | trade: ${message}`, err ?? ""); };
const note = message => ui.notifications?.warn(`Trade: ${message}`);
const chat = (actor, content) => ChatMessage.implementation.create({
  speaker: actor ? ChatMessage.implementation.getSpeaker({ actor }) : undefined, content: `<p>${content}</p>` });
const gmUser = () => (game.user.isGM ? game.user : (game.users.activeGM ?? null));
const qtyOf = item => Math.max(1, Number(item?.system?.quantity ?? 1) || 1);
const label = (item, quantity) => (quantity > 1 ? `${item.name} ×${quantity}` : item.name);

/** Token / TokenDocument / Actor / uuid → actor. */
function actorOf(x) {
  if ( typeof x === "string" ) x = fromUuidSync(x);
  if ( !x ) return null;
  if ( x.document?.documentName === "Token" ) return x.document.actor ?? null;
  if ( x.documentName === "Token" ) return x.actor ?? null;
  return x.documentName === "Actor" ? x : null;
}

/**
 * Does this item break when it falls? PLACEHOLDER: dnd5e has no Fragile property, so this is a guess — a potion consumable,
 * or a name containing vial / flask / bottle / potion / glass. The flag `flags["alivas-engine-of-triggers"].fragile`
 * (true or false) overrides the guess either way.
 */
export function isFragile(item) {
  const flag = item?.getFlag?.(MODULE_ID, "fragile");
  if ( typeof flag === "boolean" ) return flag;
  if ( (item?.type === "consumable") && (item.system?.type?.value === "potion") ) return true;
  return /vial|flask|bottle|potion|glass/i.test(item?.name ?? "");
}

/* -------------------------------------------- */
/*  GM client handlers                          */
/* -------------------------------------------- */

/** Yes / No popup. { title, html, defaultYes } → boolean. */
async function askHandler({ title, html, defaultYes=true }) {
  const pick = await foundry.applications.api.DialogV2.wait({
    window: { title }, content: html, rejectClose: false,
    buttons: [{ action: "yes", label: "Yes", default: defaultYes }, { action: "no", label: "No", default: !defaultYes }]
  });
  return pick === "yes";
}

/** Ask the GM; with no GM connected the default stands. */
async function askGM(title, html, defaultYes) {
  const gm = gmUser();
  if ( !gm ) return defaultYes;
  const result = await Creatures.runAs(gm, "tradeAsk", { title, html, defaultYes });
  return (result === null) ? defaultYes : !!result;
}

/** Roll an ability check on the actor's controller's client. → { total, nat } */
async function rollHandler({ actorUuid, ability, dc, advantage=false }) {
  const actor = actorOf(actorUuid);
  if ( !actor ) return null;
  const rolls = await actor.rollAbilityCheck({ ability, target: dc, advantage: !!advantage }, { configure: false }, {});
  const roll = Array.isArray(rolls) ? rolls[0] : rolls;
  if ( !roll ) return null;
  const nat = roll.d20?.total ?? roll.dice?.[0]?.total ?? null;
  return { total: roll.total, nat };
}

/** A copy of the item's data for the receiving side: no longer worn, held or attuned. */
function cleanData(item) {
  const data = item.toObject();
  delete data._id;
  if ( "equipped" in (data.system ?? {}) ) data.system.equipped = false;
  if ( "attuned" in (data.system ?? {}) ) data.system.attuned = false;
  return data;
}

/** Move an item (a container with its contents) from one actor to another. Runs where the writes are allowed. */
async function transferHandler({ giverUuid, receiverUuid, itemId, quantity }) {
  const giver = actorOf(giverUuid), receiver = actorOf(receiverUuid);
  const item = giver?.items.get(itemId);
  if ( !giver || !receiver || !item ) return false;
  const stack = qtyOf(item);
  const qty = Math.min(Math.max(1, Number(quantity) || stack), stack);

  if ( item.type === "container" ) {
    const contents = Array.from(item.system.allContainedItems ?? []);
    const all = [item, ...contents];
    const idMap = new Map();
    let pending = all;
    while ( pending.length ) {
      const ready = pending.filter(i => (i === item) || !i.system.container || idMap.has(i.system.container));
      if ( !ready.length ) break;
      const datas = ready.map(i => {
        const d = cleanData(i);
        d.system.container = (i === item) ? null : idMap.get(i.system.container);
        return d;
      });
      const created = await receiver.createEmbeddedDocuments("Item", datas);
      ready.forEach((i, k) => idMap.set(i.id, created[k]?.id));
      pending = pending.filter(i => !ready.includes(i));
    }
    if ( !idMap.has(item.id) ) return false;
    const inner = contents.map(i => i.id).filter(id => giver.items.has(id));
    if ( inner.length ) await giver.deleteEmbeddedDocuments("Item", inner);
    await giver.deleteEmbeddedDocuments("Item", [item.id]);
    return true;
  }

  const api = game.itempiles?.API;
  if ( game.modules.get(IP_ID)?.active && (typeof api?.transferItems === "function") ) {
    try {
      const deltas = await api.transferItems(giver, receiver, [{ _id: item.id, quantity: qty }]);
      if ( deltas ) {
        // Whatever arrived is no longer worn or attuned.
        try {
          for ( const d of (Array.isArray(deltas) ? deltas : []) ) {
            const doc = receiver.items.get(d?.item?._id ?? d?.item?.id ?? d?._id);
            if ( doc && (doc.system?.equipped || doc.system?.attuned) ) await doc.update({ "system.equipped": false, "system.attuned": false });
          }
        } catch(err) { warn("could not clear equipped state on the received item", err); }
        return true;
      }
    } catch(err) { warn("Item Piles transferItems failed; transferring by hand", err); }
  }

  const data = cleanData(item);
  if ( "quantity" in (data.system ?? {}) ) data.system.quantity = qty;
  await receiver.createEmbeddedDocuments("Item", [data]);
  if ( qty >= stack ) await giver.deleteEmbeddedDocuments("Item", [item.id]);
  else await item.update({ "system.quantity": stack - qty });
  return true;
}

/** Destroy (some of) an item: a container's contents go with it. */
async function removeHandler({ actorUuid, itemId, quantity }) {
  const actor = actorOf(actorUuid);
  const item = actor?.items.get(itemId);
  if ( !item ) return false;
  const stack = qtyOf(item);
  const qty = Math.min(Math.max(1, Number(quantity) || stack), stack);
  if ( qty < stack ) { await item.update({ "system.quantity": stack - qty }); return true; }
  const inner = (item.type === "container") ? Array.from(item.system.allContainedItems ?? []).map(i => i.id).filter(id => actor.items.has(id)) : [];
  if ( inner.length ) await actor.deleteEmbeddedDocuments("Item", inner);
  await actor.deleteEmbeddedDocuments("Item", [item.id]);
  return true;
}

/** Run a write-heavy handler here when allowed, else on a GM client. */
async function runWrite(handler, payload, actors) {
  const local = game.user.isGM || actors.every(a => a?.isOwner);
  if ( local ) return Creatures.HANDLERS[handler](payload);
  const gm = gmUser();
  if ( !gm ) { note("no GM is connected to move another creature's items."); return false; }
  return Creatures.runAs(gm, handler, payload);
}

/* -------------------------------------------- */
/*  Geometry and checks                         */
/* -------------------------------------------- */

/** Reach in feet: 5, or 10 with an equipped reach weapon (as maneuvers.mjs). */
const reachOf = actor => 5 + (actor.items.some(i => i.system?.properties?.has?.("rch") && i.system.equipped) ? 5 : 0);

const incapacitated = actor => INCAPACITATED.some(s => actor?.statuses?.has(s));

/** A random free square adjacent to a token (its own space if none is). Returns { x, y } in scene pixels. */
function scatterSpot(token) {
  const scene = token.parent;
  const s = scene.grid.size;
  const w = Math.max(1, Math.round(token.width)), h = Math.max(1, Math.round(token.height));
  const spots = [];
  for ( let dx = -1; dx <= w; dx++ ) {
    for ( let dy = -1; dy <= h; dy++ ) {
      if ( (dx >= 0) && (dx < w) && (dy >= 0) && (dy < h) ) continue;
      spots.push({ x: token._source.x + (dx * s), y: token._source.y + (dy * s) });
    }
  }
  const rect = scene.dimensions?.sceneRect;
  const probe = { id: token.id, parent: scene, width: 1, height: 1 };
  const free = spots.filter(p => (!rect || ((p.x >= rect.x) && (p.y >= rect.y) && (p.x < rect.right) && (p.y < rect.bottom)))
    && Creatures.spaceFree(probe, p.x, p.y));
  if ( !free.length ) return { x: token._source.x, y: token._source.y };
  return free[Math.floor(Math.random() * free.length)];
}

/** Proficiency with any gaming set: a tool item of type "game", or a tool proficiency whose config says so. */
function hasGamingSet(actor) {
  try {
    if ( actor.items.some(i => (i.type === "tool") && (i.system.type?.value === "game") && (Number(i.system.proficient ?? 0) >= 1)) ) return true;
    for ( const [key, tool] of Object.entries(actor.system?.tools ?? {}) ) {
      if ( !(Number(tool?.value ?? 0) >= 1) ) continue;
      const cfg = CONFIG.DND5E?.tools?.[key];
      const entry = cfg?.id ? fromUuidSync(cfg.id) : null;
      const type = cfg?.type ?? entry?.system?.type?.value ?? entry?.type?.value;
      if ( type === "game" ) return true;
      if ( !type && /game|dice|chess|cards|ante|gaming/i.test(key) ) return true;
    }
  } catch(err) { warn("gaming set check failed", err); }
  return false;
}

/** Catch check advantage: Sleight of Hand, Acrobatics, or a gaming set. */
const catchAdvantage = actor => (Number(actor.system?.skills?.slt?.value ?? 0) >= 1)
  || (Number(actor.system?.skills?.acr?.value ?? 0) >= 1) || hasGamingSet(actor);

/** An item's weight in pounds (all of the quantity). */
function weightLb(item, quantity) {
  const w = item.system?.weight;
  const value = Number(w?.value ?? w ?? 0) || 0;
  const units = w?.units ?? "lb";
  return value * quantity * ((units === "kg") ? 2.2046 : 1);
}

/** A check on an actor's controller's client. → { total, nat, success } or null. */
async function check(actor, ability, dc, advantage=false) {
  const user = Creatures.controllerOf(actor) ?? game.user;
  const result = await Creatures.runAs(user, "tradeRoll", { actorUuid: actor.uuid, ability, dc, advantage });
  if ( !result ) return null;
  return { ...result, success: (result.total >= dc) || (result.nat === 20) };
}

/* -------------------------------------------- */
/*  Giving                                      */
/* -------------------------------------------- */

/**
 * Hand over, or throw, an item. See the header.
 * @param {Actor5e} giver
 * @param {Actor5e} receiver
 * @param {Item5e} item        An item of the giver.
 * @param {object} [options]
 * @param {number} [options.quantity]  How many of a stack (default: all).
 * @returns {Promise<boolean>}  Did the item change hands?
 */
export async function give(giver, receiver, item, { quantity }={}) {
  giver = actorOf(giver); receiver = actorOf(receiver);
  if ( typeof item === "string" ) item = giver?.items.get(item);
  if ( !giver || !receiver || !item || (item.parent !== giver) || (giver === receiver) ) return false;
  if ( busy.has(item.uuid) ) return false;
  busy.add(item.uuid);
  try { return await giveFlow(giver, receiver, item, quantity); }
  catch(err) { console.error(`${MODULE_ID} | trade failed`, err); ui.notifications?.error("Trade failed; see the console."); return false; }
  finally { busy.delete(item.uuid); }
}

async function giveFlow(giver, receiver, item, quantity) {
  if ( item.system.container ) {
    note(`Take it out of ${giver.items.get(item.system.container)?.name ?? "its container"} first.`);
    return false;
  }
  const stack = qtyOf(item);
  const qty = Math.min(Math.max(1, Number(quantity) || stack), stack);
  const name = label(item, qty);

  const gt = Creatures.tokenFor(giver), rt = Creatures.tokenFor(receiver, gt?.parent);
  if ( !gt || !rt || (gt.parent !== rt.parent) ) { note("both creatures need a token on the same scene."); return false; }
  const distance = Creatures.distanceFt(gt, rt);
  const combat = Economy.inCombat(giver);
  const handOver = !combat || (distance <= reachOf(giver));

  const move = () => runWrite("tradeTransfer", { giverUuid: giver.uuid, receiverUuid: receiver.uuid, itemId: item.id, quantity: qty }, [giver, receiver]);

  if ( handOver ) {
    if ( combat && !(await Economy.spendInteraction(giver, { label: `Hand over ${item.name}` })) ) return false;
    if ( !(await move()) ) return false;
    await chat(giver, `<strong>${esc(giver.name)}</strong> hands <strong>${esc(receiver.name)}</strong> ${esc(name)}.`);
    return true;
  }

  // Throw.
  if ( distance > THROW_RANGE ) { note(`${receiver.name} is ${distance} ft away; a controlled throw reaches ${THROW_RANGE} ft.`); return false; }
  if ( !(await Economy.spendUtilize(giver, { label: `Throw ${item.name}`, fastHands: false })) ) return false;
  const who = `<strong>${esc(giver.name)}</strong> throws <strong>${esc(receiver.name)}</strong> ${esc(name)}`;

  const pressed = gt.parent.tokens.some(t => t.actor && (t.id !== gt.id) && !incapacitated(t.actor)
    && (Creatures.relation(t.actor, giver) === "enemy") && (Creatures.distanceFt(gt, t) <= 5));
  if ( pressed && await askGM(`${giver.name} — throw`,
    `<p>Require a DC 10 Strength or Dexterity check for <strong>${esc(giver.name)}</strong>'s throw? (enemy within 5 ft)</p>`, true) ) {
    const mod = a => Number(giver.system?.abilities?.[a]?.mod ?? 0);
    const ability = (mod("str") > mod("dex")) ? "str" : "dex";
    const r = await check(giver, ability, 10);
    if ( !r?.success ) {
      await chat(giver, `${who} — the toss goes wild (${r ? `${r.total} vs DC 10` : "no roll"}).`);
      await Loot.dropItems(giver, [{ item, quantity: qty }], { position: scatterSpot(rt), skipTiming: true, verb: "throws", quiet: true });
      return false;
    }
  }

  const lb = weightLb(item, qty);
  const heavy = await askGM(`${giver.name} — throw`,
    `<p>Is <strong>${esc(name)}</strong> awkward or heavy to catch (DC 15 instead of DC 10)?${lb >= HEAVY_LB ? ` <em>It weighs ${Math.round(lb)} lb.</em>` : ""}</p>`,
    lb >= HEAVY_LB);
  const dc = heavy ? 15 : 10;

  const fall = async reason => {
    if ( isFragile(item) ) {
      await runWrite("tradeRemove", { actorUuid: giver.uuid, itemId: item.id, quantity: qty }, [giver]);
      await chat(giver, `${who} — ${reason} ${esc(name)} shatters.`);
    } else {
      await chat(giver, `${who} — ${reason} It falls in ${esc(receiver.name)}'s space.`);
      await Loot.dropItems(giver, [{ item, quantity: qty }], { position: { x: rt._source.x, y: rt._source.y }, skipTiming: true, verb: "throws", quiet: true });
    }
    return false;
  };

  if ( incapacitated(receiver) || !Maneuvers.hasFreeHand(receiver) ) return fall(`${esc(receiver.name)} can't catch it.`);
  if ( Reactions.reactionUsed(receiver) ) return fall(`${esc(receiver.name)} has no Reaction left.`);
  const answer = await Reactions.ask(receiver, `<strong>${esc(giver.name)}</strong> throws you <strong>${esc(name)}</strong>.`,
    [{ id: "catch", label: "Catch it (Reaction)", detail: `Dexterity check, DC ${dc}.`, free: true, reaction: false }]);
  if ( answer?.choice !== "catch" ) return fall(`${esc(receiver.name)} doesn't catch it.`);

  const r = await check(receiver, "dex", dc, catchAdvantage(receiver));
  if ( !r?.success ) return fall(`${esc(receiver.name)} misses (${r ? `${r.total} vs DC ${dc}` : "no roll"}).`);
  const crit = r.nat === 20;
  if ( !crit ) await Reactions.markReactionUsed(receiver);
  if ( !(await move()) ) return false;
  await chat(giver, `${who} — ${esc(receiver.name)} catches it (${r.total} vs DC ${dc}${crit ? ", natural 20: no Reaction spent" : ""}).`);
  return true;
}

/* -------------------------------------------- */
/*  Retrieving                                  */
/* -------------------------------------------- */

/** Pay for taking an item out of a container in combat: a free hand and the Utilize action. Outside combat: free. */
async function retrievalAllowed(actor, item) {
  if ( !Economy.inCombat(actor) ) return true;
  if ( !Maneuvers.hasFreeHand(actor) ) { note(`${actor.name} needs a free hand to retrieve ${item.name}.`); return false; }
  return Economy.spendUtilize(actor, { label: `Retrieve ${item.name}`, fastHands: true });
}

/** Take an item out of its container (the combat cost applies). */
export async function retrieve(actor, item) {
  actor = actorOf(actor);
  if ( typeof item === "string" ) item = actor?.items.get(item);
  if ( !actor || !item?.system?.container ) return false;
  if ( !(await retrievalAllowed(actor, item)) ) return false;
  await item.update({ "system.container": null }, { [RETRIEVE_FLAG]: true });
  return true;
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/** Is Item Piles' own giving on? */
function ipGiving() {
  try { return !!game.modules.get(IP_ID)?.active && !!game.settings.get(IP_ID, "enableGivingItems"); }
  catch(err) { return false; }
}

/** The creature token under a canvas point (not the source's own). */
function tokenAt(point, exclude) {
  return canvas.tokens?.placeables.find(t => t.actor && (t.actor !== exclude) && !t.document.hidden
    && (point.x >= t.document.x) && (point.x < t.document.x + (t.document.width * canvas.grid.size))
    && (point.y >= t.document.y) && (point.y < t.document.y + (t.document.height * canvas.grid.size)))?.document ?? null;
}

export function registerTrade(d) {
  deps = d ?? deps;
  if ( registered ) return;
  registered = true;

  Creatures.HANDLERS.tradeAsk = askHandler;
  Creatures.HANDLERS.tradeRoll = rollHandler;
  Creatures.HANDLERS.tradeTransfer = transferHandler;
  Creatures.HANDLERS.tradeRemove = removeHandler;

  // Item Piles' give flow: replace it with ours.
  Hooks.on("item-piles-preGiveItem", (sourceActor, targetActor, itemData, userId) => {
    try {
      const item = sourceActor?.items?.get(itemData?.item?._id ?? itemData?.item?.id);
      if ( !item || !targetActor ) return;   // not an actor-to-actor give from a sheet: leave it to Item Piles
      give(sourceActor, targetActor, item, { quantity: itemData.quantity });
      return false;
    } catch(err) { warn("preGiveItem failed; leaving it to Item Piles", err); }
  });

  // Without Item Piles' giving, a drop on a token is a give.
  Hooks.on("dropCanvasData", (_canvas, data) => {
    try {
      if ( (data?.type !== "Item") || !data.uuid || ipGiving() ) return;
      const item = fromUuidSync(data.uuid);
      const source = item?.parent;
      if ( !source || (source.documentName !== "Actor") || !source.isOwner ) return;
      const token = tokenAt({ x: data.x, y: data.y }, source);
      if ( !token?.actor ) return;
      give(source, token.actor, item);
      return false;
    } catch(err) { warn("dropCanvasData failed", err); }
  });

  // Retrieving from a container in combat costs a free hand and the Utilize action.
  Hooks.on("preUpdateItem", (item, changes, options, userId) => {
    try {
      if ( (userId !== game.user.id) || options?.[RETRIEVE_FLAG] ) return;
      const actor = item.parent;
      if ( (actor?.documentName !== "Actor") || !item._source.system?.container ) return;
      if ( !foundry.utils.hasProperty(changes, "system.container") || foundry.utils.getProperty(changes, "system.container") ) return;
      if ( !Economy.inCombat(actor) ) return;
      const update = foundry.utils.deepClone(changes);
      retrievalAllowed(actor, item)
        .then(ok => ok ? item.update(update, { [RETRIEVE_FLAG]: true }) : null)
        .catch(err => console.error(`${MODULE_ID} | retrieve failed`, err));
      return false;
    } catch(err) { warn("preUpdateItem failed", err); }
  });
}

export const api = { give, retrieve, isFragile };
