/**
 * Alivas's Engine of Triggers — automated areas.
 *
 * An area is a Region with the engine's "Automated area" behavior. Foundry reports tokens entering and leaving it
 * (including when the area itself moves) and creatures starting or ending their turn in it; the engine turns those into
 * area events and runs the triggers of whatever owns the area:
 *
 *   areaCreated    once, when the area appears — the creatures inside are the targets (a Fireball's blast)
 *   areaEnter      a creature enters it (it moves in, or the area moves onto it)
 *   areaLeave      a creature leaves it
 *   areaTurnStart  a creature starts its turn in it
 *   areaTurnEnd    a creature ends its turn in it
 *
 * Owners: an effect with the flag `area: { radius, color }` (an emanation around its bearer that moves with it —
 * Flaming Sphere, an aura) runs its own triggers; an activity that places a template runs its `area.triggers`
 * (a save activity in automatic mode gets "when it appears: resolve the save; then remove it if instantaneous").
 * The creature an area surrounds and non-creatures are never its targets; a caster inside their own template is. A trigger with `oncePerTurn` fires at most once per
 * creature per turn.
 */

import * as Creatures from "./creatures.mjs";
import { isSkipping } from "./delay.mjs";

const MODULE_ID = "alivas-engine-of-triggers";
export const AREA_TYPE = `${MODULE_ID}.area`;
/** How long an instantaneous spell's area stays up after it resolves (ms). */
const AREA_LINGER_MS = 3000;
export const AREA_EVENTS = ["areaCreated", "areaEnter", "areaLeave", "areaTurnStart", "areaTurnEnd"];

let deps = {};
/**
 * @param {object} d
 * @param {Function} d.runTriggerList  (triggers, effect, bearer, event, context, { key, onRemove }) → run triggers
 * @param {Function} d.findUsageMessage
 * @param {Function} d.setting
 * @param {Function} d.saveMode       actor → "auto" | "roll" | "apply" | "off" (the save workflow's mode for it)
 */
export function initAreas(d) {
  deps = d;
}

/* -------------------------------------------- */
/*  Behavior type                               */
/* -------------------------------------------- */

export function registerAreaBehavior() {
  const Base = foundry.data.regionBehaviors?.RegionBehaviorType;
  if ( !Base ) return;
  const { fields } = foundry.data;
  class AreaBehavior extends Base {
    static defineSchema() {
      return {
        source: new fields.StringField({ required: true, blank: true, initial: "" }),
        level: new fields.NumberField({ nullable: true, initial: null }),
        usage: new fields.StringField({ required: true, blank: true, initial: "" })
      };
    }
    static events = {
      behaviorActivated: function(event) { return onCreated(this, event); },
      tokenEnter: function(event) { return onToken(this, "areaEnter", event); },
      tokenExit: function(event) { return onToken(this, "areaLeave", event); },
      tokenTurnStart: function(event) { return onToken(this, "areaTurnStart", event); },
      tokenTurnEnd: function(event) { return onToken(this, "areaTurnEnd", event); }
    };
  }
  CONFIG.RegionBehavior.dataModels[AREA_TYPE] = AreaBehavior;
  CONFIG.RegionBehavior.typeIcons[AREA_TYPE] = "fa-solid fa-burst";
  CONFIG.RegionBehavior.typeLabels[AREA_TYPE] = "Automated area (Alivas's Engine)";
}

/** Behavior data for an area owned by an effect or an activity. */
export function areaBehaviorData(source, { level=null, usage="" }={}) {
  return { type: AREA_TYPE, name: "Automated area", system: { source: source.uuid, level, usage } };
}

/* -------------------------------------------- */
/*  Events                                      */
/* -------------------------------------------- */

const createdAt = new Map();   // region id → { at, tokens: Set }
const oncePerTurnSeen = new Set();

async function onCreated(system, event) {
  if ( !Creatures.isLeadGM() ) return;
  const region = system.region;
  if ( !region ) return;
  // A new region's own token list fills in later: test the tokens directly.
  const inside = region.parent.tokens.filter(t => tokenInRegion(t, region));
  createdAt.set(region.id, { at: Date.now(), tokens: new Set(inside.map(t => t.id)) });
  const owner = resolveOwner(system);
  if ( !owner ) return;
  const targets = inside.map(t => t.actor).filter(a => isTarget(a, owner));
  await dispatch(system, owner, "areaCreated", { targets, subject: null });
}

async function onToken(system, name, event) {
  if ( !Creatures.isLeadGM() ) return;
  const token = event.data?.token;
  const region = system.region;
  // Hidden tokens are off-stage (Foundry still reports them entering and leaving).
  if ( !token?.actor || !region || (token.hidden && (name !== "areaLeave")) ) return;
  // Delay turn: a delayed end of turn, or a resumed start, isn't a real turn edge for the area either.
  const combatant = game.combats.find(c => c.started && c.combatants.some(cb => cb.tokenId === token.id))?.combatants.find(cb => cb.tokenId === token.id);
  if ( combatant && (((name === "areaTurnEnd") && isSkipping("end", combatant.id)) || ((name === "areaTurnStart") && isSkipping("start", combatant.id))) ) return;
  // Creatures already inside when the area appeared were handled by areaCreated.
  const born = createdAt.get(region.id);
  if ( (name === "areaEnter") && born && (Date.now() - born.at < 3000) && born.tokens.has(token.id) ) return;
  const owner = resolveOwner(system);
  if ( !owner || !isTarget(token.actor, owner) ) return;
  await dispatch(system, owner, name, { subject: token.actor, targets: [token.actor] });
}

/**
 * The area's owner: its triggers, bearer and a trigger "effect" (a real effect, or a stand-in for an activity).
 * @returns {{triggers: object[], bearer: Actor5e, effect: object, activity?: Activity, usage?: ChatMessage}|null}
 */
function resolveOwner(system) {
  const source = system.source ? fromUuidSync(system.source) : null;
  if ( !source ) return null;
  if ( source.documentName === "ActiveEffect" ) {
    const bearer = source.parent instanceof Actor ? source.parent : source.parent?.actor;
    return { triggers: source.getFlag(MODULE_ID, "triggers") ?? [], bearer, effect: source, token: system.region?.attachment?.token,
      excludeBearer: true };
  }
  // An activity (its template).
  const activity = source;
  const usage = system.usage ? game.messages.get(system.usage) : null;
  const scaled = usage?.getAssociatedActivity?.() ?? activity;
  const item = activity.actor?.items.get(activity.item.id) ?? activity.item;
  const region = system.region;
  const standIn = {
    name: item.name, img: item.img, parent: item, origin: item.uuid, uuid: `${region?.uuid}.area`,
    getSourceActor: () => activity.actor, getFlag: () => undefined,
    flags: { dnd5e: { spellLevel: system.level ?? scaled.item?.system?.level ?? 0 } },
    // An instantaneous spell's area lingers a moment before it goes, so animations placed on it (Automated Animations,
    // the Stage) can play — removing it at once cancels them.
    delete: async () => {
      setTimeout(() => { if ( region?.parent?.regions.get(region.id) ) region.delete(); }, AREA_LINGER_MS);
    }
  };
  return { triggers: areaTriggersFor(activity), bearer: activity.actor, effect: standIn, activity: scaled, usage,
    token: null };
}

/**
 * An activity's area triggers: its own (`area.triggers`), or for a save activity in automatic mode, "when it appears,
 * resolve the save on everyone inside; then remove the area if the spell is instantaneous".
 */
export function areaTriggersFor(activity) {
  const own = activity?.flags?.[MODULE_ID]?.area?.triggers;
  if ( Array.isArray(own) && own.length ) return own;
  if ( (activity?.type === "save") && ["auto", "roll", "apply"].includes(deps.saveMode?.(activity.actor)) ) {
    const units = activity.duration?.units ?? activity.item?.system?.duration?.units;
    const instant = !units || (units === "inst");
    return [{ label: activity.item?.name, event: "areaCreated", action: { type: "useActivity", to: { who: "targets" } },
      then: instant && deps.setting("wfRemoveTemplates") ? "remove" : "keep" }];
  }
  return [];
}

/** Does this activity get an automated area when it places a template? */
export function wantsArea(activity) {
  return areaTriggersFor(activity).length > 0;
}

async function dispatch(system, owner, event, context) {
  const region = system.region;
  let triggers = owner.triggers.filter(t => [t.event].flat().includes(event));
  if ( !triggers.length ) return;
  // oncePerTurn: at most once per creature per turn (per area and trigger).
  const combat = game.combats.find(c => c.started && (c.scene === region.parent || !c.scene));
  const turn = combat ? `${combat.id}:${combat.round}:${combat.turn}` : "none";
  triggers = triggers.filter((t, i) => {
    if ( !t.oncePerTurn || !context.subject ) return true;
    const key = `${region.id}|${i}|${context.subject.uuid}|${turn}`;
    if ( oncePerTurnSeen.has(key) ) return false;
    oncePerTurnSeen.add(key);
    return true;
  });
  if ( !triggers.length ) return;
  const full = { ...context, region, activity: owner.activity, usage: owner.usage, fromArea: true, data: { ...(context.data ?? {}) } };
  await deps.runTriggerList(triggers, owner.effect, owner.bearer, event, full, {
    key: `${region.uuid}|${context.subject?.uuid ?? "all"}`,
    // Ending an effect-owned area's trigger with "remove" ends the effect (and so the area); an activity's area goes.
    onRemove: () => owner.effect.delete()
  });
}

/**
 * An effect's area is going away with its effect: the creatures still inside count as leaving it ("areaLeave"), so
 * effects given while inside end too. Lead GM, before the region is deleted.
 * @param {RegionDocument} region
 * @param {ActiveEffect5e} effect   The (deleted) effect that owned it.
 */
export async function releaseArea(region, effect) {
  const system = region.behaviors?.find(b => b.type === AREA_TYPE)?.system;
  const triggers = (effect.getFlag(MODULE_ID, "triggers") ?? []).filter(t => [t.event].flat().includes("areaLeave"));
  if ( !system || !triggers.length ) return;
  const bearer = effect.parent instanceof Actor ? effect.parent : (effect.parent?.actor ?? null);
  const owner = { triggers, bearer, effect, excludeBearer: true };
  for ( const token of region.parent.tokens.filter(t => tokenInRegion(t, region)) ) {
    if ( !isTarget(token.actor, owner) ) continue;
    await deps.runTriggerList(triggers, effect, bearer, "areaLeave", { subject: token.actor, targets: [token.actor], region,
      fromArea: true, data: {} }, { key: `${region.uuid}|${token.actor.uuid}|release`, onRemove: async () => {} });
  }
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/** Is the actor something an area affects: a creature, not the creature the area surrounds (a caster in their own
 * template is affected)? */
function isTarget(actor, owner) {
  if ( !actor ) return false;
  if ( owner.excludeBearer && owner.bearer && (actor.uuid === owner.bearer.uuid) ) return false;
  return isCreature(actor);
}

/** A creature (not an object-like summon such as Flaming Sphere, and not a vehicle or group). */
export function isCreature(actor) {
  if ( !["character", "npc"].includes(actor?.type) ) return false;
  const type = actor.system.details?.type;
  return !(!type?.value && /object/i.test(type?.custom ?? ""));
}

/**
 * Is any grid space of the token inside the region?
 * @param {TokenDocument} token
 * @param {RegionDocument} region
 */
export function tokenInRegion(token, region) {
  if ( token.hidden ) return false;
  const size = token.parent.grid.size;
  const elevation = token.elevation ?? 0;
  for ( let i = 0; i < Math.max(1, Math.round(token.width)); i++ ) {
    for ( let j = 0; j < Math.max(1, Math.round(token.height)); j++ ) {
      const point = { x: token._source.x + ((i + 0.5) * size), y: token._source.y + ((j + 0.5) * size), elevation };
      if ( region.testPoint(point) ) return true;
    }
  }
  return false;
}
