/**
 * Alivas's Engine of Triggers — throwing items (T-033): any carried item thrown at a creature (an attack) or at a space
 * (no roll); the item lands on the map as a loot pile (Item Piles, through Loot.dropItems). Weapons with the Thrown
 * property land the same way after a thrown attack.
 *
 * RULES (the maintainer's table rulings, 2026-11-26; 2024 PHB: Improvised Weapons p. 369, Carrying Capacity p. 362,
 * Attack Roll Abilities p. 12, Thrown p. 214)
 *   Bands       By the weight of ONE unit, the thrower's Strength score S and size factor m (Tiny ½, Small/Medium 1,
 *               Large 2, Huge 4, Gargantuan 8 — the Carrying Capacity table's pattern):
 *                 light   up to S × throwLightPerStr (0.5) × m lb   one hand    range 20/60
 *                 heavy   up to S × throwHeavyPerStr (2) × m lb     two hands   range 10/30
 *                 heavier: can't be thrown.
 *               Hands are stated, not checked.
 *   Attack      At a creature (the user's one target): a ranged weapon attack with Dexterity for attack and damage; no
 *               Proficiency Bonus unless the thrower is proficient with improvised weapons (dnd5e's tavernBrawlerFeat
 *               flag, or a feat with identifier "tavern-brawler"). Damage 1d4, or 1d8 at throwHeavyDieLb (10) lb or more
 *               (Weapon Equivalents: Greatclub), of the item's "damage type when thrown" (item flag throwDamageType,
 *               default bludgeoning). Beyond the band's normal range: Disadvantage; beyond its long range: refused
 *               (Thrown weapons are left to dnd5e, which checks neither). While the item is lit (an applied enchantment with an Engine `light` rule), the
 *               Fire damage of its own attack is added (Torch: 1 Fire).
 *               Done with a STAND-IN: a temporary weapon (type improv, flag thrownStandIn) is created on the thrower and
 *               its attack used through the normal dnd5e + Engine workflow. It is unequipped (no Extra Attack follow-ups)
 *               and deleted when the attack is resolved, at the next throw, or after STANDIN_TTL.
 *   Thrown      A weapon with the Thrown property thrown at a creature uses its own attack (thrown mode). dnd5e 6.1
 *   weapons     lowers its quantity by 1 on a thrown attack unless it has the Returning property ("ret"); after that
 *               attack a copy of one unit lands (Loot.dropItems keep: the inventory is left to dnd5e). A Returning
 *               weapon, or one that had no quantity left when thrown, doesn't land.
 *   Landing     Hit or miss, in a random free square adjacent to the target (trade.mjs scatterSpot). The DM deletes a
 *               destroyed item by hand (no fragile check here).
 *   Space       The thrower picks a square (dnd5e TokenPlacement). Within the band's normal range it lands there;
 *               beyond it, up to the long range, in a random free square adjacent to it; further is refused. No roll.
 *   Cost        One attack of the Attack action, either way. The stand-in's activation is the Action (the economy marks
 *               it; Extra Attack follow-ups work as for any attack). A space throw marks the Action when it is unused,
 *               and otherwise counts as a further attack of the same Attack action (nothing is refused).
 *   Not throwable: items inside a container (take it out first), worn armor in combat (Loot.dropTiming refuses).
 *
 * TIMING — landing waits for the Engine's hook `alivasTriggers.attackResolved({ activity, roll, targets, landed })`
 *   (main.mjs, after hits, reactions, damage and onHit). With the attack workflow off, the hook still fires after the
 *   roll. Chat cards of stand-ins and Thrown weapons store the item in `system.deltas.deleted`, so their buttons keep working once
 *   the item has left (ChatMessage5e#getAssociatedItem falls back to it).
 *
 * WORLD SETTINGS (Automation settings → Trading): throwItems, throwLightPerStr, throwHeavyPerStr, throwHeavyDieLb.
 * ITEM FLAG (reactions editor → Item settings): throwDamageType (a dnd5e damage type). Returning: dnd5e's own property.
 *
 * API (engine api.throwing):
 *   bandOf(actor, item) → { band: "light"|"heavy"|null, lb, light, heavy, normal, long, hands }
 *   throwAtTarget(actor, item, token) / throwAtSpace(actor, item) → Promise<boolean>
 *   openThrow(item)   the sheet's "Throw…" dialog
 */

import * as Creatures from "./creatures.mjs";
import * as Economy from "./economy.mjs";
import * as Loot from "./loot.mjs";
import { scatterSpot, unitWeightLb } from "./trade.mjs";
import { opt } from "./settings.mjs";

const MODULE_ID = "alivas-engine-of-triggers";
const STANDIN_TTL = 10 * 60 * 1000;
const THROWABLE_TYPES = ["weapon", "equipment", "consumable", "tool", "loot", "container"];
const SIZE_FACTOR = { tiny: 0.5, sm: 1, med: 1, lg: 2, huge: 4, grg: 8 };
const BANDS = { light: { normal: 20, long: 60, hands: 1 }, heavy: { normal: 10, long: 30, hands: 2 } };

const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
const note = message => ui.notifications?.warn(`Throw: ${message}`);
const chat = (actor, content) => ChatMessage.implementation.create({
  speaker: actor ? ChatMessage.implementation.getSpeaker({ actor }) : undefined, content: `<p>${content}</p>` });

/** Stand-in id → timer, for clean-up. */
const standIns = new Map();
/** Thrown-weapon attack (activity uuid) → its quantity before dnd5e lowered it. */
const thrownQty = new Map();

/* -------------------------------------------- */
/*  Rules                                       */
/* -------------------------------------------- */

/** Weight of one unit; a container counts with its contents. */
function throwWeight(item) {
  if ( item.type === "container" ) {
    const total = Number(item.system?.totalWeight);
    if ( Number.isFinite(total) ) return total / Math.max(1, Number(item.system?.quantity ?? 1) || 1);
  }
  return unitWeightLb(item);
}

/** The band an item falls in for this thrower. */
export function bandOf(actor, item) {
  const str = Number(actor?.system?.abilities?.str?.value ?? 10) || 0;
  const m = SIZE_FACTOR[actor?.system?.traits?.size] ?? 1;
  const light = str * (Number(opt("throwLightPerStr")) || 0) * m;
  const heavy = str * (Number(opt("throwHeavyPerStr")) || 0) * m;
  const lb = throwWeight(item);
  const band = (lb <= light) ? "light" : ((lb <= heavy) ? "heavy" : null);
  return { band, lb, light, heavy, ...(band ? BANDS[band] : { normal: 0, long: 0, hands: 0 }) };
}

const hasThrownProperty = item => (item?.type === "weapon") && !!item.system?.properties?.has?.("thr");
const isStandIn = item => !!item?.getFlag?.(MODULE_ID, "thrownStandIn");

/** Applied, active enchantment with an Engine light rule: the item is lit (as main.mjs itemLightRule). */
function isLit(item) {
  return (item?.effects ?? []).some(e => (e.type === "enchantment") && !e.disabled && !e.isSuppressed
    && (e.isAppliedEnchantment ?? !!e.system?.origin?.activity) && !!e.getFlag(MODULE_ID, "light"));
}

/** Fire damage parts of the item's own attack (added to a throw while lit). */
function fireParts(item) {
  const attack = item.system?.activities?.find?.(a => a.type === "attack");
  return (attack?.damage?.parts ?? []).filter(p => p.types?.has?.("fire")).map(p => p.toObject?.() ?? foundry.utils.deepClone(p));
}

/** Proficient with improvised weapons: dnd5e's own flag, or a Tavern Brawler feat. */
const improvisedProficient = actor => !!actor.getFlag?.("dnd5e", "tavernBrawlerFeat")
  || actor.items.some(i => (i.type === "feat") && (i.system?.identifier === "tavern-brawler"));

function damageTypeOf(item) {
  const flag = item.getFlag?.(MODULE_ID, "throwDamageType");
  return (flag && CONFIG.DND5E.damageTypes?.[flag]) ? flag : "bludgeoning";
}

/** Why this item can't be thrown right now, or null. */
function refusal(actor, item, band) {
  if ( !Loot.isActive() ) return "the landing needs Item Piles.";
  if ( isStandIn(item) ) return `${item.name} is already in the air.`;
  if ( item.system?.container ) return `take it out of ${actor.items.get(item.system.container)?.name ?? "its container"} first.`;
  if ( Loot.dropTiming(actor, item) === "refuse" ) return `${item.name} is worn armor.`;
  if ( !band.band ) return `${item.name} weighs ${round(band.lb)} lb; ${actor.name} can throw up to ${round(band.heavy)} lb.`;
  if ( !Creatures.tokenFor(actor) ) return `${actor.name} needs a token on the scene.`;
  return null;
}
const round = n => Math.round(n * 10) / 10;

/* -------------------------------------------- */
/*  Landing                                     */
/* -------------------------------------------- */

/** One unit of `item` lands at a position (or next to a token), as a pile. */
async function land(actor, item, position, { keep=false }={}) {
  if ( !item || (item.parent !== actor) || !actor.items.has(item.id) ) return null;
  return Loot.dropItems(actor, [{ item, quantity: 1 }], { position, skipTiming: true, verb: "throws", quiet: true, keep });
}

/** A 1×1 probe at a top-left position, for scatterSpot / distances. */
const probeAt = (scene, { x, y }) => ({ id: null, parent: scene, width: 1, height: 1, _source: { x, y } });

/* -------------------------------------------- */
/*  At a creature                               */
/* -------------------------------------------- */

async function removeStandIn(actor, id) {
  clearTimeout(standIns.get(id));
  standIns.delete(id);
  if ( actor?.items.has(id) ) await actor.deleteEmbeddedDocuments("Item", [id]).catch(() => null);
}

/** Remove any stand-in this actor still has (an earlier throw whose attack was never rolled). */
async function clearStandIns(actor) {
  const ids = actor.items.filter(isStandIn).map(i => i.id);
  for ( const id of ids ) await removeStandIn(actor, id);
}

function standInData(actor, item, band) {
  const id = foundry.utils.randomID();
  const heavyDie = band.lb >= (Number(opt("throwHeavyDieLb")) || 10);
  return {
    name: `${item.name} (thrown)`, type: "weapon", img: item.img,
    system: {
      type: { value: "improv", baseItem: "" }, equipped: false, quantity: 1, weight: { value: 0, units: "lb" },
      proficient: improvisedProficient(actor) ? 1 : null,
      range: { value: band.normal, long: band.long, units: "ft" },
      damage: { base: { number: 1, denomination: heavyDie ? 8 : 4, bonus: "", types: [damageTypeOf(item)] } },
      activities: { [id]: {
        _id: id, type: "attack", name: "Throw",
        activation: { type: "action", value: 1 },
        attack: { ability: "dex", type: { value: "ranged", classification: "weapon" } },
        damage: { includeBase: true, parts: isLit(item) ? fireParts(item) : [] },
        range: { override: false }, target: { affects: { count: "1", type: "creature" } }
      } }
    },
    flags: { [MODULE_ID]: { thrownStandIn: { itemId: item.id, hands: band.hands } } }
  };
}

/** Throw an item at a creature token. */
export async function throwAtTarget(actor, item, token) {
  const band = bandOf(actor, item);
  const why = refusal(actor, item, band);
  if ( why ) { note(why); return false; }
  if ( !token?.actor || (token.actor === actor) ) { note("target one creature to throw at."); return false; }
  const feet = Creatures.distanceFt(Creatures.tokenFor(actor, token.parent), token);
  if ( !hasThrownProperty(item) && (feet > band.long) ) { note(`${token.name} is ${feet} ft away; ${item.name} reaches ${band.long} ft.`); return false; }

  // A Thrown weapon: its own attack (choose the thrown mode); it lands when the attack is resolved.
  if ( hasThrownProperty(item) ) {
    const attack = item.system.activities.find(a => a.type === "attack");
    if ( !attack ) { note(`${item.name} has no attack.`); return false; }
    await attack.use();
    return true;
  }

  await clearStandIns(actor);
  const [standIn] = await actor.createEmbeddedDocuments("Item", [standInData(actor, item, band)]);
  if ( !standIn ) return false;
  standIns.set(standIn.id, setTimeout(() => removeStandIn(actor, standIn.id), STANDIN_TTL));
  const activity = standIn.system.activities.contents?.[0] ?? standIn.system.activities.find(() => true);
  const results = await activity?.use();
  if ( !results ) { await removeStandIn(actor, standIn.id); return false; }
  return true;
}

/* -------------------------------------------- */
/*  At a space                                  */
/* -------------------------------------------- */

/** The thrower picks a square; returns its top-left, or null. */
async function pickSquare(actor, item, band) {
  const Placement = dnd5e.canvas?.TokenPlacement;
  const token = Creatures.tokenFor(actor);
  if ( !Placement || !canvas?.ready || (canvas.scene !== token?.parent) ) { note("open the thrower's scene first."); return null; }
  const data = foundry.utils.mergeObject(actor.prototypeToken.toObject(), {
    width: 1, height: 1, name: item.name, texture: { src: item.img, scaleX: 0.75, scaleY: 0.75 }
  }, { inplace: false });
  const proto = new foundry.data.PrototypeToken(data, { parent: actor });
  for ( let attempt = 0; attempt < 3; attempt++ ) {
    ui.notifications.info(`Throw ${item.name}: pick a square (exact up to ${band.normal} ft, scatters up to ${band.long} ft).`);
    let placed;
    try { placed = await Placement.place({ tokens: [proto] }); }
    catch(err) { console.warn(`${MODULE_ID} | throw placement`, err); return null; }
    const spot = placed?.[0];
    if ( !spot ) return null;
    const feet = Creatures.distanceFt(token, probeAt(token.parent, spot));
    if ( feet <= band.long ) return { x: spot.x, y: spot.y, feet };
    ui.notifications.warn(`Throw ${item.name}: that's ${feet} ft away (long range ${band.long} ft) — try again.`);
  }
  return null;
}

/** Throw an item at a square the thrower picks. */
export async function throwAtSpace(actor, item) {
  const band = bandOf(actor, item);
  const why = refusal(actor, item, band);
  if ( why ) { note(why); return false; }
  const spot = await pickSquare(actor, item, band);
  if ( !spot ) return false;
  // One attack of the Attack action: mark the Action if it is still free.
  if ( Economy.inCombat(actor) && !Economy.used(actor, "action") ) await Economy.mark(actor, "action");
  const token = Creatures.tokenFor(actor);
  const exact = spot.feet <= band.normal;
  const where = exact ? { x: spot.x, y: spot.y } : scatterSpot(probeAt(token.parent, spot));
  const name = item.name;
  const dropped = await land(actor, item, where);
  if ( !dropped ) return false;
  await chat(actor, `<strong>${esc(actor.name)}</strong> throws ${esc(name)} ${spot.feet} ft (one attack of the Attack action)${exact ? "." : " — beyond normal range, it lands a square off."}`);
  return true;
}

/* -------------------------------------------- */
/*  Resolution                                  */
/* -------------------------------------------- */

/** After an attack: land a stand-in's item, or a Thrown weapon thrown in thrown mode. Runs on the rolling client. */
async function onAttackResolved({ activity, roll, targets }) {
  const weapon = activity?.item;
  const actor = activity?.actor;
  if ( !weapon || !actor?.isOwner ) return;
  const target = (targets ?? []).find(t => t?.actor && (t.actor !== actor)) ?? null;
  const targetDoc = target?.document ?? target;

  const stand = weapon.getFlag?.(MODULE_ID, "thrownStandIn");
  if ( stand ) {
    const item = actor.items.get(stand.itemId);
    await removeStandIn(actor, weapon.id);
    if ( !item ) return;
    if ( !targetDoc ) { note(`no target — ${item.name} stays with ${actor.name}.`); return; }
    const dropped = await land(actor, item, scatterSpot(targetDoc));
    if ( dropped ) await chat(actor, `${esc(item.name)} lands next to <strong>${esc(targetDoc.name)}</strong>.`);
    return;
  }

  const before = thrownQty.get(activity.uuid);
  thrownQty.delete(activity.uuid);
  if ( !(before >= 1) || !actor.items.has(weapon.id) || !targetDoc ) return;
  const dropped = await land(actor, weapon, scatterSpot(targetDoc), { keep: true });
  if ( dropped ) await chat(actor, `${esc(weapon.name)} lands next to <strong>${esc(targetDoc.name)}</strong>.`);
}

/* -------------------------------------------- */
/*  Sheet entry                                 */
/* -------------------------------------------- */

/** "Throw…": at the one targeted creature, or at a space. */
export async function openThrow(item) {
  const actor = item.actor;
  if ( !actor ) return;
  const band = bandOf(actor, item);
  const why = refusal(actor, item, band);
  if ( why ) { note(why); return; }
  const targets = Array.from(game.user.targets ?? []).filter(t => t.actor && (t.actor !== actor));
  const target = (targets.length === 1) ? targets[0] : null;
  const kind = hasThrownProperty(item) ? "its own thrown attack"
    : `${band.lb >= (Number(opt("throwHeavyDieLb")) || 10) ? "1d8" : "1d4"} ${damageTypeOf(item)}${isLit(item) && fireParts(item).length ? " + its Fire (lit)" : ""}, Dexterity`;
  const buttons = [];
  if ( target ) buttons.push({ action: "target", label: `At ${target.name}`, icon: "fa-solid fa-bullseye", default: true });
  buttons.push({ action: "space", label: "At a space", icon: "fa-solid fa-location-crosshairs", default: !target });
  buttons.push({ action: "cancel", label: "Cancel" });
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: `${actor.name} — throw ${item.name}` }, rejectClose: false,
    content: `<p><strong>${esc(item.name)}</strong>: ${round(band.lb)} lb, ${band.band} for ${esc(actor.name)}
      (${band.hands === 2 ? "two hands" : "one hand"}, range ${band.normal}/${band.long} ft).</p>
      <p>At a creature: ${esc(kind)}. At a space: no roll; beyond ${band.normal} ft it lands a square off.</p>
      ${target ? "" : `<p class="hint">Target exactly one creature to throw at it.</p>`}`,
    buttons
  });
  if ( choice === "target" ) return throwAtTarget(actor, item, target);
  if ( choice === "space" ) return throwAtSpace(actor, item);
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

let registered = false;

export function registerThrow() {
  if ( registered ) return;
  registered = true;

  Hooks.on("dnd5e.getItemContextOptions", (item, menuItems) => {
    if ( !Array.isArray(menuItems) ) return;
    menuItems.push({
      label: "Throw…", icon: "fa-solid fa-hand-fist", group: "action",
      visible: () => opt("throwItems") && Loot.isActive() && !!item.actor && item.isOwner && !item.actor.system?.isGroup
        && THROWABLE_TYPES.includes(item.type) && !isStandIn(item),
      onClick: () => openThrow(item)
    });
  });

  // An improvised throw beyond its normal range has Disadvantage (dnd5e doesn't check range).
  Hooks.on("dnd5e.preRollAttackV2", config => {
    const stand = config.subject?.item?.getFlag?.(MODULE_ID, "thrownStandIn");
    if ( !stand ) return;
    const from = Creatures.tokenFor(config.subject.actor);
    const normal = Number(config.subject.item.system?.range?.value) || 0;
    if ( Array.from(game.user.targets ?? []).some(t => t.document && (Creatures.distanceFt(from, t.document) > normal)) ) config.disadvantage = true;
  });

  // A thrown attack with a Thrown weapon: note the quantity now (this hook runs before dnd5e lowers it).
  Hooks.on("dnd5e.rollAttackV2", (rolls, { subject }={}) => {
    const item = subject?.item;
    if ( !opt("throwItems") || !hasThrownProperty(item) || item.system.properties.has("ret") ) return;
    if ( !String(rolls?.[0]?.options?.attackMode ?? "").startsWith("thrown") ) return;
    thrownQty.set(subject.uuid, Number(item.system.quantity ?? 0) || 0);
  });

  Hooks.on("alivasTriggers.attackResolved", data => {
    if ( !opt("throwItems") ) return;
    onAttackResolved(data).catch(err => console.error(`${MODULE_ID} | throw landing failed`, err));
  });

  // Cards of stand-ins and Thrown weapons keep a copy of the item: it may have left by the time a button is used. dnd5e
  // 6.1 drops flags.dnd5e.item.data; it reads system.deltas.deleted (usage and attack cards; a damage card asks the card
  // it came from).
  Hooks.on("preCreateChatMessage", message => {
    try {
      const uuid = message.system?.item?.uuid ?? message.getFlag?.("dnd5e", "item.uuid");
      if ( !uuid ) return;
      const item = fromUuidSync(uuid, { strict: false });
      if ( !(item instanceof Item) || !(isStandIn(item) || hasThrownProperty(item)) ) return;
      if ( !("deltas" in (message.system ?? {})) ) {
        // A damage card without an origin (the Engine's hit damage): point it at the latest card holding the copy.
        if ( !("origin" in (message.system ?? {})) || message.system.origin ) return;
        const from = game.messages.contents.findLast(m => (m.system?.item?.id === item.id) && m.system?.deltas?.deleted?.length);
        if ( from ) message.updateSource({ "system.origin": from.id });
        return;
      }
      const deltas = message._source.system?.deltas ?? { actor: [], item: {} };
      const deleted = (deltas.deleted ?? []).filter(d => d?._id !== item.id);
      message.updateSource({ "system.deltas": { ...deltas, deleted: [...deleted, item.toObject()] } });
    } catch(err) { console.warn(`${MODULE_ID} | throw: could not store the item on its card`, err); }
  });
}
