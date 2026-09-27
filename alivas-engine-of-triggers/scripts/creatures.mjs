/**
 * Alivas's Engine of Triggers — creatures: finding, seeing, choosing, and giving effects.
 *
 * Reusable building blocks for triggers and reactions:
 *   tokenFor(actor, scene)            the actor's token (prefers the given scene)
 *   distanceFt(tokenA, tokenB)        5e distance, edge to edge
 *   canSee(viewerToken, targetToken)  Foundry vision from the viewer's point of view
 *   relation(a, b, scene)             "self" | "ally" | "enemy" | "neutral" (token dispositions)
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
 *     side:       "any" | "ally" | "enemy",   relative to the chooser (allies include itself)
 *     self:       true,      may include the chooser (default true)
 *     notSubject: true,      never the triggering creature
 *     count:      1,         choose up to this many (number or formula, e.g. "@prof", on the chooser's data)
 *     pool:       "nearby" | "targets" | "combat",   where candidates come from (default nearby on the scene)
 *     able:       true,      not Incapacitated
 *     actorType:  "character"  only this actor type (e.g. player characters)
 *   }
 */

const MODULE_ID = "alivas-engine-of-triggers";
const SOCKET = `module.${MODULE_ID}`;

/* -------------------------------------------- */
/*  Geometry and vision                         */
/* -------------------------------------------- */

/** A token document for an actor, preferring one on the given scene. */
export function tokenFor(actor, scene) {
  if ( !actor ) return null;
  if ( actor.token ) return actor.token;
  scene ??= canvas?.scene ?? game.scenes.active;
  return scene?.tokens.find(t => t.actorId === actor.id) ?? null;
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

/**
 * How b stands relative to a, from their tokens' dispositions.
 * @returns {"self"|"ally"|"enemy"|"neutral"}
 */
export function relation(a, b, scene) {
  if ( a && b && (a.uuid === b.uuid) ) return "self";
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
    if ( spec.able && actor.statuses?.has("incapacitated") ) continue;
    if ( spec.actorType && (actor.type !== spec.actorType) ) continue;
    const isSelf = actor.uuid === from?.uuid;
    if ( isSelf && (spec.self === false) ) continue;
    if ( spec.notSubject && ctx.subject && (actor.uuid === ctx.subject.uuid) ) continue;
    const rel = relation(from, actor, scene);
    if ( (spec.side === "ally") && !["self", "ally"].includes(rel) ) continue;
    if ( (spec.side === "enemy") && (rel !== "enemy") ) continue;
    const distance = isSelf ? 0 : (origin ? distanceFt(origin, t) : 0);
    if ( !isSelf && spec.range && (distance > Number(spec.range)) ) continue;
    if ( !isSelf && spec.sight && !canSee(origin, t) ) continue;
    seen.add(actor.uuid);
    found.push({ actor, distance: isSelf ? -1 : distance });
  }
  return found.sort((a, b) => a.distance - b.distance).map(f => f.actor);
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
export async function pickCreatures(chooser, actors, { title, prompt="", allowNone=true, count=1 }={}) {
  if ( !actors.length ) return [];
  const user = controllerOf(chooser);
  if ( !user ) return [];
  const payload = {
    title: title ?? `${chooser.name} — choose ${count > 1 ? `up to ${count} creatures` : "a creature"}`, prompt, allowNone, count,
    choices: actors.map(a => ({ uuid: a.uuid, name: a.uuid === chooser.uuid ? `${a.name} (yourself)` : (tokenFor(a)?.name ?? a.name) }))
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
  switch ( selector.who ?? "choose" ) {
    case "self": return chooser ? [chooser] : [];
    case "bearer": return ctx.bearer ? [ctx.bearer] : [];
    case "source": return ctx.source ? [ctx.source] : [];
    case "subject": return ctx.subject ? [ctx.subject] : [];
    case "targets": return (ctx.targets ?? []).filter(Boolean);
    case "all": return findCreatures(chooser, selector, ctx);
    default: return pickCreatures(chooser, findCreatures(chooser, selector, ctx), {
      title: ctx.title, prompt: ctx.prompt, count: selectorCount(selector, chooser)
    });
  }
}

/** Plain-language description of a SELECTOR, e.g. "a creature you choose within 60 ft that you can see". */
export function describeSelector(selector={}, { you="you", bearerWord="the bearer" }={}) {
  const side = { ally: "ally", enemy: "enemy" }[selector.side] ?? "creature";
  const within = selector.range ? ` within ${selector.range} ft` : "";
  const seeing = selector.sight ? ` that ${you} can see` : "";
  const notSubject = selector.notSubject ? " (not the triggering creature)" : "";
  const pool = selector.pool === "targets" ? " among the targets" : selector.pool === "combat" ? " in the combat" : "";
  switch ( selector.who ?? "choose" ) {
    case "self": return you;
    case "bearer": return bearerWord;
    case "source": return "the source";
    case "subject": return "the triggering creature";
    case "targets": return "the targets";
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
      if ( actor.isOwner ) await actor.toggleStatusEffect(id, { active: false });
      else game.socket.emit(SOCKET, { type: "toggleStatus", actorUuid: actor.uuid, id, active: false });
      ended.push(`${actor.name}: ${statusName(id)}`);
    }
  }
  return ended;
}

const statusName = id => game.i18n.localize(CONFIG.statusEffects.find(s => s.id === id)?.name ?? id);

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
  /** Show a "choose a creature" popup; resolves to the chosen actor's UUID or null. */
  async pickCreature({ title, prompt, choices, allowNone }) {
    const buttons = choices.map(c => ({ action: c.uuid, label: c.name }));
    if ( allowNone ) buttons.push({ action: "none", label: "No one", icon: "fa-solid fa-xmark" });
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title }, content: prompt || "<p>Choose a creature.</p>", buttons,
      position: { width: 420 }, rejectClose: false
    });
    return (choice && (choice !== "none")) ? choice : null;
  }
};

/** Show a "choose up to N creatures" popup (checkboxes); resolves to a list of UUIDs. */
HANDLERS.pickCreatures = async function({ title, prompt, choices, count }) {
  const rows = choices.map(c => `<label style="display:flex;gap:8px;align-items:center;margin:4px 0">
    <input type="checkbox" name="pick" value="${c.uuid}"> <span>${foundry.utils.escapeHTML(c.name)}</span></label>`).join("");
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title }, position: { width: 420 }, rejectClose: false,
    content: `${prompt || ""}<p><em>Choose up to ${count}.</em></p>${rows}`,
    render: (event, dialog) => {
      const boxes = dialog.element.querySelectorAll('input[name="pick"]');
      const limit = () => {
        const n = [...boxes].filter(b => b.checked).length;
        boxes.forEach(b => { b.disabled = !b.checked && (n >= count); });
      };
      boxes.forEach(b => b.addEventListener("change", limit));
    },
    buttons: [
      { action: "ok", label: "Confirm", icon: "fa-solid fa-check", default: true,
        callback: (event, button, dialog) => [...dialog.element.querySelectorAll('input[name="pick"]:checked')].map(b => b.value) },
      { action: "none", label: "No one", icon: "fa-solid fa-xmark", callback: () => [] }
    ]
  });
  return Array.isArray(result) ? result : [];
};

/** Show a one-of-several choice; resolves to the chosen value or null. */
HANDLERS.pickOption = async function({ title, prompt, options }) {
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title }, position: { width: 380 }, rejectClose: false, content: prompt || "",
    buttons: options.map(o => ({ action: o.value, label: o.label }))
  });
  return choice ?? null;
};

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
  game.socket.on(SOCKET, async data => {
    if ( (data?.type === "runAs") && (data.userId === game.user.id) ) {
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
    else if ( game.users.activeGM !== game.user ) return;
    else if ( data?.type === "placeEffect" ) {
      const actor = fromUuidSync(data.actorUuid);
      if ( actor ) await placeEffect(actor, data.data, data.replace);
    }
    else if ( data?.type === "toggleStatus" ) await fromUuidSync(data.actorUuid)?.toggleStatusEffect(data.id, { active: data.active });
    else if ( data?.type === "updateActor" ) await fromUuidSync(data.actorUuid)?.update(data.update);
    else if ( data?.type === "updateCombatants" ) await game.combats.get(data.combatId)?.updateEmbeddedDocuments("Combatant", data.updates);
  });
});
