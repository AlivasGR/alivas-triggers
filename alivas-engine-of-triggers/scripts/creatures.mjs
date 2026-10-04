/**
 * Alivas's Engine of Triggers — creatures: finding, seeing, choosing, and giving effects.
 *
 * Reusable building blocks for triggers and reactions:
 *   tokenFor(actor, scene)            the actor's token (prefers the given scene)
 *   distanceFt(tokenA, tokenB)        5e distance, edge to edge
 *   canSee(viewerToken, targetToken)  Foundry vision from the viewer's point of view
 *   relation(a, b, scene)             "self" | "ally" | "enemy" | "neutral" (the factions table, else token dispositions)
 *   findCreatures(from, spec, ctx)    creatures matching a spec (range, sight, side…)
 *   pickCreature(chooser, actors)     "choose a creature" popup for whoever controls the chooser; waits for the answer
 *   selectCreatures(chooser, sel, ctx)   a SELECTOR → the creatures it means (may ask the chooser)
 *   giveEffect(data, recipients)      put an effect on creatures (via the GM when not owned), replacing earlier copies
 *   removeStatuses(chooser, actors, ids, {choose})   end conditions (the chooser picks one when several apply)
 *   setInspiration(actors)            give Heroic Inspiration
 *   swapInitiative(a, b)              swap two creatures' initiative in their combat
 *   lowestSlot(activity)              lowest spell slot that can cast a spell activity
 *   controllerOf(actor)               its connected player, else the active GM
 *   runAs(user, handler, payload)     run a registered handler on that user's client and return its result
 *
 * SELECTOR
 *   {
 *     who:        "choose" | "all" | "self" | "bearer" | "source" | "subject" | "targets",
 *                   choose  — the chooser picks one (or up to `count`) of the matching creatures, or no one
 *                   targets — the targets of the triggering activity (all of them, or pick with pool: "targets")
 *                   all     — every matching creature
 *                   self    — the chooser (the reactor / the bearer)
 *                   bearer / source / subject — that creature from the context
 *     range:      60,        feet from the chooser (empty = any distance)
 *     sight:      true,      only creatures the chooser can see
 *     side:       "any" | "ally" | "enemy" | "notAlly",   relative to the chooser (allies include itself; notAlly =
 *                 enemies and neutrals). Also filters who: "targets".
 *     by:         "source",  (triggers) the effect's source chooses and measures range, not the bearer
 *     self:       true,      may include the chooser (default true)
 *     notSubject: true,      never the triggering creature
 *     count:      1,         choose up to this many (number or formula, e.g. "@prof", on the chooser's data)
 *     pool:       "nearby" | "targets" | "combat",   where candidates come from (default nearby on the scene)
 *     able:       true,      not Incapacitated
 *     actorType:  "character"  only this actor type (e.g. player characters)
 *     grappledBy: true,      only creatures the chooser is grappling (a tether of the chooser's on them, maneuvers.mjs)
 *   }
 */

const MODULE_ID = "alivas-engine-of-triggers";
const SOCKET = `module.${MODULE_ID}`;

/* -------------------------------------------- */
/*  Items: bonds and filter data                */
/* -------------------------------------------- */

/** The bond flag of an active enchantment (see main.mjs "Bonds"), or null. */
export const bondOf = effect => (effect?.type === "enchantment") && !effect.disabled ? (effect.getFlag?.(MODULE_ID, "bond") ?? null) : null;

/** The bond ids an item currently carries (e.g. ["pact-of-the-blade"]). */
export function bondsOf(item) {
  return (item?.effects ?? []).map(e => bondOf(e)?.id).filter(Boolean);
}

/** Filter data for an item: identifier, name, type, bonds, properties. */
export function itemFilterData(item) {
  if ( !item ) return {};
  return { identifier: item.system?.identifier ?? "", name: item.name, type: item.type, bonds: bondsOf(item),
    properties: [...(item.system?.properties ?? [])] };
}

/* -------------------------------------------- */
/*  Geometry and vision                         */
/* -------------------------------------------- */

/** A token document for an actor, preferring one on the given scene. */
export function tokenFor(actor, scene) {
  if ( !actor ) return null;
  if ( actor.token ) return actor.token;
  // The given scene, the one this window shows, the active one — then any scene (a GM window may be looking elsewhere).
  const find = s => s?.tokens.find(t => t.actorId === actor.id) ?? null;
  for ( const s of [scene, canvas?.scene, game.scenes.active] ) {
    const t = find(s);
    if ( t ) return t;
  }
  const combatScene = game.combats.find(c => c.started && c.scene && c.combatants.some(cb => cb.actorId === actor.id))?.scene;
  return find(combatScene) ?? game.scenes.contents.map(find).find(Boolean) ?? null;
}

/**
 * Distance in feet between two tokens, 5e-style: edge to edge, a diagonal counts as one square.
 * @param {TokenDocument} a
 * @param {TokenDocument} b
 * @param {{x:number, y:number}} [posA]  Use this position for a instead of its current one.
 */
export function distanceFt(a, b, posA) {
  if ( !a || !b || (a.parent !== b.parent) ) return Infinity;
  const grid = a.parent.grid;
  // Use the stored position: in v14 a token's x/y can lag behind while its movement is still animating.
  const ax = posA?.x ?? a._source.x, ay = posA?.y ?? a._source.y;
  const bx = b._source.x, by = b._source.y;
  const aw = a.width * grid.size, ah = a.height * grid.size;
  const bw = b.width * grid.size, bh = b.height * grid.size;
  const gapX = Math.max(0, Math.max(ax, bx) - Math.min(ax + aw, bx + bw));
  const gapY = Math.max(0, Math.max(ay, by) - Math.min(ay + ah, by + bh));
  return (Math.round(Math.max(gapX, gapY) / grid.size) + 1) * grid.distance;
}

/**
 * Can the viewer's token see the target's token? Uses Foundry's own vision from the viewer's point of view: walls,
 * light, the token's detection modes (darkvision, blindsight, see invisibility…), Invisible / Blinded.
 * Falls back to "yes" when it can't be worked out here (scene without token vision, a token without sight, or not
 * the scene this window is showing), so nothing is silently lost.
 * @param {TokenDocument} viewerDoc
 * @param {TokenDocument} targetDoc
 */
export function canSee(viewerDoc, targetDoc) {
  if ( !viewerDoc || !targetDoc || (viewerDoc === targetDoc) ) return true;
  const scene = viewerDoc.parent;
  if ( (scene !== targetDoc.parent) || !canvas?.ready || (canvas.scene !== scene) || !scene.tokenVision ) return true;
  const viewer = viewerDoc.object;
  const target = targetDoc.object;
  if ( !viewer || !target || !viewerDoc.sight?.enabled ) return true;
  let source;
  try {
    source = new CONFIG.Canvas.visionSourceClass({ sourceId: `${MODULE_ID}.sight.${viewer.id}`, object: viewer });
    source.initialize(viewer._getVisionSourceData());
    const r = ((targetDoc.width * canvas.grid.size) / 2) * 0.9;
    const c = target.center;
    const points = [c, { x: c.x - r, y: c.y }, { x: c.x + r, y: c.y }, { x: c.x, y: c.y - r }, { x: c.x, y: c.y + r }];
    const config = canvas.visibility._createVisibilityTestConfig(points, { tolerance: 0, object: target });
    for ( const [id, mode] of Object.entries(viewerDoc.detectionModes ?? {}) ) {
      if ( !mode?.enabled ) continue;
      if ( CONFIG.Canvas.detectionModes[id]?.testVisibility(source, { id, ...mode }, config) ) return true;
    }
    return false;
  } catch(err) {
    console.warn(`${MODULE_ID} | Could not test sight from ${viewerDoc.name} to ${targetDoc.name}`, err);
    return true;
  } finally {
    source?.destroy?.();
  }
}

/** Set by factions.mjs: { enabled(), relation(a, b, scene), allianceOf(actor, scene) (its faction letter) }. */
let alliances = null;
export const setAllianceResolver = api => { alliances = api; };
/** Are factions deciding sides right now (setting "factions")? */
export const alliancesOn = () => !!alliances?.enabled();
/** A creature's faction letter ("" for none), when factions are on. */
export const allianceLetter = (actor, scene) => alliances?.allianceOf(actor, scene) ?? "";

/**
 * How b stands relative to a: from the scene's factions table when that setting is on, else from token dispositions.
 * @returns {"self"|"ally"|"enemy"|"neutral"}
 */
export function relation(a, b, scene) {
  if ( a && b && (a.uuid === b.uuid) ) return "self";
  // Factions (factions.mjs, setting "factions"): when on, the scene's relations table decides; otherwise dispositions.
  if ( alliancesOn() ) return alliances.relation(a, b, scene);
  const da = tokenFor(a, scene)?.disposition;
  const db = tokenFor(b, scene)?.disposition;
  const { FRIENDLY, HOSTILE } = CONST.TOKEN_DISPOSITIONS;
  if ( ((da === FRIENDLY) && (db === HOSTILE)) || ((da === HOSTILE) && (db === FRIENDLY)) ) return "enemy";
  if ( (da !== undefined) && (da === db) && (da !== CONST.TOKEN_DISPOSITIONS.NEUTRAL) ) return "ally";
  return "neutral";
}

/* -------------------------------------------- */
/*  Finding and choosing                        */
/* -------------------------------------------- */

/**
 * Creatures on the chooser's scene matching a spec, nearest first (the chooser itself first).
 * @param {Actor5e} from
 * @param {object} spec      See SELECTOR: range, sight, side, self, notSubject.
 * @param {object} [ctx]     { subject, scene }
 * @returns {Actor5e[]}
 */
export function findCreatures(from, spec={}, ctx={}) {
  const origin = tokenFor(from, ctx.scene);
  const scene = origin?.parent ?? ctx.scene;
  let tokens = scene?.tokens.contents ?? [];
  if ( spec.pool === "targets" ) tokens = (ctx.targets ?? []).map(a => tokenFor(a, scene)).filter(Boolean);
  else if ( spec.pool === "combat" ) {
    const combat = game.combats.find(c => c.combatants.some(cb => cb.actor?.uuid === from?.uuid));
    tokens = combat ? combat.combatants.map(cb => cb.token).filter(Boolean) : [];
  }
  const seen = new Set();
  const found = [];
  for ( const t of tokens ) {
    const actor = t.actor;
    if ( !actor || seen.has(actor.uuid) || t.hidden || actor.statuses?.has("dead") ) continue;
    // Only creatures: not loot piles (Item Piles), vehicles or groups.
    if ( (actor.system?.isCreature === false) || actor.flags?.["item-piles"]?.data?.enabled ) continue;
    if ( spec.able && actor.statuses?.has("incapacitated") ) continue;
    if ( spec.actorType && (actor.type !== spec.actorType) ) continue;
    if ( spec.grappledBy && !actor.effects.some(e => origin && (e.getFlag(MODULE_ID, "tether")?.source === origin.uuid)) ) continue;
    const isSelf = actor.uuid === from?.uuid;
    if ( isSelf && (spec.self === false) ) continue;
    if ( spec.notSubject && ctx.subject && (actor.uuid === ctx.subject.uuid) ) continue;
    const rel = relation(from, actor, scene);
    if ( !sideMatches(spec.side, rel) ) continue;
    const center = (spec.from === "subject") && ctx.subject ? (tokenFor(ctx.subject, scene) ?? origin) : origin;
    const distance = isSelf ? 0 : (center ? distanceFt(center, t) : 0);
    if ( !isSelf && spec.range && (distance > Number(spec.range)) ) continue;
    if ( !isSelf && spec.sight && !canSee(origin, t) ) continue;
    seen.add(actor.uuid);
    found.push({ actor, distance: isSelf ? -1 : distance });
  }
  return found.sort((a, b) => a.distance - b.distance).map(f => f.actor);
}

/** Does a relation ("self" | "ally" | "enemy" | "neutral") fit a selector side ("any" | "ally" | "enemy" | "notAlly")? */
/** A relation ("self" | "ally" | "enemy" | "neutral") → a picker chip ("ally" | "neutral" | "hostile"). */
const RELATION_CHIP = { self: "ally", ally: "ally", neutral: "neutral", enemy: "hostile" };
/** Chips shown at first for a selector side. */
const SIDE_CHIPS = { ally: ["ally"], enemy: ["hostile"], notAlly: ["neutral", "hostile"] };
const hostileSide = side => ["enemy", "notAlly"].includes(side);

/** The creatures that have charmed this actor (the sources of its Charmed effects): never its hostile picks. */
export function charmersOf(actor) {
  const out = new Set();
  for ( const effect of actor?.appliedEffects ?? [] ) {
    if ( !effect.statuses?.has("charmed") ) continue;
    const source = effect.getSourceActor?.();
    if ( source && (source.uuid !== actor.uuid) ) out.add(source.uuid);
  }
  return out;
}

function sideMatches(side, rel) {
  if ( side === "ally" ) return ["self", "ally"].includes(rel);
  if ( side === "enemy" ) return rel === "enemy";
  if ( side === "notAlly" ) return !["self", "ally"].includes(rel);
  return true;
}

/** Who answers for this creature: its connected player, otherwise the active GM. */
export function controllerOf(actor) {
  return game.users.find(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER")) ?? game.users.activeGM;
}

/**
 * Ask whoever controls the chooser to pick one creature from a list.
 * @param {Actor5e} chooser
 * @param {Actor5e[]} actors
 * @param {object} [options]
 * @param {string} [options.title]
 * @param {string} [options.prompt]    HTML above the buttons.
 * @param {boolean} [options.allowNone=true]
 * @returns {Promise<Actor5e|null>}
 */
export async function pickCreature(chooser, actors, { title, prompt="", allowNone=true }={}) {
  return (await pickCreatures(chooser, actors, { title, prompt, allowNone, count: 1 }))[0] ?? null;
}

/**
 * Ask whoever controls the chooser to pick up to `count` creatures from a list.
 * @returns {Promise<Actor5e[]>}
 */
export async function pickCreatures(chooser, actors, { title, prompt="", allowNone=true, count=1, rels=null, chips=null }={}) {
  if ( !actors.length ) return [];
  const user = controllerOf(chooser);
  if ( !user ) return [];
  const payload = {
    title: title ?? `${chooser.name} — choose ${count > 1 ? `up to ${count} creatures` : "a creature"}`, prompt, allowNone, count,
    choices: actors.map((a, i) => ({ uuid: a.uuid, name: a.uuid === chooser.uuid ? `${a.name} (yourself)` : (tokenFor(a)?.name ?? a.name),
      rel: rels?.[i] ?? null })),
    chips
  };
  const result = await runAs(user, count > 1 ? "pickCreatures" : "pickCreature", payload);
  const uuids = Array.isArray(result) ? result : (result ? [result] : []);
  return uuids.map(u => fromUuidSync(u)).filter(Boolean);
}

/** Evaluate a selector's count ("@prof", 3…) on the chooser's data. */
function selectorCount(selector, chooser) {
  if ( !selector.count ) return 1;
  const formula = CONFIG.Dice.BasicRoll.replaceFormulaData(String(selector.count), chooser?.getRollData?.() ?? {}, { missing: 0 });
  try {
    return Math.max(1, Math.floor(new Roll(formula).evaluateSync({ strict: false }).total) || 1);
  } catch(err) {
    return 1;
  }
}

/**
 * Resolve a SELECTOR to creatures.
 * @param {Actor5e} chooser   The reactor, or the bearer of a trigger.
 * @param {object} selector
 * @param {object} [ctx]      { subject, bearer, source, scene, title, prompt }
 * @returns {Promise<Actor5e[]>}
 */
export async function selectCreatures(chooser, selector={}, ctx={}) {
  // by "source": the effect's source chooses (and ranges are measured from it) — Vow of Enmity moving on.
  if ( (selector.by === "source") && ctx.source ) chooser = ctx.source;
  switch ( selector.who ?? "choose" ) {
    case "self": return chooser ? [chooser] : [];
    case "bearer": return ctx.bearer ? [ctx.bearer] : [];
    case "source": return ctx.source ? [ctx.source] : [];
    case "subject": return ctx.subject ? [ctx.subject] : [];
    case "targets": return (ctx.targets ?? []).filter(a => a && (!selector.side || sideMatches(selector.side, relation(chooser, a))));
    case "all": return findCreatures(chooser, selector, ctx);
    default: {
      // Everyone in range, tagged by how the chooser regards them. The picker shows colour chips (ally / neutral /
      // hostile) preset from the selector's side; the chooser can switch others on — Bless an enemy, Bane an ally.
      const charmers = hostileSide(selector.side) ? charmersOf(chooser) : new Set();
      const all = findCreatures(chooser, { ...selector, side: "any" }, ctx).filter(a => !charmers.has(a.uuid));
      const rels = all.map(a => RELATION_CHIP[relation(chooser, a, ctx.scene)] ?? "neutral");
      const chips = SIDE_CHIPS[selector.side] ?? ["ally", "neutral", "hostile"];
      if ( !rels.some(r => chips.includes(r)) ) return [];
      return pickCreatures(chooser, all, { title: ctx.title, prompt: ctx.prompt, count: selectorCount(selector, chooser), rels, chips });
    }
  }
}

/** Plain-language description of a SELECTOR, e.g. "a creature you choose within 60 ft that you can see". */
export function describeSelector(selector={}, { you="you", bearerWord="the bearer" }={}) {
  if ( selector.by === "source" ) you = "the source";
  const side = { ally: "ally", enemy: "enemy", notAlly: "non-ally" }[selector.side] ?? "creature";
  const within = selector.range ? ` within ${selector.range} ft${selector.from === "subject" ? " of the triggering creature" : ""}` : "";
  const seeing = selector.sight ? ` that ${you} can see` : "";
  const notSubject = (selector.notSubject ? " (not the triggering creature)" : "")
    + (selector.grappledBy ? ` that ${you} ${you === "you" ? "are" : "is"} grappling` : "");
  const pool = selector.pool === "targets" ? " among the targets" : selector.pool === "combat" ? " in the combat" : "";
  switch ( selector.who ?? "choose" ) {
    case "self": return you;
    case "bearer": return bearerWord;
    case "source": return "the source";
    case "subject": return "the triggering creature";
    case "targets": return selector.side && (selector.side !== "any") ? `the targets that are ${{ ally: "allies", enemy: "enemies", notAlly: "not allies" }[selector.side]}` : "the targets";
    case "all": return `every ${side}${pool}${within}${seeing}${notSubject}`;
    default: {
      const n = selector.count && (String(selector.count) !== "1") ? `up to ${selector.count === "@prof" ? "your proficiency bonus in" : selector.count} ${side === "ally" ? "allies" : side === "enemy" ? "enemies" : "creatures"}` : `${/^[aeiou]/.test(side) ? "an" : "a"} ${side}`;
      return `${n}${pool} ${you} choose${you === "you" ? "" : "s"}${within}${seeing}${notSubject}`;
    }
  }
}

/* -------------------------------------------- */
/*  Effects and spell slots                     */
/* -------------------------------------------- */

/**
 * Give copies of an effect to creatures. Owned creatures are updated here; others through the active GM.
 * @param {object} data            ActiveEffect data (no _id needed).
 * @param {Actor5e[]} recipients
 * @param {object} [options]
 * @param {boolean} [options.replace=true]  Remove an earlier copy with the same name given this way.
 */
export async function giveEffect(data, recipients, { replace=true }={}) {
  const effect = foundry.utils.deepClone(data);
  delete effect._id;
  Object.assign(effect, { transfer: false, disabled: false });
  foundry.utils.setProperty(effect, `flags.${MODULE_ID}.given`, true);
  for ( const actor of recipients ) {
    if ( actor.isOwner ) await placeEffect(actor, effect, replace);
    else game.socket.emit(SOCKET, { type: "placeEffect", actorUuid: actor.uuid, data: effect, replace });
  }
}

async function placeEffect(actor, data, replace) {
  if ( replace ) {
    const old = actor.effects.filter(e => (e.name === data.name) && e.getFlag(MODULE_ID, "given")).map(e => e.id);
    if ( old.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", old);
  }
  await actor.createEmbeddedDocuments("ActiveEffect", [data]);
}

/**
 * End conditions on creatures. With `choose`, when a creature has several of them, the chooser picks one to end.
 * @param {Actor5e} chooser
 * @param {Actor5e[]} actors
 * @param {string[]} ids      Status ids, e.g. ["blinded", "deafened", "paralyzed", "poisoned"].
 * @param {object} [options]
 * @param {boolean} [options.choose=false]  End only one per creature.
 * @returns {Promise<string[]>}  "Name: Condition" for each condition ended.
 */
export async function removeStatuses(chooser, actors, ids, { choose=false }={}) {
  const ended = [];
  for ( const actor of actors ) {
    let present = ids.filter(id => actor.statuses?.has(id));
    if ( !present.length ) continue;
    if ( choose && (present.length > 1) ) {
      const user = controllerOf(chooser);
      const pick = user ? await runAs(user, "pickOption", {
        title: `End a condition on ${actor.name}`, prompt: `<p>Which condition ends on <strong>${actor.name}</strong>?</p>`,
        options: present.map(id => ({ value: id, label: statusName(id) }))
      }) : null;
      present = pick ? [pick] : [];
    } else if ( choose ) present = present.slice(0, 1);
    for ( const id of present ) {
      // A condition Foundry knows is toggled off; a custom one ("tangled", "protective-lights") ends with its effects.
      if ( CONFIG.statusEffects.some(s => s.id === id) ) {
        if ( actor.isOwner ) await actor.toggleStatusEffect(id, { active: false });
        else game.socket.emit(SOCKET, { type: "toggleStatus", actorUuid: actor.uuid, id, active: false });
      } else {
        const ids = actor.effects.filter(e => e.statuses?.has(id)).map(e => e.id);
        if ( actor.isOwner ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
        else game.socket.emit(SOCKET, { type: "deleteEffects", actorUuid: actor.uuid, ids });
      }
      ended.push(`${actor.name}: ${statusName(id)}`);
    }
  }
  return ended;
}

const statusName = id => game.i18n.localize(CONFIG.statusEffects.find(s => s.id === id)?.name ?? id.replace(/-/g, " "));

/** Give creatures Heroic Inspiration. */
export async function setInspiration(actors) {
  for ( const actor of actors ) {
    if ( actor.system.attributes?.inspiration === undefined ) continue;   // NPCs have no Heroic Inspiration
    if ( actor.isOwner ) await actor.update({ "system.attributes.inspiration": true });
    else game.socket.emit(SOCKET, { type: "updateActor", actorUuid: actor.uuid, update: { "system.attributes.inspiration": true } });
  }
}

/** Swap two creatures' initiative in the combat they share. */
export async function swapInitiative(a, b) {
  const combat = game.combats.find(c => c.combatants.some(cb => cb.actor?.uuid === a.uuid)
    && c.combatants.some(cb => cb.actor?.uuid === b.uuid));
  if ( !combat ) return false;
  const ca = combat.combatants.find(cb => cb.actor?.uuid === a.uuid);
  const cb = combat.combatants.find(x => x.actor?.uuid === b.uuid);
  const updates = [{ _id: ca.id, initiative: cb.initiative }, { _id: cb.id, initiative: ca.initiative }];
  if ( combat.isOwner && ca.isOwner && cb.isOwner ) await combat.updateEmbeddedDocuments("Combatant", updates);
  else game.socket.emit(SOCKET, { type: "updateCombatants", combatId: combat.id, updates });
  return true;
}

/**
 * Turn an actor's token light on or off. The light it had before is remembered and restored.
 * @param {Actor5e} actor
 * @param {{bright: number, dim: number, color?: string, animation?: string}} light
 * @returns {Promise<boolean|null>}  true = now on, false = now off, null = no token
 */
export async function toggleLight(actor, light) {
  const tokens = actor.getActiveTokens?.(false, true) ?? [];
  if ( !tokens.length ) return null;
  let on = null;
  for ( const token of tokens ) {
    const saved = token.getFlag(MODULE_ID, "savedLight");
    if ( saved ) {
      await token.update({ light: saved, [`flags.${MODULE_ID}.-=savedLight`]: null });
      on = false;
    } else {
      await token.update({
        [`flags.${MODULE_ID}.savedLight`]: token.toObject().light,
        light: { bright: light.bright, dim: light.dim, color: light.color ?? null, alpha: 0.4,
          animation: { type: light.animation ?? "flame", speed: 3, intensity: 3 } }
      });
      on = true;
    }
  }
  return on;
}

/**
 * Set an actor's token light (light) or put back the light it had before (null) — for effects whose light lasts exactly
 * as long as they do (effect rule `light`).
 * @param {Actor5e} actor
 * @param {{bright: number, dim: number, color?: string, animation?: string}|null} light
 */
export async function setLight(actor, light) {
  const tokens = actor.token ? [actor.token] : game.scenes.contents.flatMap(s => s.tokens.filter(t => t.actorLink && (t.actorId === actor.id)));
  for ( const token of tokens ) {
    const saved = token.getFlag(MODULE_ID, "savedLight");
    if ( light ) {
      const update = { light: { bright: Number(light.bright) || 0, dim: Number(light.dim) || 0, color: light.color ?? null, alpha: 0.4,
        animation: { type: light.animation ?? "flame", speed: 3, intensity: 3 } } };
      if ( !saved ) update[`flags.${MODULE_ID}.savedLight`] = token.toObject().light;
      await moveOrUpdate(token, update);
    } else if ( saved ) await moveOrUpdate(token, { light: saved, [`flags.${MODULE_ID}.-=savedLight`]: null });
  }
}

/** Update a token here, or through the lead GM if this user can't. */
async function moveOrUpdate(token, update) {
  if ( token.isOwner ) return token.update(update);
  game.socket.emit(SOCKET, { type: "updateToken", uuid: token.uuid, update });
}

/** Move a token straight to a point (forced movement / teleport: no movement cost), here or through the lead GM. */
export async function displaceToken(token, { x, y }, kind="move") {
  // Forced movement and teleports, announced where they start (e.g. for animations): alivasTriggers.move.
  if ( kind !== "relay" ) Hooks.callAll("alivasTriggers.move", { token, from: { x: token.x, y: token.y }, to: { x, y }, kind });
  if ( !token.isOwner ) return game.socket.emit(SOCKET, { type: "displaceToken", uuid: token.uuid, x, y });
  if ( typeof token.move === "function" ) return token.move([{ x, y, action: "displace" }], { autoRotate: false });
  return token.update({ x, y }, { teleport: true });
}

/** Is a grid space free of other creatures' tokens? */
export function spaceFree(token, x, y) {
  const size = token.parent.grid.size;
  const w = token.width * size, h = token.height * size;
  return !token.parent.tokens.some(t => (t.id !== token.id) && t.actor && !t.hidden
    && (x < t._source.x + (t.width * size)) && (t._source.x < x + w) && (y < t._source.y + (t.height * size)) && (t._source.y < y + h));
}

/**
 * Push (or pull, with negative feet) a creature in a straight line away from another, square by square, stopping before
 * a wall or another creature. Returns the feet actually moved.
 * @param {Actor5e} from
 * @param {Actor5e} target
 * @param {number} feet
 */
export async function pushCreature(from, target, feet) {
  const a = tokenFor(from), b = tokenFor(target, a?.parent);
  if ( !a || !b || (a.parent !== b.parent) || !feet ) return 0;
  const scene = b.parent;
  const size = scene.grid.size;
  const centre = t => ({ x: t._source.x + (t.width * size / 2), y: t._source.y + (t.height * size / 2) });
  const ca = centre(a), cb = centre(b);
  let dx = cb.x - ca.x, dy = cb.y - ca.y;
  if ( !dx && !dy ) return 0;
  if ( feet < 0 ) { dx = -dx; dy = -dy; }
  // Step one square at a time along the nearest of the 8 grid directions.
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const sx = Math.round(Math.cos(angle)), sy = Math.round(Math.sin(angle));
  const steps = Math.floor(Math.abs(feet) / scene.grid.distance);
  let pos = { x: b._source.x, y: b._source.y };
  let moved = 0;
  const collides = (p, q) => {
    const backend = CONFIG.Canvas.polygonBackends?.move;
    if ( !backend || (canvas?.scene !== scene) ) return false;
    const off = { x: b.width * size / 2, y: b.height * size / 2 };
    return backend.testCollision({ x: p.x + off.x, y: p.y + off.y }, { x: q.x + off.x, y: q.y + off.y }, { type: "move", mode: "any" });
  };
  const rect = scene.dimensions?.sceneRect;
  const inside = p => !rect || ((p.x >= rect.x) && (p.y >= rect.y) && (p.x + (b.width * size) <= rect.x + rect.width)
    && (p.y + (b.height * size) <= rect.y + rect.height));
  for ( let i = 0; i < steps; i++ ) {
    const next = { x: pos.x + (sx * size), y: pos.y + (sy * size) };
    if ( !inside(next) || collides(pos, next) || !spaceFree(b, next.x, next.y) ) break;
    pos = next;
    moved += scene.grid.distance;
  }
  if ( moved ) await displaceToken(b, pos, feet < 0 ? "pull" : "push");
  return moved;
}

/** The lowest spell slot key ("spell3", "pact") that can cast this spell activity, if it needs one. */
export function lowestSlot(activity) {
  const item = activity.item;
  const actor = activity.actor;
  if ( (item?.type !== "spell") || !(item.system.level > 0) || !activity.consumption?.spellSlot ) return null;
  if ( !["spell", "pact"].includes(item.system.method) ) return null;
  const slots = Object.entries(actor.system.spells ?? {})
    .map(([key, s]) => ({ key, level: key === "pact" ? s.level : Number(key.replace("spell", "")), value: s.value ?? 0 }))
    .filter(s => (s.level >= item.system.level) && (s.value > 0))
    .sort((a, b) => a.level - b.level);
  return slots[0]?.key ?? null;
}

/* -------------------------------------------- */
/*  Running something on another user's client  */
/* -------------------------------------------- */

/** Handlers that can be run remotely: name → async (payload) => result. */
export const HANDLERS = {
  /** Choose one creature; resolves to its UUID or null. */
  async pickCreature({ title, prompt, choices, allowNone, chips }) {
    const [uuid] = await pickOnMap({ title, prompt, choices, count: 1, allowNone, chips });
    return uuid ?? null;
  }
};

/** Choose up to count creatures; resolves to a list of UUIDs. */
HANDLERS.pickCreatures = async function({ title, prompt, choices, count, allowNone, chips }) {
  return pickOnMap({ title, prompt, choices, count, allowNone, chips });
};

/** A list that scrolls instead of growing the dialog past the screen (many creatures on the map). */
const scrollList = rows => `<div class="aet-pick-list" style="max-height:min(50vh, 440px);overflow-y:auto;padding-right:4px">${rows}</div>`;

/**
 * The creature picker. Picking a row pans the camera to that creature and targets it; targeting a listed creature on the
 * map picks its row. One pick = radio buttons, several = checkboxes (up to count). Cancelling restores the targets.
 * @returns {Promise<string[]>} UUIDs
 */
async function pickOnMap({ title, prompt, choices, count=1, allowNone=true, chips=null }) {
  const single = count <= 1;
  const tokenOf = uuid => tokenFor(fromUuidSync(uuid))?.object ?? null;
  const previous = Array.from(game.user.targets ?? []);
  let syncing = false;
  const target = (token, on, release) => {
    if ( !token ) return;
    syncing = true;
    try { token.setTarget(on, { releaseOthers: release, groupSelection: !release }); } finally { syncing = false; }
  };
  const focus = uuid => {
    const token = tokenOf(uuid);
    if ( token ) {
      if ( document.hidden ) canvas.pan({ x: token.center.x, y: token.center.y });
      else canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 250 });
    }
    return token;
  };
  // Colour chips (ally / neutral / hostile, as the chooser sees them): rows of a chip that's off are hidden.
  const on = new Set(chips ?? ["ally", "neutral", "hostile"]);
  const colours = CONFIG.Canvas.dispositionColors;
  const css = r => `#${Number({ ally: colours.FRIENDLY, neutral: colours.NEUTRAL, hostile: colours.HOSTILE }[r] ?? 0).toString(16).padStart(6, "0")}`;
  const row = c => {
    const token = tokenOf(c.uuid);
    const img = token?.document.texture.src ?? fromUuidSync(c.uuid)?.img ?? "icons/svg/mystery-man.svg";
    const shown = !c.rel || on.has(c.rel);
    return `<label class="aet-pick-row" data-rel="${c.rel ?? ""}" style="display:${shown ? "flex" : "none"};gap:8px;align-items:center;margin:3px 0;padding:2px 4px;border-radius:4px;cursor:pointer${c.rel ? `;border-left:4px solid ${css(c.rel)}` : ""}">
      <input type="${single ? "radio" : "checkbox"}" name="pick" value="${c.uuid}">
      <img src="${img}" width="28" height="28" style="border:none;object-fit:contain">
      <span>${foundry.utils.escapeHTML(c.name)}</span></label>`;
  };
  const rows = choices.map(row).join("");
  const counts = { ally: 0, neutral: 0, hostile: 0 };
  for ( const c of choices ) if ( c.rel in counts ) counts[c.rel]++;
  const chipLabel = { ally: "Allies", neutral: "Neutral", hostile: "Hostile" };
  const chipRow = chips ? `<div class="aet-pick-chips" style="display:flex;gap:6px;margin:4px 0">${["ally", "neutral", "hostile"].map(r =>
    `<label style="display:flex;gap:4px;align-items:center;padding:1px 6px;border-radius:10px;border:1px solid ${css(r)};background:${css(r)}33;cursor:pointer">
      <input type="checkbox" name="chip" value="${r}"${on.has(r) ? " checked" : ""}><span>${chipLabel[r]} (${counts[r]})</span></label>`).join("")}</div>` : "";
  let hook = null;
  const buttons = [{ action: "ok", label: "Confirm", icon: "fa-solid fa-check", default: true,
    callback: (event, button, dialog) => [...dialog.element.querySelectorAll('input[name="pick"]:checked')].map(b => b.value) }];
  if ( allowNone !== false ) buttons.push({ action: "none", label: "No one", icon: "fa-solid fa-xmark", callback: () => null });
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title }, position: { width: 420 }, rejectClose: false,
    content: `${prompt || ""}<p class="hint"><em>${single ? "Pick one" : `Pick up to ${count}`} — or target ${single ? "it" : "them"} on the map.</em></p>${chipRow}${scrollList(rows)}`,
    render: (event, dialog) => {
      const boxes = [...dialog.element.querySelectorAll('input[name="pick"]')];
      const ok = dialog.element.querySelector('button[data-action="ok"]');
      const chipBoxes = [...dialog.element.querySelectorAll('input[name="chip"]')];
      const applyChips = () => {
        const shown = new Set(chipBoxes.filter(b => b.checked).map(b => b.value));
        for ( const label of dialog.element.querySelectorAll(".aet-pick-row[data-rel]") ) {
          const rel = label.dataset.rel;
          const visible = !rel || shown.has(rel);
          label.style.display = visible ? "flex" : "none";
          const box = label.querySelector("input");
          if ( !visible && box.checked ) { box.checked = false; target(tokenOf(box.value), false, false); }
        }
      };
      const revealRow = box => {
        const rel = box.closest(".aet-pick-row")?.dataset.rel;
        const chip = rel && chipBoxes.find(b => b.value === rel);
        if ( chip && !chip.checked ) { chip.checked = true; applyChips(); }
      };
      for ( const chip of chipBoxes ) chip.addEventListener("change", () => { applyChips(); refresh(); });
      const refresh = () => {
        const n = boxes.filter(b => b.checked).length;
        if ( !single ) boxes.forEach(b => { b.disabled = !b.checked && (n >= count); });
        boxes.forEach(b => { b.closest("label").style.background = b.checked ? "rgba(255,200,80,0.18)" : ""; });
        if ( ok ) ok.disabled = !n;
      };
      for ( const box of boxes ) box.addEventListener("change", () => {
        if ( box.checked ) target(focus(box.value), true, single);
        else target(tokenOf(box.value), false, false);
        refresh();
      });
      hook = Hooks.on("targetToken", (user, token, targeted) => {
        if ( syncing || (user !== game.user) ) return;
        const box = boxes.find(b => b.value === token.actor?.uuid);
        if ( !box ) return;
        if ( targeted ) {
          revealRow(box);
          box.closest("label")?.scrollIntoView({ block: "nearest" });
          if ( single ) boxes.forEach(b => { b.checked = b === box; });
          else if ( !box.checked && (boxes.filter(b => b.checked).length < count) ) box.checked = true;
        } else if ( !single ) box.checked = false;
        refresh();
      });
      refresh();
    },
    buttons
  });
  if ( hook !== null ) Hooks.off("targetToken", hook);
  const picked = Array.isArray(result) ? result : [];
  if ( !picked.length ) {
    syncing = true;
    try {
      Array.from(game.user.targets).forEach(tk => tk.setTarget(false, { releaseOthers: false, groupSelection: true }));
      previous.forEach(tk => tk.setTarget(true, { releaseOthers: false, groupSelection: true }));
    } finally { syncing = false; }
  }
  return picked;
}

/** Choose up to `count` of several options (checkboxes); resolves to the chosen values. */
HANDLERS.pickMany = async function({ title, prompt, options, count }) {
  const rows = options.map(o => `<label style="display:flex;gap:8px;align-items:center;margin:4px 0">
    <input type="checkbox" name="pick" value="${o.value}"> <span>${foundry.utils.escapeHTML(o.label)}</span></label>`).join("");
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title }, position: { width: 440 }, rejectClose: false,
    content: `${prompt || ""}<p><em>Choose ${count > 1 ? `up to ${count}` : "one"}.</em></p>${scrollList(rows)}`,
    render: (event, dialog) => {
      const boxes = dialog.element.querySelectorAll('input[name="pick"]');
      const limit = () => {
        const n = [...boxes].filter(b => b.checked).length;
        boxes.forEach(b => { b.disabled = !b.checked && (n >= count); });
      };
      boxes.forEach(b => b.addEventListener("change", limit));
    },
    buttons: [{ action: "ok", label: "Confirm", icon: "fa-solid fa-check", default: true,
      callback: (event, button, dialog) => [...dialog.element.querySelectorAll('input[name="pick"]:checked')].map(b => b.value) }]
  });
  return Array.isArray(result) ? result : [];
};

/**
 * Recover expended spell slots up to a budget of combined levels (Arcane Recovery, Natural Recovery).
 * payload: { title, prompt, budget, maxSlots?, slots: [{ key, level, missing }] } → { key: count }
 */
HANDLERS.recoverSlots = async function({ title, prompt, budget, maxSlots, slots }) {
  const rows = slots.map(s => `<label style="display:flex;gap:8px;align-items:center;margin:4px 0">
    <span style="min-width:90px">Level ${s.level}</span>
    <input type="number" name="${s.key}" data-level="${s.level}" value="0" min="0" max="${s.missing}" style="width:60px">
    <span class="aet-muted">of ${s.missing} expended</span></label>`).join("");
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title }, position: { width: 420 }, rejectClose: false,
    content: `${prompt || ""}<p>${maxSlots === 1 ? `One slot, up to level <strong>${budget}</strong>.`
      : `Up to <strong>${budget}</strong> levels in total${maxSlots ? `, at most ${maxSlots} slots` : ""}.`} <span class="aet-used"></span></p>${rows}`,
    render: (event, dialog) => {
      const inputs = [...dialog.element.querySelectorAll("input[type=number]")];
      const used = dialog.element.querySelector(".aet-used");
      const ok = dialog.element.querySelector('button[data-action="ok"]');
      const update = () => {
        const total = inputs.reduce((s, i) => s + (Number(i.value) || 0) * Number(i.dataset.level), 0);
        const count = inputs.reduce((s, i) => s + (Number(i.value) || 0), 0);
        used.textContent = `Chosen: ${total}.`;
        if ( ok ) ok.disabled = (total > budget) || (maxSlots && (count > maxSlots));
      };
      inputs.forEach(i => i.addEventListener("input", update));
      update();
    },
    buttons: [
      { action: "ok", label: "Recover", icon: "fa-solid fa-rotate", default: true,
        callback: (event, button, dialog) => Object.fromEntries([...dialog.element.querySelectorAll("input[type=number]")]
          .map(i => [i.name, Math.max(0, Math.min(Number(i.max), Number(i.value) || 0))])) },
      { action: "no", label: "Not now", icon: "fa-solid fa-xmark", callback: () => null }
    ]
  });
  return (result && typeof result === "object") ? result : null;
};

/**
 * Choose a spell and a spell slot to spend on it (spell storing).
 * payload: { title, spells: [{ uuid, name, level }], slots: [{ key, level, value }] } → { uuid, slot } or null
 */
HANDLERS.pickSpellSlot = async function({ title, spells, slots }) {
  const spellOptions = spells.map(s => `<option value="${s.uuid}" data-level="${s.level}">${foundry.utils.escapeHTML(s.name)} (level ${s.level})</option>`).join("");
  const slotOptions = slots.map(s => `<option value="${s.key}" data-level="${s.level}">Level ${s.level} (${s.value} left)</option>`).join("");
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title }, position: { width: 420 }, rejectClose: false,
    content: `<label style="display:flex;gap:8px;align-items:center;margin:6px 0"><span style="min-width:60px">Spell</span><select name="spell">${spellOptions}</select></label>
      <label style="display:flex;gap:8px;align-items:center;margin:6px 0"><span style="min-width:60px">Slot</span><select name="slot">${slotOptions}</select></label>`,
    render: (event, dialog) => {
      const spell = dialog.element.querySelector("select[name=spell]");
      const slot = dialog.element.querySelector("select[name=slot]");
      const ok = dialog.element.querySelector('button[data-action="ok"]');
      const update = () => {
        const min = Number(spell.selectedOptions[0]?.dataset.level ?? 1);
        for ( const o of slot.options ) o.disabled = Number(o.dataset.level) < min;
        if ( slot.selectedOptions[0]?.disabled ) slot.value = [...slot.options].find(o => !o.disabled)?.value ?? "";
        if ( ok ) ok.disabled = !slot.value;
      };
      spell.addEventListener("change", update);
      update();
    },
    buttons: [
      { action: "ok", label: "Store", icon: "fa-solid fa-box-archive", default: true,
        callback: (event, button, dialog) => ({ uuid: dialog.element.querySelector("select[name=spell]").value,
          slot: dialog.element.querySelector("select[name=slot]").value }) },
      { action: "no", label: "Cancel", icon: "fa-solid fa-xmark", callback: () => null }
    ]
  });
  return (result && typeof result === "object") ? result : null;
};

/**
 * Teleport a creature's token: its controller picks an unoccupied spot within range (and, with sight, one it can see).
 * payload: { tokenUuid, range, sight, label } → feet moved, or null if cancelled.
 */
HANDLERS.teleport = async function({ tokenUuid, range, sight, label }) {
  const token = fromUuidSync(tokenUuid);
  if ( !token?.isOwner || !canvas?.ready || (canvas.scene !== token.parent) ) return null;
  const Placement = dnd5e.canvas?.TokenPlacement;
  if ( !Placement ) return null;
  const size = token.parent.grid.size;
  for ( let attempt = 0; attempt < 3; attempt++ ) {
    ui.notifications.info(`${label}: choose where ${token.name} appears (up to ${range} ft${sight ? ", a spot you can see" : ""}).`);
    let placed;
    try { placed = await Placement.place({ tokens: [token.toObject()] }); } catch(err) { return null; }
    const spot = placed?.[0];
    if ( !spot ) return null;
    const x = spot.x, y = spot.y;
    const feet = distanceFt(token, token, { x, y });
    const centre = { x: x + (token.width * size / 2), y: y + (token.height * size / 2) };
    const visible = !sight || canvas.visibility?.testVisibility?.(centre, { tolerance: 1, object: token.object }) !== false;
    if ( (feet <= Number(range)) && spaceFree(token, x, y) && visible ) {
      await displaceToken(token, { x, y }, "teleport");
      return feet;
    }
    ui.notifications.warn(`${label}: that spot is ${feet > Number(range) ? `${feet} ft away` : (!visible ? "out of sight" : "occupied")} — try again.`);
  }
  return null;
};

/** Pick one entry from a long list (a dropdown); resolves to the chosen value or null. */
HANDLERS.pickFromList = async function({ title, prompt, options }) {
  const esc = foundry.utils.escapeHTML ?? (s => s);
  const content = `${prompt || ""}<select name="choice" style="width:100%">${options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("")}</select>`;
  const choice = await foundry.applications.api.DialogV2.prompt({
    window: { title }, position: { width: 380 }, rejectClose: false, content,
    ok: { label: "Choose", callback: (event, button) => button.form.elements.choice.value }
  });
  return choice ?? null;
};

/** Show a one-of-several choice; resolves to the chosen value or null. */
HANDLERS.pickOption = async function({ title, prompt, options }) {
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title }, position: { width: 380 }, rejectClose: false, content: prompt || "",
    buttons: options.map(o => ({ action: o.value, label: o.label }))
  });
  return choice ?? null;
};

/* -------------------------------------------- */
/*  One GM window handles player requests       */
/* -------------------------------------------- */

/*
 * The same GM account can be open in several windows (a second monitor, a test tab). Every window receives player
 * requests, so each would act and effects would be applied twice. GM windows announce themselves; the lead window
 * (lowest connection id among those heard from recently) is the only one that handles requests.
 */
const gmWindows = new Map();   // socket id → last seen
const GM_ALIVE_MS = 25000;

/** Should this window handle requests meant for "the GM"? */
export function isLeadGM() {
  if ( !game.user?.isGM || (game.users.activeGM !== game.user) ) return false;
  const now = Date.now();
  const live = [...gmWindows].filter(([, seen]) => (now - seen) < GM_ALIVE_MS).map(([id]) => id);
  live.push(game.socket.id);
  return live.sort()[0] === game.socket.id;
}

const waiting = new Map();

/**
 * Run a handler on a user's client and resolve its result (null after the reaction timeout if they don't answer).
 * @param {User} user
 * @param {string} handler   Key of HANDLERS.
 * @param {object} payload   Plain data.
 */
export function runAs(user, handler, payload) {
  if ( (user === game.user) || (user.isGM && game.user.isGM) ) return HANDLERS[handler](payload);
  const requestId = foundry.utils.randomID();
  const timeoutS = game.settings.get(MODULE_ID, "reactionTimeout") || 0;
  return new Promise(resolve => {
    waiting.set(requestId, resolve);
    game.socket.emit(SOCKET, { type: "runAs", requestId, userId: user.id, handler, payload });
    if ( timeoutS ) setTimeout(() => {
      if ( waiting.delete(requestId) ) resolve(null);
    }, (timeoutS + 3) * 1000);
  });
}

Hooks.once("ready", () => {
  if ( game.user.isGM ) {
    const hello = type => game.socket.emit(SOCKET, { type, id: game.socket.id, userId: game.user.id });
    hello("gmWho");
    setInterval(() => hello("gmHello"), 8000);
  }
  game.socket.on(SOCKET, async data => {
    if ( (data?.type === "runAs") && (data.userId === game.user.id) && (!game.user.isGM || isLeadGM()) ) {
      const result = await HANDLERS[data.handler]?.(data.payload) ?? null;
      game.socket.emit(SOCKET, { type: "runAsResult", requestId: data.requestId, result });
    }
    else if ( data?.type === "runAsResult" ) {
      const resolve = waiting.get(data.requestId);
      if ( resolve ) {
        waiting.delete(data.requestId);
        resolve(data.result);
      }
    }
    else if ( ["gmHello", "gmWho"].includes(data?.type) ) {
      if ( !game.user.isGM || (data.userId !== game.user.id) ) return;
      gmWindows.set(data.id, Date.now());
      if ( data.type === "gmWho" ) game.socket.emit(SOCKET, { type: "gmHello", id: game.socket.id, userId: game.user.id });
    }
    else if ( !isLeadGM() ) return;
    else if ( data?.type === "placeEffect" ) {
      const actor = fromUuidSync(data.actorUuid);
      if ( actor ) await placeEffect(actor, data.data, data.replace);
    }
    else if ( data?.type === "toggleStatus" ) await fromUuidSync(data.actorUuid)?.toggleStatusEffect(data.id, { active: data.active });
    else if ( data?.type === "updateActor" ) await fromUuidSync(data.actorUuid)?.update(data.update);
    else if ( data?.type === "updateCombatants" ) await game.combats.get(data.combatId)?.updateEmbeddedDocuments("Combatant", data.updates);
    else if ( data?.type === "updateToken" ) await fromUuidSync(data.uuid)?.update(data.update);
    else if ( data?.type === "deleteEffects" ) await fromUuidSync(data.actorUuid)?.deleteEmbeddedDocuments("ActiveEffect", data.ids ?? []);
    else if ( data?.type === "displaceToken" ) {
      const token = fromUuidSync(data.uuid);
      if ( token ) await displaceToken(token, { x: data.x, y: data.y }, "relay");
    }
  });
});
