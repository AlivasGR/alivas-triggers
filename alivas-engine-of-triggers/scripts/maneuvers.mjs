/**
 * Alivas's Engine of Triggers — combat maneuvers: generic mechanisms for grappling, dragging, passing through creatures,
 * checks with follow-up steps, and moving creatures to a chosen space. The Box's Combat Maneuvers and the patched
 * Unarmed Strike are built from these; nothing here is specific to one maneuver.
 *
 * Tether (effect flag `tether`) — a hold one creature keeps on another (Grappled):
 *   On the effect, as authored:  tether: { range: 5, drag: true }
 *   Stamped when applied:        tether: { …, source: <holder token uuid>, dc: <escape DC> }  (dc: the applying
 *                                activity's save DC, or tether.dc if authored)
 *   It ends (the effect is deleted) when the holder is Incapacitated, when the two are farther apart than `range`, or
 *   when the holder releases (action "release"). With drag, the held creature moves with its holder, and the holder's
 *   movement costs 1 extra foot per foot unless the held creature is Tiny or 2+ sizes smaller (2024 Grappled).
 *
 * Pass-through (effect flag `passThrough: [tokenId]`, on the mover, until its turn ends): those creatures don't block
 *   its movement (Tumble, Overrun). Also, per 2024, Incapacitated creatures never block (setting-free).
 *
 * Activity requirements (activity flag `requires`), checked before it's used; unmet → a notice and the use is blocked:
 *   { maxSizeAbove: 1 }  each target at most N sizes larger than the user
 *   { minSizeAbove: 2 }  each target at least N sizes larger than the user (Climb onto a Bigger Creature)
 *   { freeHand: true }   the user has a hand free (not two-handed weapon, not weapon + shield / two weapons)
 *   { grappling: true }  the user is grappling each target (a tether of the user's on it)
 *   { grappled: true }   the user is grappled (Escape)
 *   { speed: true }      the user's Speed isn't 0 (Drop Prone)
 *   { canLift: true }    each target's weight fits the user's remaining carrying capacity (Hurl)
 *
 * Actions (run as triggers or activity steps; `onSuccess` / `onFailure` are lists of further actions):
 *   check       { skills: ["ath","acr"], ability?, roll?: "attack", dc, vs?, advantage?: "larger"|true, onSuccess,
 *                 onFailure }  — the bearer (activity user) rolls; one check per target (`vs`, default the targets).
 *                 dc: a number, a formula on the bearer's data, with @target.* for the target's (8 + @target.abilities.
 *                 dex.mod + @target.prof), or "tether" (the escape DC of the tether on the bearer). advantage "larger":
 *                 advantage if bigger than the target, disadvantage if smaller (Overrun).
 *   passThrough { to }  — the bearer may move through these creatures until the end of its turn.
 *   place       { to, range, fromReach: true, fall: true }  — the bearer's player picks a free space for each creature:
 *                 within `range` ft of where it stands (and, with fromReach, within the bearer's reach). With fall,
 *                 landing lower than it stood deals 1d6 bludgeoning per 10 ft (max 20d6) and it lands Prone.
 *   release     { }  — the bearer lets go: its tethers on the targets (or all) end.
 *   escape      { skills: ["ath","acr"] }  — the bearer checks against the tether on it; success ends it.
 *   endEffect   { name?, status? , to? }  — remove matching effects from the creatures concerned.
 *   useReaction { }  — the bearer's reaction is spent (Ready).
 */

import * as Creatures from "./creatures.mjs";
import * as Economy from "./economy.mjs";
import * as Reactions from "./reactions.mjs";
import { rollSkillWith } from "./skills.mjs";
import { opt } from "./settings.mjs";

const MODULE_ID = "alivas-engine-of-triggers";
const INCAPACITATING = ["incapacitated", "paralyzed", "petrified", "stunned", "unconscious", "dead"];
/** Typical creature weights by size (no official 2024 weights) — override with flags.alivas-engine-of-triggers.weight. */
const SIZE_WEIGHT = { tiny: 8, sm: 35, med: 150, lg: 600, huge: 3000, grg: 12000 };

let deps = {};
/**
 * @param {object} d  { ACTIONS, announce, selectorContext, resolveFormula, runSteps, setting }
 */
export function initManeuvers(d) {
  deps = d;
  Object.assign(d.ACTIONS, MANEUVER_ACTIONS);
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

const sizeOf = actor => CONFIG.DND5E.actorSizes[actor?.system?.traits?.size]?.numerical ?? 2;
export const sizeDiff = (user, target) => sizeOf(target) - sizeOf(user);
const isIncapacitated = actor => INCAPACITATING.some(s => actor?.statuses?.has(s));
const tokenDoc = actor => Creatures.tokenFor(actor);

/** Does the actor have a hand free (2024: no two-handed weapon; not two things in hand)? */
export function hasFreeHand(actor) {
  if ( !opt("freeHandChecks") ) return true;   // world setting freeHandChecks (default on)
  // dnd5e "equipped" also means "carried ready", so weapons alone don't prove both hands are busy. No free hand: a
  // two-handed weapon, or a shield plus a weapon. Unarmed strikes and natural weapons never count.
  const held = actor.items.filter(i => (i.type === "weapon") && i.system.equipped && (i.system.type?.value !== "natural")
    && (i.system.identifier !== "unarmed-strike") && !/unarmed strike/i.test(i.name));
  const shield = actor.items.some(i => (i.type === "equipment") && i.system.equipped && (i.system.type?.value === "shield"));
  if ( held.some(w => w.system.properties?.has?.("two")) ) return false;
  return !(shield && held.length);
}

/** A creature's weight: the override flag, else its size's typical weight. */
export function weightOf(actor) {
  const own = Number(actor?.getFlag?.(MODULE_ID, "weight"));
  if ( own > 0 ) return own;
  return SIZE_WEIGHT[actor?.system?.traits?.size] ?? 150;
}

/** Remaining carrying capacity (2024: Strength × 15 lb by size, minus what's carried). */
export function remainingCapacity(actor) {
  const enc = actor?.system?.attributes?.encumbrance;
  if ( !enc ) return 0;
  return Math.max(0, Number(enc.max ?? 0) - Number(enc.value ?? 0));
}

/** The tether effects someone (holder) keeps on others, or a creature is held by. */
export function tethersBy(holder) {
  const uuid = tokenDoc(holder)?.uuid;
  if ( !uuid ) return [];
  return canvas.scene?.tokens.contents.flatMap(t => t.actor?.effects.filter(e => e.getFlag(MODULE_ID, "tether")?.source === uuid) ?? []) ?? [];
}
export const tethersOn = actor => actor?.effects.filter(e => e.getFlag(MODULE_ID, "tether")?.source) ?? [];
export const isGrappling = (user, target) => tethersOn(target).some(e => e.getFlag(MODULE_ID, "tether").source === tokenDoc(user)?.uuid);

/* -------------------------------------------- */
/*  Tether: stamp, end, drag                    */
/* -------------------------------------------- */

/**
 * Called when the engine applies an activity's effect to a target: a tether is stamped with its holder and DC.
 * @returns {object} the effect data, changed in place
 */
export function stampTether(data, activity) {
  const t = data?.flags?.[MODULE_ID]?.tether;
  if ( !t ) return data;
  const holder = tokenDoc(activity?.actor);
  t.source = holder?.uuid ?? null;
  t.dc ??= activity?.save?.dc?.value ?? activity?.actor?.system?.attributes?.spell?.dc ?? null;
  t.range ??= 5;
  return data;
}

async function endTether(effect, why) {
  if ( !effect?.parent?.effects?.get(effect.id) ) return;
  await effect.delete();
  if ( why ) await ChatMessage.implementation.create({ speaker: ChatMessage.implementation.getSpeaker({ actor: effect.parent }),
    content: `<p><strong>${foundry.utils.escapeHTML(effect.name)}</strong> ends — ${why}.</p>` });
}

/**
 * Check a creature's tethers a moment later: a hold applied mid-move (an Opportunity Attack Grapple) must be measured
 * after the interrupted move has settled, not against the destination the mover was heading for.
 */
const tetherTimers = new Map();
function checkTethers(actor) {
  if ( !actor || !Creatures.isLeadGM() ) return;
  const key = actor.uuid;
  clearTimeout(tetherTimers.get(key));
  tetherTimers.set(key, setTimeout(() => { tetherTimers.delete(key); checkTethersNow(actor); }, 800));
}

/** Check every tether a creature is part of (after moves and status changes). Lead GM. */
async function checkTethersNow(actor) {
  if ( !Creatures.isLeadGM() || !actor ) return;
  const effects = [...tethersOn(actor), ...tethersBy(actor)];
  for ( const e of effects ) {
    const t = e.getFlag(MODULE_ID, "tether");
    const holder = fromUuidSync(t.source)?.actor;
    if ( !holder ) { await endTether(e, "its holder is gone"); continue; }
    if ( isIncapacitated(holder) ) { await endTether(e, `${holder.name} is incapacitated`); continue; }
    const a = tokenDoc(holder), b = tokenDoc(e.parent);
    if ( a && b && (a.parent === b.parent) && (Creatures.distanceFt(a, b) > Number(t.range ?? 5)) ) {
      await endTether(e, `${e.parent.name} is out of ${holder.name}'s reach`);
    }
  }
}

/** Drag: when a holder moves, the creatures it holds (drag tethers) move by the same offset, if the space is free. */
/**
 * A holder moved (Foundry's moveToken: origin → destination, reported on every client): the creatures it holds with a
 * drag tether move by the same offset, if the space is free. Lead GM. Uses source positions, not the animated ones.
 */
async function dragAlong(tokenDocument, movement) {
  if ( !Creatures.isLeadGM() ) return;
  const from = movement?.origin, to = movement?.destination;
  if ( !from || !to ) return;
  const dx = to.x - from.x, dy = to.y - from.y;
  if ( !dx && !dy ) return;
  for ( const e of tethersBy(tokenDocument.actor).filter(e => e.getFlag(MODULE_ID, "tether")?.drag) ) {
    const held = tokenDoc(e.parent);
    if ( !held || (held.parent !== tokenDocument.parent) ) continue;
    const x = held._source.x + dx, y = held._source.y + dy;
    if ( Creatures.spaceFree(held, x, y) ) await Creatures.displaceToken(held, { x, y }, "drag");
  }
}

/** Movement cost while dragging: 1 extra foot per foot unless the held creature is Tiny or 2+ sizes smaller. */
function dragCostMultiplier(actor) {
  const heavy = tethersBy(actor).filter(e => e.getFlag(MODULE_ID, "tether")?.drag).some(e => {
    const held = e.parent;
    return (held.system?.traits?.size !== "tiny") && (sizeDiff(actor, held) > -2);
  });
  return heavy ? 2 : 1;
}

/* -------------------------------------------- */
/*  Activity requirements                       */
/* -------------------------------------------- */

/** Why an activity can't be used now (its `requires`), or null. */
export function unmetRequirement(activity, targets=[]) {
  const req = activity?.flags?.[MODULE_ID]?.requires;
  const user = activity?.actor;
  if ( !req || !user ) return null;
  if ( req.speed && !(Number(user.system.attributes?.movement?.walk) > 0) ) return `${user.name}'s Speed is 0`;
  if ( req.freeHand && !hasFreeHand(user) ) return `${user.name} needs a free hand`;
  if ( req.grappled && !tethersOn(user).length ) return `${user.name} isn't grappled`;
  for ( const t of targets ) {
    if ( Number.isFinite(req.maxSizeAbove) && (sizeDiff(user, t) > req.maxSizeAbove) ) return `${t.name} is too large`;
    if ( Number.isFinite(req.minSizeAbove) && (sizeDiff(user, t) < req.minSizeAbove) ) return `${t.name} isn't large enough`;
    if ( req.grappling && !isGrappling(user, t) ) return `${user.name} isn't grappling ${t.name}`;
    if ( req.canLift && (weightOf(t) > remainingCapacity(user)) ) return `${t.name} (${weightOf(t)} lb) is more than ${user.name} can lift now (${remainingCapacity(user)} lb free)`;
  }
  return null;
}

/* -------------------------------------------- */
/*  Actions                                     */
/* -------------------------------------------- */

const targetsOf = (a, effect, bearer, context, trigger) => a.vs || a.to
  ? Creatures.selectCreatures(bearer, a.vs ?? a.to, deps.selectorContext(effect, bearer, context, trigger))
  : Promise.resolve(context.targets?.length ? context.targets : (context.subject ? [context.subject] : []));

/** Roll a check for an actor: the best of `skills` (or an ability), with advantage/disadvantage. → { total } */
async function rollCheck(actor, { skills=[], ability=null, skillAbility=null, advantage=false, disadvantage=false, target=null }) {
  let skill = null;
  // With skillAbility, a skill's total is re-based from its own ability's modifier to that ability's.
  const score = s => (actor.system.skills?.[s]?.total ?? -99) + (skillAbility
    ? (actor.system.abilities?.[skillAbility]?.mod ?? 0) - (actor.system.abilities?.[actor.system.skills?.[s]?.ability]?.mod ?? 0) : 0);
  if ( skills.length ) skill = skills.reduce((best, s) => (score(s) > score(best) ? s : best), skills[0]);
  const config = { advantage, disadvantage, ...(target ? { target } : {}) };
  const rolls = skill && skillAbility ? await rollSkillWith(actor, skill, skillAbility, { advantage, disadvantage, target })
    : skill ? await actor.rollSkill({ skill, ...config }, { configure: false })
    : await actor.rollAbilityCheck({ ability: ability ?? "str", ...config }, { configure: false });
  return { total: rolls?.[0]?.total ?? null, skill };
}

/** An attack roll with the actor's best equipped melee weapon (no damage). → { total } */
async function rollWeaponAttack(actor, { advantage=false, disadvantage=false }={}) {
  const acts = actor.items.filter(i => (i.type === "weapon") && (i.system.equipped || i.system.type?.value === "natural"))
    .flatMap(i => [...(i.system.activities ?? [])].filter(a => (a.type === "attack") && (a.attack?.type?.value === "melee")));
  const best = acts.sort((x, y) => (Number(y.labels?.toHit?.replace?.(/[^0-9-]/g, "")) || 0) - (Number(x.labels?.toHit?.replace?.(/[^0-9-]/g, "")) || 0))[0];
  if ( !best ) return { total: null };
  // Not a real attack: the engine's hit / damage handling skips it (see isBareAttack).
  BARE.add(best.uuid);
  try {
    const rolls = await best.rollAttack({ advantage, disadvantage }, { configure: false }, {});
    return { total: rolls?.[0]?.total ?? null };
  } finally { setTimeout(() => BARE.delete(best.uuid), 1000); }
}
const BARE = new Set();
/** Is this attack roll only a maneuver's contest (no hit, damage or masteries)? */
export const isBareAttack = activity => BARE.has(activity?.uuid);

export const MANEUVER_ACTIONS = {
  /** A check with follow-up steps (see the header). */
  async check(trigger, effect, bearer, event, context={}) {
    const a = trigger.action;
    const label = trigger.label ?? effect.name;
    const versus = a.dc === "tether" ? [null] : await targetsOf(a, effect, bearer, context, trigger);
    let outcome = {};
    for ( const target of versus.length ? versus : [null] ) {
      const dc = a.dc === "tether"
        ? Number(tethersOn(bearer)[0]?.getFlag(MODULE_ID, "tether")?.dc)
        : deps.resolveFormula(a.dc, bearer, target);
      if ( !Number.isFinite(dc) ) continue;
      let adv = a.advantage === true, dis = false;
      if ( (a.advantage === "larger") && target ) { const d = sizeDiff(bearer, target); adv = d < 0; dis = d > 0; }
      // roll "attack": an attack roll with the bearer's best equipped melee weapon instead of a check (Disarm).
      const { total } = a.roll === "attack"
        ? await rollWeaponAttack(bearer, { advantage: adv, disadvantage: dis })
        : await rollCheck(bearer, { skills: a.skills ?? [], ability: a.ability, skillAbility: a.skillAbility, advantage: adv, disadvantage: dis, target: dc });
      if ( total === null ) continue;
      const success = total >= dc;
      await deps.announce(trigger, effect, bearer, event, `${bearer.name}: ${total} vs DC ${dc}${target ? ` (${target.name})` : ""} — ${success ? "success" : "failure"}.`);
      const steps = success ? a.onSuccess : a.onFailure;
      if ( steps?.length ) await deps.runSteps(steps, { label }, effect, bearer, event, { ...context, subject: target ?? context.subject, targets: target ? [target] : (context.targets ?? []) });
      outcome = { success };
    }
    return outcome;
  },

  /** The bearer may move through these creatures until its turn ends. */
  async passThrough(trigger, effect, bearer, event, context={}) {
    const others = await targetsOf(trigger.action, effect, bearer, context, trigger);
    const ids = others.map(o => tokenDoc(o)?.id).filter(Boolean);
    if ( !ids.length ) return {};
    await Creatures.giveEffect({ name: `Can pass through ${others.map(o => o.name).join(", ")}`, img: "icons/svg/door-exit.svg",
      duration: { value: 1, units: "turns", expiry: "turnEnd" }, flags: { [MODULE_ID]: { passThrough: ids } } }, [bearer], { replace: false });
    return {};
  },

  /** Move creatures to a space the bearer's player picks (Shove Aside, Hurl). */
  async place(trigger, effect, bearer, event, context={}) {
    const a = trigger.action;
    const movers = await targetsOf(a, effect, bearer, context, trigger);
    const user = Creatures.controllerOf(bearer);
    const from = tokenDoc(bearer);
    for ( const actor of movers ) {
      const token = tokenDoc(actor);
      if ( !token || !user ) continue;
      const range = Number(deps.resolveFormula(a.range ?? 5, bearer, actor)) || 5;
      const reach = a.fromReach ? 5 + (bearer.items.some(i => i.system.properties?.has?.("rch") && i.system.equipped) ? 5 : 0) : null;
      const before = token.elevation ?? 0;
      const result = await Creatures.runAs(user, "placeCreature", { tokenUuid: token.uuid, centerUuid: from?.uuid, range, reach,
        label: trigger.label ?? effect.name });
      if ( !result ) continue;
      await deps.announce(trigger, effect, bearer, event, `${actor.name} is moved ${result.feet} ft.`);
      if ( a.fall && (before > 0) ) {
        const feet = Math.min(200, before);
        const dice = Math.max(1, Math.floor(feet / 10));
        const roll = await new Roll(`${dice}d6`).evaluate();
        await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }), flavor: `${actor.name} falls ${feet} ft` });
        await actor.applyDamage([{ value: roll.total, type: "bludgeoning" }]);
        if ( roll.total > 0 ) await actor.toggleStatusEffect("prone", { active: true });
        await token.update({ elevation: 0 });
      }
    }
    return {};
  },

  /** The bearer lets go: its tethers on the targets (or all of them) end. */
  async release(trigger, effect, bearer, event, context={}) {
    const others = context.targets?.length ? context.targets : null;
    for ( const e of tethersBy(bearer) ) {
      if ( others && !others.some(o => o.uuid === e.parent.uuid) ) continue;
      await endTether(e, `${bearer.name} lets go`);
    }
    return {};
  },

  /** The bearer tries to break free: a check (best of skills) against the tether's DC. */
  async escape(trigger, effect, bearer, event, context={}) {
    const held = tethersOn(bearer);
    if ( !held.length ) return {};
    const e = held[0];
    const dc = Number(e.getFlag(MODULE_ID, "tether").dc) || 10;
    const { total } = await rollCheck(bearer, { skills: trigger.action.skills ?? ["ath", "acr"], target: dc });
    const success = (total ?? -1) >= dc;
    if ( success ) await endTether(e, `${bearer.name} breaks free (${total} vs DC ${dc})`);
    else await deps.announce(trigger, effect, bearer, event, `${bearer.name} fails to break free (${total} vs DC ${dc}).`);
    return { success };
  },

  /** The bearer uses its reaction (Ready: preparing an action spends the reaction it will be released with). */
  async useReaction(trigger, effect, bearer) {
    if ( Reactions.reactionUsed(bearer) ) return {};
    await Reactions.markReactionUsed(bearer);
    return {};
  },

  /** Remove effects by name or status from the creatures concerned (default the bearer). */
  async endEffect(trigger, effect, bearer, event, context={}) {
    const a = trigger.action;
    const who = a.to ? await targetsOf(a, effect, bearer, context, trigger) : [bearer];
    for ( const actor of who ) {
      const gone = actor.effects.filter(e => (a.name && e.name === a.name) || (a.status && e.statuses?.has(a.status))).map(e => e.id);
      if ( gone.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", gone);
    }
    return {};
  }
};

/* -------------------------------------------- */
/*  Placement handler (runs on the chooser's client) */
/* -------------------------------------------- */

/**
 * What TokenPlacement previews: the moved creature's prototype token when this user owns it; otherwise (a player moving
 * an enemy — Foundry only lets you place tokens you own) a stand-in built on the user's own creature (the holder, or
 * their character) with the moved token's size and image. Only the chosen position is used.
 */
function placementStandIn(token, center) {
  if ( token.actor?.isOwner ) return token.actor.prototypeToken;
  const own = (center?.actor?.isOwner ? center.actor : null) ?? game.user.character;
  if ( !own ) return token.actor?.prototypeToken ?? token;
  const data = foundry.utils.mergeObject(own.prototypeToken.toObject(), {
    width: token.width, height: token.height, texture: foundry.utils.deepClone(token._source.texture), name: token.name
  }, { inplace: false });
  return new foundry.data.PrototypeToken(data, { parent: own });
}

Creatures.HANDLERS.placeCreature = async function({ tokenUuid, centerUuid, range, reach, label }) {
  const token = fromUuidSync(tokenUuid);
  const center = centerUuid ? fromUuidSync(centerUuid) : null;
  const Placement = dnd5e.canvas?.TokenPlacement;
  if ( !token || !Placement || !canvas?.ready || (canvas.scene !== token.parent) ) return null;
  for ( let attempt = 0; attempt < 3; attempt++ ) {
    ui.notifications.info(`${label}: choose where ${token.name} ends up (within ${range} ft${reach ? `, and within ${reach} ft of you` : ""}).`);
    let placed;
    try { placed = await Placement.place({ tokens: [placementStandIn(token, center)] }); }
    catch(err) { console.warn(`${MODULE_ID} | placement`, err); return null; }
    const spot = placed?.[0];
    if ( !spot ) return null;
    const feet = Creatures.distanceFt(token, token, { x: spot.x, y: spot.y });
    const nearCenter = !reach || !center || (Creatures.distanceFt(center, token, { x: spot.x, y: spot.y }) <= reach);
    if ( (feet <= range) && nearCenter && Creatures.spaceFree(token, spot.x, spot.y) && (feet > 0) ) {
      await Creatures.displaceToken(token, { x: spot.x, y: spot.y }, "place");
      return { feet };
    }
    ui.notifications.warn(`${label}: ${feet > range ? `that's ${feet} ft away` : (!nearCenter ? "out of your reach" : "that space is occupied")} — try again.`);
  }
  return null;
};

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

export function registerManeuverHooks() {
  // Incapacitated creatures never block movement (2024).
  for ( const s of INCAPACITATING ) CONFIG.DND5E.neverBlockStatuses?.add?.(s);

  // An incapacitated creature's space is difficult terrain whoever it is (dnd5e skips allies' spaces in 2024 rules).
  Hooks.on("dnd5e.determineOccupiedGridSpaceDifficult", (gridSpace, token, options, found) => {
    if ( canvas.grid.isGridless ) return;
    const tl = canvas.grid.getTopLeftPoint(gridSpace);
    const rect = new PIXI.Rectangle(tl.x, tl.y, canvas.grid.sizeX, canvas.grid.sizeY);
    for ( const t of canvas.tokens.quadtree.getObjects(rect) ) {
      if ( (t === token) || t.document.hidden || !t.actor?.system?.isCreature ) continue;
      if ( isIncapacitated(t.actor) && (t.actor.system.traits?.size !== "tiny") ) found.add(t);
    }
  });

  // Pass-through permissions.
  Hooks.on("dnd5e.determineOccupiedGridSpaceBlocking", (gridSpace, token, options, found) => {
    const allowed = new Set((token.actor?.effects?.contents ?? []).flatMap(e => e.getFlag(MODULE_ID, "passThrough") ?? []));
    if ( !allowed.size ) return;
    for ( const t of [...found] ) if ( allowed.has(t.document?.id ?? t.id) ) found.delete(t);
  });
  // Alliances on: creatures of the mover's own alliance never block it (dnd5e decides blocking by disposition).
  Hooks.on("dnd5e.determineOccupiedGridSpaceBlocking", (gridSpace, token, options, found) => {
    if ( !found.size || !token?.actor || !Creatures.alliancesOn() ) return;
    const own = Creatures.allianceLetter(token.actor, token.document?.parent);
    if ( !own ) return;
    for ( const t of [...found] ) if ( t.actor && (Creatures.allianceLetter(t.actor, t.document?.parent) === own) ) found.delete(t);
  });
  // Blocked by hostile creatures on a real move (not a ruler preview): offer Tumble / Overrun.
  Hooks.on("dnd5e.determineOccupiedGridSpaceBlocking", (gridSpace, token, options, found) => {
    if ( options?.preview || !found.size || !token?.actor ) return;
    // Hostile: by alliance when on (a creature with a letter other than the mover's), else by disposition.
    const mine = Creatures.alliancesOn() ? Creatures.allianceLetter(token.actor, token.document?.parent) : null;
    const hostile = [...found].filter(t => (mine !== null)
      ? (() => { const theirs = Creatures.allianceLetter(t.actor, t.document?.parent); return !!theirs && (theirs !== mine); })()
      : ((t.document.disposition !== token.document.disposition)
        && (t.document.disposition !== CONST.TOKEN_DISPOSITIONS.NEUTRAL || token.document.disposition === CONST.TOKEN_DISPOSITIONS.NEUTRAL)));
    if ( hostile.length ) offerWhenBlocked(token, hostile);
  });

  // Drag: held creatures follow their holder's move, then every tether is re-measured.
  Hooks.on("moveToken", (doc, movement) => {
    dragAlong(doc, movement).then(() => checkTethers(doc.actor));
  });
  Hooks.on("updateToken", (doc, change) => {
    if ( ("x" in change) || ("y" in change) ) checkTethers(doc.actor);
  });
  // Statuses changing (Incapacitated) can end tethers.
  const onEffect = effect => { if ( effect.parent?.documentName === "Actor" ) checkTethers(effect.parent); };
  Hooks.on("createActiveEffect", onEffect);
  Hooks.on("updateActiveEffect", onEffect);

  // Requirements before an activity is used.
  Hooks.on("dnd5e.preUseActivity", activity => {
    const targets = [...game.user.targets].map(t => t.actor).filter(Boolean);
    const why = unmetRequirement(activity, targets);
    if ( !why ) return;
    ui.notifications.warn(`${activity.item?.name ?? activity.name}: ${why}.`);
    return false;
  });
}

/* -------------------------------------------- */
/*  Bonus actions and "blocked" offers          */
/* -------------------------------------------- */

/** Has the actor used its bonus action this combat turn? (economy.mjs tracks it from activities' activation.) */
export function bonusActionUsed(actor) {
  return Economy.inCombat(actor) && Economy.used(actor, "bonus");
}

/**
 * When a hostile creature blocks a creature's move (dnd5e movement automation), its player is offered the activities
 * flagged `offerWhenBlocked` (Tumble, Overrun) that it can use now: a bonus-action one only if the bonus action is
 * unused this turn (in combat). Used against the blocking creature; on success it may move through, and moves again.
 */
const offered = new Map();   // token id → time offered (debounce)
async function offerWhenBlocked(token, blockers) {
  const actor = token.actor;
  if ( !opt("blockedOffers") || !actor?.isOwner || !blockers.length ) return;
  if ( Date.now() - (offered.get(token.id) ?? 0) < 4000 ) return;
  const choices = actor.items.contents.flatMap(i => [...(i.system.activities ?? [])]
    .filter(a => a.flags?.[MODULE_ID]?.offerWhenBlocked)
    .filter(a => (a.activation?.type !== "bonus") || !bonusActionUsed(actor)));
  if ( !choices.length ) return;
  offered.set(token.id, Date.now());
  const names = blockers.map(b => b.name).join(", ");
  const pick = await foundry.applications.api.DialogV2.wait({
    window: { title: `${actor.name} — blocked` }, rejectClose: false,
    content: `<p><strong>${foundry.utils.escapeHTML(names)}</strong> blocks your way.</p>`,
    buttons: [...choices.map(a => ({ action: a.uuid, label: `${a.name || a.item.name}${a.activation?.type === "bonus" ? " (Bonus Action)" : ""}` })),
      { action: "no", label: "Stay put", default: true }]
  });
  if ( !pick || (pick === "no") ) return;
  const activity = fromUuidSync(pick);
  for ( const t of [...game.user.targets] ) t.setTarget(false, { releaseOthers: false });
  for ( const b of blockers ) b.setTarget(true, { releaseOthers: false });
  await activity?.use({}, { configure: false }, {});
  if ( (actor.effects?.contents ?? []).some(e => (e.getFlag(MODULE_ID, "passThrough") ?? []).some(id => blockers.some(b => b.document.id === id))) ) {
    ui.notifications.info(`${actor.name} can move through ${names} this turn — move again.`);
  }
}

/** Wrap token movement cost for dragging. Call in "setup". */
export function patchMovementCost() {
  const proto = CONFIG.Token.objectClass.prototype;
  const original = proto._getMovementCostFunction;
  if ( typeof original !== "function" ) return;
  proto._getMovementCostFunction = function(options) {
    const base = original.call(this, options);
    const mult = dragCostMultiplier(this.actor);
    if ( mult === 1 ) return base;
    return (from, to, distance, segment) => base(from, to, distance, segment) * mult;
  };
}
