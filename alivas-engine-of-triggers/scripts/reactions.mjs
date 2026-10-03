/**
 * Alivas's Engine of Triggers — reactions.
 *
 * Reaction WINDOWS are moments in play where a creature may react. When one opens, each creature with an eligible
 * reaction gets a popup (sent to its connected player, otherwise the GM) listing what it can do right now, plus
 * "Skip". The game waits for each answer (or the timeout) before the moment resolves.
 *
 * Windows
 *   hitBy           an attack roll hits a creature                    subject = the creature hit
 *   d20Succeeded    a creature succeeds on an attack roll or save     subject = the creature that succeeded
 *   damageIncoming  a creature is about to take damage                subject = the creature taking it
 *   spellCast       a creature starts casting a spell                 subject = the caster
 *   hitting         the reactor itself just hit with an attack roll    subject = the attacker (e.g. Divine Smite)
 *                   data: attackType (melee/ranged), classification (weapon/spell/unarmed), critical, targetType
 *                   (creature type of the target), target (its roll data)
 *   d20Failed       a creature fails a check with a known DC             subject = that creature
 *                   data: skill, tool, proficient
 *   d20Rolling      a creature has rolled a d20 test with advantage or disadvantage, before the result is posted
 *                   (nobody has seen it yet)                          subject = the roller
 *   leavesReach     a creature moves out of a hostile's reach         subject = the mover (Opportunity Attacks, built in)
 *
 * Items declare reactions at `flags.alivas-engine-of-triggers.reactions` (list):
 *   {
 *     window:    one of the windows above (except leavesReach, which is built in),
 *     label:     "Shield",                       // button text (default: item name)
 *     activity:  "id or name",                   // activity to use (default: first reaction-activation activity)
 *     who:       "self" | "other" | "any",       // reactor vs subject (default "self" for hitBy/damageIncoming,
 *                                                //   "other" otherwise)
 *     range:     60,                             // max feet between reactor and subject (optional)
 *     filter:    FilterDescription,              // against the window data (kind, total, ac/dc, types, level…)
 *                                                //   plus `reactor` (the reactor's roll data)
 *     reaction:  false,                          // not a reaction (e.g. a Bonus Action spell): doesn't need or use one
 *     cost:      { uses: 1, level: 1, spell },   // instead of using an activity, spend the item's own uses (charges);
 *                                                //   level = @castLevel for the outcome; spell = id of a spell item to
 *                                                //   cast for free afterwards (its effects apply)
 *     configure: false,                          // show dnd5e's usage dialog when used; otherwise a spell uses the
 *                                                //   lowest spell slot that can cast it
 *     sight:     true,                           // the reactor must be able to see the subject (Foundry vision)
 *     detail:    "text",                         // shown next to the option in the popup (optional)
 *     outcome:   { type: ..., ... },             // what it does to the moment
 *     oncePerTurn: true,                         // at most once per turn (in combat)
 *     atTarget:  true,                           // hitting: use the activity on the creature that was hit
 *     after:     { type: "giveEffect", effect, to: SELECTOR }
 *              | { type: "useActivity", activity, to: SELECTOR, when: "zeroed" }
 *                                                // use another activity of the item on creatures the SELECTOR picks
 *                                                //   (damageIncoming, when: "zeroed" = only if the damage became 0)
 *                                                // afterwards, give one of this item's effects (id or name) to the
 *                                                //   creatures the SELECTOR picks (creatures.mjs), e.g.
 *                                                //   { who: "choose", range: 60, sight: true, notSubject: true }.
 *                                                //   An earlier copy of the same effect on a creature is replaced.
 *   }
 *
 * Filter data, besides each window's own: `reactor` (the reactor's roll data), `subjectIsEnemy` (the subject's token
 * is hostile to the reactor's), `subjectIsAlly` (the subject is the reactor or on its side), `targetsMe` (spellCast: the caster is targeting the reactor),
 * for spellCast `identifier` / `name` / `level` / `hasComponents` (V, S or M, and not cast with an effect flagged
 * `noComponents`, e.g. Subtle Spell), for d20Rolling `advantage` / `disadvantage` / `kind`.
 *
 * Outcomes
 *   acBonus    { value }                    hitBy: AC + value against the triggering attack, then re-check the hit
 *   reroll     { keep: "lower"|"higher" }   hitBy / d20Succeeded: reroll the triggering d20 and keep one result
 *   modifyRoll { bonus: formula }           hitBy / d20Succeeded: add to the triggering roll (negative subtracts);
 *                                           the formula uses the REACTOR's roll data
 *   damage     { mode: "half"|"resist"|"reduce", amount: formula, types: [...] }
 *                                           damageIncoming: halve all, resist (halve) matching types, or reduce
 *   counter    { ability: "con", dc: "source"|number }
 *                                           spellCast: the caster saves vs the reactor's spell DC (or dc); on a
 *                                           failure the spell fails and nothing is spent
 *   straight   {}                           d20Rolling: the roll ignores advantage and disadvantage — the FIRST of the
 *                                           two d20s is kept (no new roll); the posted roll says so
 *   damageNext { mode: "add"|"reduce", formula, critDouble, damageType }
 *                                           hitBy: when that attack's damage lands, add to it (same type) or reduce
 *                                           it. formula may use @castLevel (slot level the reaction was cast with);
 *                                           critDouble doubles the dice if the attack was a critical hit;
 *                                           damageType adds it as damage of that type (default: the attack's type)
 *   none                                    just use the activity (its own effects apply as usual)
 *
 * An active effect with flag `noReactions: true` stops its bearer from taking reactions.
 */

import {
  tokenFor, distanceFt, canSee, relation, controllerOf, lowestSlot, selectCreatures, giveEffect, describeSelector, isLeadGM,
  runAs, HANDLERS, displaceToken
} from "./creatures.mjs";

export { tokenFor, distanceFt, canSee };

const MODULE_ID = "alivas-engine-of-triggers";
const SOCKET = `module.${MODULE_ID}`;
const setting = key => game.settings.get(MODULE_ID, key);

/** Statuses that prevent reactions. */
const NO_REACT = ["dead", "incapacitated", "paralyzed", "petrified", "stunned", "unconscious"];

/** Remote prompts waiting for an answer: requestId → resolve. */
const pending = new Map();

/* -------------------------------------------- */
/*  Reaction availability                       */
/* -------------------------------------------- */

/** The actor's combatant, preferring the combat on the scene where its token is (several combats can be running). */
function combatantFor(actor, scene) {
  scene ??= tokenFor(actor)?.parent ?? canvas?.scene;
  const started = game.combats.filter(c => c.started);
  const ordered = [...started.filter(c => c.scene?.id === scene?.id), ...started.filter(c => c.scene?.id !== scene?.id)];
  for ( const combat of ordered ) {
    const cb = combat.combatants.find(c => c.actor?.uuid === actor.uuid);
    if ( cb ) return cb;
  }
  return null;
}

/** Has the creature used its reaction since the start of its turn? Tracked in combat only. */
export function reactionUsed(actor) {
  const combatant = combatantFor(actor);
  // A creature delaying its turn has no reaction until it returns (delay.mjs).
  return !!combatant?.getFlag(MODULE_ID, "reactionUsed") || !!combatant?.getFlag(MODULE_ID, "delayed");
}

/** Mark the reaction as used. The GM does the update if this user can't. */
export async function markReactionUsed(actor) {
  const combatant = combatantFor(actor);
  if ( !combatant ) return;
  if ( combatant.isOwner ) return combatant.setFlag(MODULE_ID, "reactionUsed", true);
  game.socket.emit(SOCKET, { type: "markReaction", actorUuid: actor.uuid });
}

/** Start of a creature's turn: its reaction comes back. */
export async function resetReaction(combatant) {
  if ( combatant?.getFlag(MODULE_ID, "reactionUsed") ) await combatant.unsetFlag(MODULE_ID, "reactionUsed");
}

/** Can the actor pay for this activity right now? (Spell slots, item uses, consumption targets.) */
function canAfford(activity) {
  const item = activity.item;
  const actor = activity.actor;
  if ( !item || !actor ) return false;
  for ( const t of activity.consumption?.targets ?? [] ) {
    if ( t.type !== "itemUses" ) continue;
    // "identifier:a|b" (a pool named by identifier, see the Box) — the first of those items with uses.
    const byId = String(t.target ?? "").startsWith("identifier:")
      ? t.target.slice(11).split("|").map(id => actor.items.find(i => (i.system.identifier === id) && i.system.uses?.max)).find(Boolean) : null;
    const target = byId ?? (t.target ? actor.items.get(t.target) : item);
    if ( target?.system.uses?.max && ((target.system.uses.value ?? 0) < (Number(t.value) || 1)) ) return false;
  }
  if ( (item.type === "spell") && activity.consumption?.spellSlot && (item.system.level > 0)
    && ["spell", "pact"].includes(item.system.method) ) {
    const hasSlot = Object.entries(actor.system.spells ?? {}).some(([key, s]) => {
      const level = key === "pact" ? s.level : Number(key.replace("spell", ""));
      return (level >= item.system.level) && ((s.value ?? 0) > 0);
    });
    if ( !hasSlot ) return false;
  }
  return true;
}

function declaredActivity(item, decl) {
  const acts = item.system.activities;
  if ( !acts ) return null;
  if ( decl.activity ) return acts.get(decl.activity) ?? acts.getName(decl.activity) ?? null;
  return acts.find(a => a.activation?.type === "reaction") ?? acts.contents[0] ?? null;
}

/**
 * The reactions a creature could use in a window right now.
 * @returns {{option: object, outcome: object, label: string}[]}
 */
function eligible(actor, window, ctx) {
  if ( !actor || NO_REACT.some(s => actor.statuses?.has(s)) ) return [];
  const noReaction = reactionUsed(actor) || actor.appliedEffects?.some(e => e.getFlag(MODULE_ID, "noReactions"));
  const out = [];
  for ( const item of actor.items ) {
    const decls = item.getFlag(MODULE_ID, "reactions");
    if ( !Array.isArray(decls) ) continue;
    for ( const [n, decl] of decls.entries() ) {
      if ( decl.window !== window ) continue;
      if ( (decl.reaction !== false) && noReaction ) continue;
      const who = decl.who ?? (["hitBy", "damageIncoming", "hitting"].includes(window) ? "self" : (window === "d20Failed" ? "any" : "other"));
      const isSelf = actor.uuid === ctx.subject?.uuid;
      if ( (who === "self" && !isSelf) || (who === "other" && isSelf) ) continue;
      if ( decl.range && !isSelf
        && (distanceFt(tokenFor(actor, ctx.scene), tokenFor(ctx.subject, ctx.scene)) > decl.range) ) continue;
      if ( decl.sight && !isSelf && !canSee(tokenFor(actor, ctx.scene), tokenFor(ctx.subject, ctx.scene)) ) continue;
      if ( decl.filter && !dnd5e.Filter.performCheck({
        ...ctx.data, reactor: actor.getRollData(), subjectIsEnemy: relation(actor, ctx.subject, ctx.scene) === "enemy",
        subjectIsAlly: ["self", "ally"].includes(relation(actor, ctx.subject, ctx.scene)),
        targetsMe: !!ctx.targets?.includes(actor.uuid)
      }, decl.filter) ) continue;
      // A declaration with `cost` just spends the item's own uses (no activity is run), e.g. an Enspelled weapon's charge.
      // free: nothing to use or pay (an ability that's simply active, e.g. while a transformation lasts).
      const activity = (decl.cost || decl.free) ? null : declaredActivity(item, decl);
      if ( !decl.free && (decl.cost ? !((item.system.uses?.value ?? 0) >= (Number(decl.cost.uses) || 1)) : (!activity || !canAfford(activity))) ) continue;
      const turn = turnKeyOf(actor);
      if ( decl.requiresItem && !actor.items.some(i => i.system.identifier === decl.requiresItem) ) continue;
      const onceKey = decl.onceKey ?? n;
      // A shared onceKey (Sneak Attack and its Cunning Strike variants) counts across items; otherwise just this one.
      const usedIn = decl.onceKey ? [...actor.items] : [item];
      if ( decl.oncePerTurn && turn && usedIn.some(i => i.getFlag(MODULE_ID, `usedTurn.${onceKey}`) === turn) ) continue;
      const label = decl.label ?? item.name;
      out.push({
        label, outcome: decl.outcome ?? { type: "none" },
        detail: decl.detail ?? "",
        option: { id: `${item.id}.${activity?.id ?? "cost"}.${n}`, label, itemId: item.id, activityId: activity?.id ?? null, configure: !!decl.configure,
          cost: decl.cost ?? null, free: !!decl.free, decl: decl.onceKey ?? n, oncePerTurn: !!decl.oncePerTurn, hitUuid: ctx.target?.uuid ?? null,
          refund: decl.refundUnlessSuccess ?? null,
          quiet: ["damageNext", "damage"].includes(decl.outcome?.type),
          targetUuid: (decl.atTarget && ctx.target) ? (tokenFor(ctx.target, ctx.scene)?.uuid ?? null) : null,
          after: decl.after ?? null, subjectUuid: ctx.subject?.uuid ?? null, reaction: decl.reaction !== false,
          window: decl.window ?? null }
      });
    }
  }
  return out;
}

/** Another creature hostile to the target, within 5 ft of it and not incapacitated (Sneak Attack's "ally"). */
function allyNear(target, attacker, scene) {
  const tt = tokenFor(target, scene);
  if ( !tt ) return false;
  return scene.tokens.some(t => t.actor && (t.id !== tt.id) && (t.actor.uuid !== attacker.uuid) && (t.disposition !== tt.disposition)
    && (t.disposition !== CONST.TOKEN_DISPOSITIONS.NEUTRAL) && !["incapacitated", "unconscious", "dead"].some(s => t.actor.statuses?.has(s))
    && (distanceFt(t, tt) <= 5));
}

/** "combat:round:turn" of the running combat this creature is in, or null out of combat. */
function turnKeyOf(actor) {
  const combat = game.combats.find(c => c.started && c.combatants.some(cb => (cb.actor?.uuid === actor.uuid) || (!actor.isToken && (cb.actorId === actor.id))));
  return combat ? `${combat.id}:${combat.round}:${combat.turn}` : null;
}

/** Remember a oncePerTurn reaction was used this turn. */
async function markTurn(actor, option) {
  const turn = option?.oncePerTurn ? turnKeyOf(actor) : null;
  const item = turn ? actor.items.get(option.itemId) : null;
  if ( item ) await item.setFlag(MODULE_ID, `usedTurn.${option.decl}`, turn);
}

/** Creatures that could react on a scene: everyone in a started combat, then other tokens on the scene. */
function candidates(scene) {
  const seen = new Map();
  for ( const combat of game.combats.filter(c => c.started) ) {
    for ( const cb of combat.combatants ) if ( cb.actor && (!scene || cb.token?.parent === scene) ) seen.set(cb.actor.uuid, cb.actor);
  }
  for ( const t of scene?.tokens ?? [] ) if ( t.actor && !seen.has(t.actor.uuid) ) seen.set(t.actor.uuid, t.actor);
  return Array.from(seen.values());
}

/* -------------------------------------------- */
/*  Prompting                                   */
/* -------------------------------------------- */

/**
 * Ask a creature's controller to choose. Resolves { choice, used } — choice is an option id or "skip". A chosen
 * reaction's activity is used on the controller's client before it answers.
 * @param {Actor5e} actor
 * @param {string} situation  HTML describing the moment.
 * @param {object[]} options  { id, label, detail?, itemId, activityId, configure?, targetUuid?, rollAttack? }
 */
export async function ask(actor, situation, options) {
  const user = controllerOf(actor);
  if ( !user ) return { choice: "skip" };
  if ( (user === game.user) || (user.isGM && game.user.isGM) ) return showPrompt(actor.uuid, situation, options);
  const requestId = foundry.utils.randomID();
  const timeoutMs = (setting("reactionTimeout") || 0) * 1000;
  return new Promise(resolve => {
    pending.set(requestId, resolve);
    game.socket.emit(SOCKET, { type: "reactionPrompt", requestId, userId: user.id, actorUuid: actor.uuid, situation, options });
    if ( timeoutMs ) setTimeout(() => {
      if ( pending.delete(requestId) ) resolve({ choice: "skip", timedOut: true });
    }, timeoutMs + 3000);
  });
}

/** Show the popup on this client; if a reaction is chosen, use its activity here. */
async function showPrompt(actorUuid, situation, options) {
  const actor = fromUuidSync(actorUuid);
  if ( !actor ) return { choice: "skip" };
  const timeoutS = setting("reactionTimeout") || 0;
  const { DialogV2 } = foundry.applications.api;
  const buttons = [
    ...options.map(o => ({ action: o.id, label: o.label, icon: "fa-solid fa-bolt" })),
    { action: "skip", label: "Skip — continue without reacting", icon: "fa-solid fa-forward", default: true }
  ];
  const details = options.filter(o => o.detail).map(o => `<li><strong>${o.label}</strong> — ${o.detail}</li>`).join("");
  const content = `<p>${situation}</p>${details ? `<ul>${details}</ul>` : ""}`
    + (timeoutS ? `<p><em>Skips automatically after ${timeoutS} seconds.</em></p>` : "");
  const choice = await new Promise(resolve => {
    let done = false;
    const finish = value => { if ( !done ) { done = true; resolve(value); } };
    const dialog = new DialogV2({
      window: { title: `Reaction — ${actor.name}` }, content, buttons, position: { width: 480 },
      submit: result => finish(result ?? "skip")
    });
    Hooks.once(`close${dialog.constructor.name}`, app => { if ( app === dialog ) finish("skip"); });
    dialog.render({ force: true });
    if ( timeoutS ) setTimeout(() => { if ( !done ) { finish("skip"); dialog.close(); } }, timeoutS * 1000);
  });
  if ( !choice || (choice === "skip") ) return { choice: "skip" };
  const option = options.find(o => o.id === choice);
  if ( option?.free ) {
    if ( option.reaction !== false ) await markReactionUsed(actor);
    await markTurn(actor, option);
    return { choice, used: true };
  }
  if ( option?.cost ) {
    const item = actor.items.get(option.itemId);
    const n = Number(option.cost.uses) || 1;
    if ( !item || ((item.system.uses?.value ?? 0) < n) ) return { choice: "skip" };
    await item.update({ "system.uses.spent": (item.system.uses.spent ?? 0) + n });
    await note(actor, `<strong>${option.label}</strong>: ${item.name} spends ${n} ${n === 1 ? "use" : "uses"} (${item.system.uses.value} left).`);
    // An item casting its spell: cast it for free now, so the spell's own effects apply (Shield's +5 AC).
    const spell = option.cost.spell ? actor.items.get(option.cost.spell) : null;
    const spellActivity = spell?.system.activities?.find(a => a.activation?.type === "reaction") ?? spell?.system.activities?.contents[0];
    if ( spellActivity ) await spellActivity.use({ [MODULE_ID]: { reacted: true }, consume: { spellSlot: false, resources: false },
      cause: { resources: false } },
      { configure: false }, {});
    if ( option.reaction !== false ) await markReactionUsed(actor);
    await markTurn(actor, option);
    return { choice, used: true, castLevel: option.cost.level ?? 1 };
  }
  const activity = actor.items.get(option?.itemId)?.system.activities.get(option?.activityId);
  if ( !activity ) return { choice: "skip" };
  if ( option.targetUuid ) fromUuidSync(option.targetUuid)?.object?.setTarget(true, { releaseOthers: true });
  const usage = { [MODULE_ID]: { reacted: true } };
  // The outcome deals with the damage itself (Hand of Harm, Deflect Attacks): don't let dnd5e roll it too.
  if ( option.quiet ) usage.subsequentActions = false;
  const slot = !option.configure && lowestSlot(activity);
  if ( slot ) usage.spell = { slot };
  // Remember which slot level the reaction was cast with (for @castLevel).
  let castLevel = activity.item?.system.level ?? 0;
  if ( activity.type === "cast" ) {   // an item casting its spell (Enspelled weapon, staff…): that spell's level
    const cached = actor.items.find(i => i.flags?.dnd5e?.cachedFor?.endsWith(`Activity.${activity.id}`));
    castLevel = activity.spell?.level || cached?.system.level || 1;
  }
  const hookId = Hooks.on("dnd5e.activityConsumption", (used, usageConfig) => {
    if ( used.uuid !== activity.uuid ) return;
    const level = actor.system.spells?.[usageConfig.spell?.slot]?.level;
    if ( level ) castLevel = level;
  });
  // The attack workflow may roll the attack as part of the use: then don't roll it a second time.
  let attacked = false;
  const attackHook = Hooks.on("dnd5e.rollAttackV2", (rolls, { subject }={}) => { if ( subject?.uuid === activity.uuid ) attacked = true; });
  let result;
  try {
    result = await activity.use(usage, { configure: !!option.configure }, {});
  } finally {
    Hooks.off("dnd5e.activityConsumption", hookId);
  }
  if ( !result ) { Hooks.off("dnd5e.rollAttackV2", attackHook); return { choice: "skip" }; }
  // Give an automatic roll a moment to happen before deciding.
  if ( option.rollAttack && (activity.type === "attack") && !attacked ) await new Promise(r => setTimeout(r, 300));
  Hooks.off("dnd5e.rollAttackV2", attackHook);
  if ( option.rollAttack && (activity.type === "attack") && !attacked ) await activity.rollAttack({}, { configure: false }, {});
  if ( option.reaction !== false ) await markReactionUsed(actor);
  await markTurn(actor, option);
  return { choice, used: true, castLevel };
}

/**
 * A reaction's "afterwards" step, run by the reactor's controller once the reaction has been used.
 *   { type: "giveEffect", effect: "<id or name of an effect on the item>", to: SELECTOR (see creatures.mjs) }
 * @param {Actor5e} reactor
 * @param {Item5e} item
 * @param {object} after
 * @param {string} [subjectUuid]  The triggering creature.
 */
/**
 * A reaction was used: announce it like an engine action (hook alivasTriggers.action, origin "reaction") so other
 * modules (animations) can show it. effect = a stand-in named like the reaction's item; event = its window ("hitBy",
 * "hitting", "damageIncoming", "spellCast"…); action = its outcome ({ type: "damageNext" | "damage" | "acBonus" | "reroll"
 * | "counter" | … }); subject = the triggering creature; targets = the creature hit (hitting window), else the subject.
 */
function announceReaction(reactor, picked) {
  try {
    const option = picked?.option ?? {};
    const item = reactor?.items?.get(option.itemId);
    const toActor = uuid => { const d = uuid ? fromUuidSync(uuid) : null; return d?.actor ?? d ?? null; };
    const subject = toActor(option.subjectUuid);
    const hit = toActor(option.hitUuid);
    const standIn = { name: item?.name ?? "", parent: item, getSourceActor: () => reactor, getFlag: () => undefined };
    Hooks.callAll("alivasTriggers.action", { origin: "reaction", action: picked?.outcome ?? {}, trigger: null,
      effect: standIn, bearer: reactor, event: option.window ?? "reaction",
      context: { subject, targets: [hit ?? subject].filter(Boolean) }, result: {}, moves: [] });
  } catch(err) {
    console.error(`${MODULE_ID} | announcing a reaction failed`, err);
  }
}

/** Run a picked reaction's afterwards step (after its outcome is resolved and announced). */
function afterReaction(reactor, picked, { zeroed=false, castLevel=null }={}) {
  announceReaction(reactor, picked);
  const after = picked?.option?.after;
  if ( !after ) return;
  if ( (after.when === "zeroed") && !zeroed ) return;
  // after.item: the follow-up belongs to another item of the reactor (identifier), e.g. a Cunning Strike option.
  const item = after.item ? reactor.items.find(i => i.system.identifier === after.item) : reactor.items.get(picked.option.itemId);
  return item ? runAfter(reactor, item, after, picked.option.subjectUuid, picked.option.hitUuid, castLevel) : undefined;
}

async function runAfter(reactor, item, after, subjectUuid, hitUuid, castLevel=null) {
  if ( after?.type === "useActivity" ) return afterUseActivity(reactor, item, after, subjectUuid, hitUuid);
  if ( after?.type !== "giveEffect" ) return;
  const effect = item.effects.get(after.effect) ?? item.effects.getName(after.effect);
  if ( !effect ) return;
  const subject = subjectUuid ? fromUuidSync(subjectUuid) : null;
  const text = (effect.description || "").replace(/<[^>]+>/g, " ").trim();
  // who "hit": the creature the triggering attack hit (hitting window) — no picker.
  const hit = (after.to?.who === "hit") && hitUuid ? fromUuidSync(hitUuid) : null;
  const recipients = hit ? [hit] : await selectCreatures(reactor, after.to ?? {}, {
    subject, title: `${item.name} — choose a creature`,
    prompt: `<p>Who gets <strong>${effect.name}</strong>? (${describeSelector(after.to)})</p>${text ? `<p><em>${text}</em></p>` : ""}`
  });
  if ( !recipients.length ) return;
  const data = effect.toObject();
  data.origin = item.uuid;
  // The slot level it was cast with: the effect's triggers read it as @spellLevel (Searing Smite's burn).
  if ( castLevel ) foundry.utils.setProperty(data, "flags.dnd5e.spellLevel", castLevel);
  await giveEffect(data, recipients);
  await note(reactor, `<strong>${item.name}</strong>: ${recipients.map(a => a.name).join(", ")} ${recipients.length > 1 ? "get" : "gets"} <strong>${effect.name}</strong>.`);
}

Hooks.once("ready", () => {
  game.socket.on(SOCKET, async data => {
    if ( (data?.type === "reactionPrompt") && (data.userId === game.user.id) && (!game.user.isGM || isLeadGM()) ) {
      const result = await showPrompt(data.actorUuid, data.situation, data.options);
      game.socket.emit(SOCKET, { type: "reactionResponse", requestId: data.requestId, ...result });
    }
    else if ( data?.type === "reactionResponse" ) {
      const resolve = pending.get(data.requestId);
      if ( resolve ) {
        pending.delete(data.requestId);
        resolve({ choice: data.choice, used: data.used, castLevel: data.castLevel });
      }
    }
    else if ( (data?.type === "markReaction") && isLeadGM() ) {
      const actor = fromUuidSync(data.actorUuid);
      if ( actor ) await combatantFor(actor)?.setFlag(MODULE_ID, "reactionUsed", true);
    }
  });
});

/* -------------------------------------------- */
/*  Outcome helpers                             */
/* -------------------------------------------- */

const note = (actor, html) => ChatMessage.implementation.create({
  speaker: ChatMessage.implementation.getSpeaker({ actor }), content: `<p>${html}</p>`
});

/** Reroll a d20 roll and post it. Returns the kept result as { total, isCritical, isFumble }. */
async function rerollD20(current, roll, keep, actor, label) {
  // A full Roll rerolls itself; a bare result ({ total, d20 }, from a save rolled on another client) rerolls its d20
  // and keeps the same modifiers.
  let again;
  if ( typeof roll?.reroll === "function" ) again = await roll.reroll();
  else if ( Number.isFinite(roll?.d20) ) again = await new Roll(`1d20 + ${current.total - roll.d20}`).evaluate();
  else return current;
  await again.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }), flavor: `${label}: reroll (keeps the ${keep})` });
  const useNew = (keep === "higher") ? (again.total > current.total) : (again.total < current.total);
  return useNew ? { total: again.total, isCritical: again.isCritical, isFumble: again.isFumble } : current;
}

async function evalFormula(formula, actor) {
  const data = actor?.getRollData?.() ?? {};
  const roll = await new Roll(CONFIG.Dice.BasicRoll.replaceFormulaData(String(formula), data, { missing: 0 }), data).evaluate();
  return roll.total;
}

/** Apply a roll-changing outcome to the current result. */
async function applyRollOutcome(outcome, current, roll, subject, reactor, label) {
  if ( outcome.type === "reroll" ) return rerollD20(current, roll, outcome.keep ?? "lower", subject, label);
  if ( outcome.type === "modifyRoll" ) return { ...current, total: current.total + await evalFormula(outcome.bonus, reactor) };
  return current;
}

function describeRollOutcome(outcome) {
  if ( outcome.type === "reroll" ) return `forces a reroll, keeping the ${outcome.keep ?? "lower"} result`;
  if ( outcome.type === "modifyRoll" ) return `adds ${outcome.bonus} to the roll`;
  return "";
}

/* -------------------------------------------- */
/*  Windows                                     */
/* -------------------------------------------- */

/**
 * An attack roll hit. Offers hitBy to the target and d20Succeeded to creatures that can react to the attacker, one
 * creature at a time; each answer can change the result.
 * @param {{attacker: Actor5e, target: Actor5e, activity: Activity, roll: D20Roll, ac: number}} state
 * @returns {Promise<{hit: boolean, total: number, ac: number, changed: boolean}>}
 */
export async function attackHit(state) {
  const { roll, attacker, target } = state;
  let ac = state.ac;
  let cur = { total: roll.total, isCritical: roll.isCritical, isFumble: roll.isFumble };
  const scene = tokenFor(target)?.parent;
  const isHit = () => cur.isCritical || (!cur.isFumble && (cur.total >= ac));
  let changed = false;

  const reactors = [target, ...candidates(scene).filter(a => (a.uuid !== target.uuid) && (a.uuid !== attacker.uuid))];
  for ( const reactor of reactors ) {
    if ( !isHit() ) break;
    const data = { kind: "attack", total: cur.total, ac, attacker: attacker.getRollData() };
    const opts = [
      ...eligible(reactor, "hitBy", { scene, subject: target, data }),
      ...eligible(reactor, "d20Succeeded", { scene, subject: attacker, data })
    ];
    if ( !opts.length ) continue;
    const options = opts.map(o => ({ ...o.option, detail: previewAttack(o.outcome, cur, ac) || o.detail }));
    const situation = `<strong>${attacker.name}</strong> hits <strong>${target.name}</strong> with `
      + `${state.activity.item?.name ?? "an attack"} (${cur.total} vs AC ${ac}).`;
    const { choice, castLevel } = await ask(reactor, situation, options);
    const picked = opts.find(o => o.option.id === choice);
    if ( !picked ) continue;
    if ( picked.outcome.type === "damageNext" ) {
      await queueDamageMod(target, state.activity, picked, reactor, castLevel, cur.isCritical);
      await afterReaction(reactor, picked, { castLevel });
      continue;
    }
    if ( picked.outcome.type === "acBonus" ) ac += Number(picked.outcome.value) || 0;
    else cur = await applyRollOutcome(picked.outcome, cur, roll, attacker, reactor, picked.label);
    changed = true;
    await note(reactor, `<strong>${picked.label}</strong>: ${isHit() ? `the attack still hits (${cur.total} vs AC ${ac})`
      : `<strong>the attack now misses</strong> (${cur.total} vs AC ${ac})`}.`);
    await afterReaction(reactor, picked);
  }
  // The attacker itself: things it can do because it hit (Divine Smite). Not reactions.
  if ( isHit() ) {
    const mode = roll.options?.advantageMode ?? 0;
    const data = {
      kind: "attack", total: cur.total, ac, critical: !!cur.isCritical, advantage: mode > 0, disadvantage: mode < 0,
      weaponProperties: [...(state.activity?.item?.system?.properties ?? []), ...(state.activity?.flags?.[MODULE_ID]?.properties ?? [])],
      allyNearTarget: allyNear(target, attacker, scene),
      attackType: state.activity?.attack?.type?.value ?? "", classification: state.activity?.attack?.type?.classification ?? "",
      targetType: target.system?.details?.type?.value ?? "", target: target.getRollData?.() ?? {}
    };
    // Several things can follow one hit (Stunning Strike and Hand of Harm): after each pick, offer the rest.
    let opts = eligible(attacker, "hitting", { scene, subject: attacker, data, target });
    while ( opts.length ) {
      const options = opts.map(o => ({ ...o.option, detail: o.detail || previewAttack(o.outcome, cur, ac) }));
      const situation = `You hit <strong>${target.name}</strong> with ${state.activity.item?.name ?? "an attack"}`
        + `${cur.isCritical ? " — <strong>critical hit</strong>" : ""}.`;
      const { choice, castLevel } = await ask(attacker, situation, options);
      const picked = opts.find(o => o.option.id === choice);
      if ( !picked ) break;
      if ( picked.outcome.type === "damageNext" ) await queueDamageMod(target, state.activity, picked, attacker, castLevel, cur.isCritical);
      await afterReaction(attacker, picked, { castLevel });
      opts = eligible(attacker, "hitting", { scene, subject: attacker, data, target }).filter(o => o.option.id !== picked.option.id);
    }
  }
  return { hit: isHit(), total: cur.total, ac, changed };
}

/* -------------------------------------------- */
/*  Damage changes that wait for the damage     */
/* -------------------------------------------- */

/** "targetUuid|activityUuid" → [{ mode, amount, label, reactor }] */
const damageMods = new Map();

/** Roll a damageNext outcome now and hold it until that attack's damage is applied to the target. */
async function queueDamageMod(target, activity, picked, reactor, castLevel, isCritical) {
  const o = picked.outcome;
  const data = { ...reactor.getRollData(), castLevel: castLevel ?? 1 };
  const roll = new Roll(CONFIG.Dice.BasicRoll.replaceFormulaData(String(o.formula ?? "0"), data, { missing: 0 }), data);
  const crit = !!(o.critDouble && isCritical);
  if ( crit ) roll.alter(2, 0);
  await roll.evaluate();
  await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor: reactor }),
    flavor: `${picked.label}: ${o.mode === "reduce" ? "damage reduced by" : `extra${o.damageType ? ` ${CONFIG.DND5E.damageTypes[o.damageType]?.label ?? o.damageType}` : ""} damage`}${crit ? " (critical — dice doubled)" : ""}` });
  const key = `${target.uuid}|${activity?.uuid}`;
  damageMods.set(key, [...(damageMods.get(key) ?? []), { mode: o.mode, amount: roll.total, label: picked.label, type: o.damageType ?? null, at: Date.now() }]);
  await note(reactor, `<strong>${picked.label}</strong>: ${o.mode === "reduce" ? `${target.name} will take ${roll.total} less damage`
    : `the attack will deal ${roll.total} extra damage`} from this attack.`);
}

/**
 * Apply held damage changes for this target and attack (called when damage is about to be applied).
 * @returns {object[]|null}  Changed damages, or null if nothing was held.
 */
export function consumeDamageMods(actor, activity, damages) {
  const key = `${actor.uuid}|${activity?.uuid}`;
  const mods = (damageMods.get(key) ?? []).filter(m => (Date.now() - m.at) < 5 * 60 * 1000);
  damageMods.delete(key);
  if ( !mods.length || !Array.isArray(damages) ) return null;
  const result = damages.map(d => ({ ...d }));
  const hurt = result.filter(d => !(d.type in CONFIG.DND5E.healingTypes));
  for ( const mod of mods ) {
    if ( (mod.mode === "add") && mod.type ) result.push({ value: mod.amount, type: mod.type, properties: new Set(["mgc"]) });
    else if ( mod.mode === "add" ) {
      if ( hurt[0] ) hurt[0].value += mod.amount;
    } else {
      let left = mod.amount;
      for ( const d of hurt ) {
        const cut = Math.min(d.value, left);
        d.value -= cut;
        left -= cut;
      }
    }
  }
  return { damages: result, labels: mods.map(m => m.label) };
}

function previewAttack(outcome, cur, ac) {
  if ( outcome.type === "acBonus" ) {
    const newAc = ac + (Number(outcome.value) || 0);
    return (cur.isCritical || (cur.total >= newAc)) ? `AC ${newAc} — still hits` : `AC ${newAc} — <strong>the attack misses</strong>`;
  }
  if ( outcome.type === "damageNext" ) return outcome.mode === "reduce" ? "reduces the damage this attack deals"
    : `adds damage to this attack${outcome.critDouble && cur.isCritical ? " (critical: dice doubled)" : ""}`;
  return describeRollOutcome(outcome);
}

/**
 * A saving throw succeeded. Offers d20Succeeded to creatures that can react to the saver.
 * @param {{actor: Actor5e, roll: D20Roll, dc: number, label?: string}} state
 * @returns {Promise<{success: boolean, total: number, changed: boolean}>}
 */
export async function saveSucceeded(state) {
  const { roll, actor, dc } = state;
  let cur = { total: roll.total, isCritical: roll.isCritical, isFumble: roll.isFumble };
  const scene = tokenFor(actor)?.parent;
  const success = () => cur.total >= dc;
  let changed = false;
  for ( const reactor of candidates(scene).filter(a => a.uuid !== actor.uuid) ) {
    if ( !success() ) break;
    const opts = eligible(reactor, "d20Succeeded", { scene, subject: actor, data: { kind: state.kind ?? "save", total: cur.total, dc } });
    if ( !opts.length ) continue;
    const options = opts.map(o => ({ ...o.option, detail: describeRollOutcome(o.outcome) || o.detail }));
    const situation = `<strong>${actor.name}</strong> succeeds on ${state.label ?? "a saving throw"} (${cur.total} vs DC ${dc}).`;
    const { choice } = await ask(reactor, situation, options);
    const picked = opts.find(o => o.option.id === choice);
    if ( !picked ) continue;
    cur = await applyRollOutcome(picked.outcome, cur, roll, actor, reactor, picked.label);
    changed = true;
    await note(reactor, `<strong>${picked.label}</strong>: ${actor.name} ${success() ? "still succeeds" : "<strong>now fails</strong>"} `
      + `(${cur.total} vs DC ${dc}).`);
    await afterReaction(reactor, picked);
  }
  return { success: success(), total: cur.total, changed };
}

/**
 * A check failed against a known DC (Psi-Bolstered Knack, Bardic-style help). Offers d20Failed to the creature and
 * others; a modifyRoll outcome can turn it into a success. `refundUnlessSuccess: { item, uses }` gives back what the
 * reaction spent (uses of the item with that identifier) if the check still fails.
 * @param {{actor, roll, dc, label, data}} state   data: skill, tool, proficient…
 * @returns {Promise<{success: boolean, total: number, changed: boolean}>}
 */
export async function checkFailed(state) {
  const { roll, actor, dc } = state;
  let cur = { total: roll.total, isCritical: roll.isCritical, isFumble: roll.isFumble };
  const scene = tokenFor(actor)?.parent;
  const success = () => cur.total >= dc;
  let changed = false;
  for ( const reactor of [actor, ...candidates(scene).filter(a => a.uuid !== actor.uuid)] ) {
    if ( success() ) break;
    const opts = eligible(reactor, "d20Failed", { scene, subject: actor, data: { kind: "check", total: cur.total, dc, ...(state.data ?? {}) } });
    if ( !opts.length ) continue;
    const options = opts.map(o => ({ ...o.option, detail: describeRollOutcome(o.outcome) || o.detail }));
    const situation = `<strong>${actor.name}</strong> fails ${state.label ?? "a check"} (${cur.total} vs DC ${dc}).`;
    const { choice } = await ask(reactor, situation, options);
    const picked = opts.find(o => o.option.id === choice);
    if ( !picked ) continue;
    cur = await applyRollOutcome(picked.outcome, cur, roll, actor, reactor, picked.label);
    changed = true;
    const refund = picked.option.refund;
    if ( !success() && refund?.item ) {
      const pool = reactor.items.find(i => i.system.identifier === refund.item);
      if ( pool?.system.uses ) await pool.update({ "system.uses.spent": Math.max(0, (pool.system.uses.spent ?? 0) - (Number(refund.uses) || 1)) });
    }
    await note(reactor, `<strong>${picked.label}</strong>: ${actor.name} ${success() ? "<strong>now succeeds</strong>" : "still fails"} (${cur.total} vs DC ${dc})${!success() && refund ? " — nothing spent" : ""}.`);
    await afterReaction(reactor, picked);
  }
  return { success: success(), total: cur.total, changed };
}

/**
 * Damage is about to be applied. Offers damageIncoming to the creature (and "other" reactors in range, e.g. someone
 * shielding an ally). Resolves to the damages to apply.
 * @param {Actor5e} actor
 * @param {object[]} damages  DamageDescription[]
 */
/**
 * A reaction's follow-up activity (Deflect Attacks' redirect): the reactor's controller picks the creatures (they may
 * pick no one, which skips it — and its cost), then the activity is used on them there (its cost and the save
 * workflow apply as usual).
 */
async function afterUseActivity(reactor, item, after, subjectUuid, hitUuid) {
  const activity = (after.activity ? (item.system.activities.get(after.activity) ?? item.system.activities.getName(after.activity)) : null)
    ?? item.system.activities.contents[0];
  if ( !activity || !canAfford(activity) ) return;
  const subject = subjectUuid ? fromUuidSync(subjectUuid) : null;
  // to.who "hit": the creature the attack hit (hitting reactions).
  const hit = hitUuid ? fromUuidSync(hitUuid) : null;
  const recipients = (after.to?.who === "hit") ? (hit ? [hit] : []) : (after.to?.who === "self") ? [reactor]
    : await selectCreatures(reactor, after.to ?? { who: "choose" }, {
    subject, title: `${item.name} — choose`, prompt: `<p><strong>${activity.name || item.name}</strong>: choose a creature, or no one to skip.</p>`
  });
  if ( !recipients.length ) return;
  const user = controllerOf(reactor);
  const payload = { actorUuid: reactor.uuid, itemId: item.id, activityId: activity.id, targets: recipients.map(a => tokenFor(a)?.uuid).filter(Boolean) };
  if ( user && (user.id !== game.user.id) ) return runAs(user, "useActivityOn", payload);
  return HANDLERS.useActivityOn(payload);
}

/** On the controller's client: target these tokens and use the activity. */
HANDLERS.useActivityOn = async function({ actorUuid, itemId, activityId, targets }) {
  const actor = fromUuidSync(actorUuid);
  const activity = actor?.items.get(itemId)?.system.activities.get(activityId);
  if ( !activity || !actor.isOwner ) return false;
  const tokens = (targets ?? []).map(u => fromUuidSync(u)?.object).filter(Boolean);
  tokens.forEach((tk, i) => tk.setTarget(true, { releaseOthers: i === 0, groupSelection: i > 0 }));
  await activity.use({}, { configure: false }, {});
  return true;
};

export async function damageIncoming(actor, damages, { fromAttack=false }={}) {
  const scene = tokenFor(actor)?.parent;
  const total = damages.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
  if ( total <= 0 ) return damages;
  const types = Array.from(new Set(damages.map(d => d.type).filter(Boolean)));
  const result = damages.map(d => ({ ...d }));
  for ( const reactor of [actor, ...candidates(scene).filter(a => a.uuid !== actor.uuid)] ) {
    const opts = eligible(reactor, "damageIncoming", { scene, subject: actor, data: { kind: "damage", total, types, fromAttack } });
    if ( !opts.length ) continue;
    const options = opts.map(o => ({ ...o.option, detail: describeDamageOutcome(o.outcome) || o.detail }));
    const now = result.reduce((s, d) => s + d.value, 0);
    const situation = `<strong>${actor.name}</strong> is about to take ${now} damage (${types.join(", ") || "untyped"}).`;
    const { choice } = await ask(reactor, situation, options);
    const picked = opts.find(o => o.option.id === choice);
    if ( !picked ) continue;
    const outcome = picked.outcome;
    if ( outcome.type === "damage" ) {
      const matches = d => !outcome.types?.length || outcome.types.includes(d.type);
      if ( (outcome.mode === "half") || (outcome.mode === "resist") ) {
        result.forEach(d => { if ( matches(d) ) d.value = Math.floor(d.value / 2); });
      } else if ( outcome.mode === "reduce" ) {
        let left = await evalFormula(outcome.amount ?? 0, reactor);
        for ( const d of result ) {
          if ( !matches(d) || (left <= 0) ) continue;
          const cut = Math.min(d.value, left);
          d.value -= cut;
          left -= cut;
        }
      }
    }
    const left = result.reduce((s, d) => s + d.value, 0);
    await note(reactor, `<strong>${picked.label}</strong>: ${actor.name} takes ${left} instead of ${now}.`);
    await afterReaction(reactor, picked, { zeroed: left <= 0 });
  }
  return result;
}

function describeDamageOutcome(outcome) {
  if ( outcome.type !== "damage" ) return "";
  const which = outcome.types?.length ? `${outcome.types.join("/")} ` : "";
  if ( outcome.mode === "half" ) return `halves the ${which}damage`;
  if ( outcome.mode === "resist" ) return `resistance to ${which}damage`;
  if ( outcome.mode === "reduce" ) return `reduces the ${which}damage by ${outcome.amount}`;
  return "";
}

/**
 * A spell is about to be cast. Offers spellCast to creatures that can react. Resolves true if countered.
 * @param {Activity} activity
 */
export async function spellCast(activity) {
  const caster = activity.actor;
  const scene = tokenFor(caster)?.parent;
  if ( !caster || !scene ) return false;
  const props = activity.item.system.properties;
  const hasParts = ["vocal", "somatic", "material"].some(c => props?.has?.(c) ?? props?.includes?.(c));
  const subtle = caster.appliedEffects?.some(e => e.getFlag(MODULE_ID, "noComponents"));
  const data = {
    kind: "spell", level: activity.item.system.level, name: activity.item.name, identifier: activity.item.system.identifier,
    hasComponents: hasParts && !subtle
  };
  const targets = Array.from(game.user.targets ?? [], t => t.actor?.uuid).filter(Boolean);
  for ( const reactor of candidates(scene).filter(a => a.uuid !== caster.uuid) ) {
    const opts = eligible(reactor, "spellCast", { scene, subject: caster, data, targets });
    if ( !opts.length ) continue;
    const options = opts.map(o => ({ ...o.option, detail: (o.outcome.type === "counter")
      ? `${caster.name} must succeed on a ${(o.outcome.ability ?? "con").toUpperCase()} save or the spell fails` : o.detail }));
    const situation = `<strong>${caster.name}</strong> is casting <strong>${activity.item.name}</strong>.`;
    const { choice } = await ask(reactor, situation, options);
    const picked = opts.find(o => o.option.id === choice);
    if ( !picked ) continue;
    if ( picked.outcome.type !== "counter" ) {
      await afterReaction(reactor, picked);
      continue;
    }
    const ability = picked.outcome.ability ?? "con";
    const dc = ((picked.outcome.dc === undefined) || (picked.outcome.dc === "source"))
      ? reactor.system.attributes?.spell?.dc : Number(picked.outcome.dc);
    const rolls = await caster.rollSavingThrow({ ability, target: dc }, { configure: false }, {});
    const saved = (rolls?.[0]?.total ?? -Infinity) >= dc;
    await note(reactor, `<strong>${picked.label}</strong>: ${caster.name} ${saved ? "resists — the spell goes ahead"
      : "<strong>fails — the spell is countered</strong> (nothing spent)"} (DC ${dc}).`);
    await afterReaction(reactor, picked);
    if ( !saved ) return true;
  }
  return false;
}

/**
 * A d20 test was rolled with advantage or disadvantage and is about to be posted (nobody has seen it). Offers
 * d20Rolling to creatures that can react; a "straight" outcome keeps only the first of the two d20s.
 * Called from D20Roll.buildPost (main.mjs), on the roller's client.
 * @param {D20Roll[]} rolls
 * @param {object} config   dnd5e roll process config (subject = the actor, or the activity for attacks).
 * @param {object} message  dnd5e message config (message.data.flavor is the roll's title).
 */
export async function d20Rolling(rolls, config, message) {
  const roll = rolls?.[0];
  const d20 = roll?.dice?.[0];
  const mode = roll?.options?.advantageMode ?? 0;
  if ( !roll || !d20 || !mode || ((d20.results?.length ?? 0) < 2) || (config?.evaluate === false) ) return;
  const subject = config.subject instanceof Actor ? config.subject : config.subject?.actor;
  const scene = tokenFor(subject)?.parent;
  if ( !subject || !scene ) return;
  message.data = foundry.utils.expandObject(message.data ?? {});
  const what = message.data.flavor ? `<em>${message.data.flavor}</em>` : "a d20 roll";
  const data = { kind: config.hookNames?.[0] ?? "d20", advantage: mode > 0, disadvantage: mode < 0 };
  for ( const reactor of candidates(scene) ) {
    const opts = eligible(reactor, "d20Rolling", { scene, subject, data });
    if ( !opts.length ) continue;
    const options = opts.map(o => ({ ...o.option, detail: o.detail || (o.outcome.type === "straight"
      ? "the roll ignores advantage and disadvantage (the first of the two d20s counts)" : "") }));
    const situation = `<strong>${subject.name}</strong> is about to roll ${what} with <strong>${mode > 0 ? "advantage" : "disadvantage"}</strong>.`;
    const { choice } = await ask(reactor, situation, options);
    const picked = opts.find(o => o.option.id === choice);
    if ( !picked ) continue;
    if ( picked.outcome.type === "straight" ) {
      keepFirstD20(roll);
      message.data.flavor = `${message.data.flavor ?? ""} (${picked.label}: first of the 2 rolls kept)`.trim();
      await note(reactor, `<strong>${picked.label}</strong> was used on ${subject.name}'s roll: the first of the two d20s is kept.`);
    }
    await afterReaction(reactor, picked);
    break;
  }
}

/** Make a 2d20kh/kl roll count only its first d20. */
function keepFirstD20(roll) {
  const results = roll.dice[0].results;
  results.forEach((r, i) => {
    r.active = (i === 0);
    r.discarded = (i !== 0);
  });
  roll.options.advantageMode = 0;
  roll._total = roll._evaluateTotal();
}

/**
 * A token moved: offer Opportunity Attacks to hostile creatures whose reach it left. Built in — every melee weapon
 * attack of the reactor is offered, targeting the mover.
 * @param {TokenDocument} tokenDoc
 * @param {object} movement  Foundry's movement data (origin = where it started).
 */
export async function leavesReach(tokenDoc, movement) {
  if ( !setting("opportunityAttacks") ) return;
  const mover = tokenDoc.actor;
  const combat = game.combats.find(c => c.started && c.combatants.some(cb => cb.tokenId === tokenDoc.id));
  if ( !mover || !combat ) return;
  // 2024: only a creature leaving reach by its own movement (or action/reaction) provokes. Forced movement and
  // teleports don't: the engine's pushes, pulls, drags, placements (Shove Aside, Hurl) and teleports all move with
  // Foundry's "displace" action; "blink" is Foundry's teleport.
  const steps = movement.passed?.waypoints ?? [];
  if ( steps.length && steps.every(w => INVOLUNTARY_MOVES.has(w.action)) ) return;
  if ( INVOLUNTARY_MOVES.has(movement.passed?.action ?? movement.action) ) return;
  // Disengaged (status, an effect with the disengaged rule, or one named so): no Opportunity Attacks.
  if ( mover.statuses?.has("disengaged") || (mover.appliedEffects ?? []).some(e => e.getFlag(MODULE_ID, "disengaged") || /disengag/i.test(e.name)) ) return;
  const origin = movement.origin ?? {};
  for ( const cb of combat.combatants ) {
    const reactorToken = cb.token;
    const reactor = cb.actor;
    if ( !reactor || !reactorToken || (reactorToken.id === tokenDoc.id) || (reactorToken.parent !== tokenDoc.parent) ) continue;
    if ( reactorToken.disposition === tokenDoc.disposition ) continue;
    if ( NO_REACT.some(s => reactor.statuses?.has(s)) || reactionUsed(reactor) ) continue;
    const attacks = reactor.items.filter(i => i.type === "weapon").flatMap(item => item.system.activities
      .filter(a => (a.type === "attack") && (a.attack?.type?.value === "melee")).map(activity => ({ item, activity })));
    if ( !attacks.length ) continue;
    const reach = Math.max(5, ...attacks.map(({ item }) => item.system.range?.reach
      || (item.system.properties?.has("rch") ? 10 : 5)));
    const before = distanceFt(tokenDoc, reactorToken, origin);
    const after = distanceFt(tokenDoc, reactorToken);
    if ( !((before <= reach) && (after > reach)) ) continue;
    const options = attacks.map(({ item, activity }) => ({
      id: `${item.id}.${activity.id}`, label: `Opportunity Attack — ${item.name}${activity.name ? ` (${activity.name})` : ""}`,
      itemId: item.id, activityId: activity.id, targetUuid: tokenDoc.uuid, rollAttack: true
    }));
    // 2024: an Opportunity Attack can be an Unarmed Strike, and an Unarmed Strike can Grapple or Shove instead of damage.
    const unarmed = reactor.items.find(i => (i.type === "weapon") && ((i.system.identifier === "unarmed-strike") || /unarmed strike/i.test(i.name)));
    for ( const activity of unarmed?.system.activities?.filter(a => (a.type === "save") && /grapple|shove/i.test(a.name)) ?? [] ) {
      options.push({ id: `${unarmed.id}.${activity.id}`, label: `Opportunity Attack — ${activity.name} (Unarmed Strike)`,
        itemId: unarmed.id, activityId: activity.id, targetUuid: tokenDoc.uuid, rollAttack: false });
    }
    const answer = await ask(reactor, `<strong>${mover.name}</strong> leaves <strong>${reactor.name}</strong>'s reach.`, options);
    if ( answer?.choice && (answer.choice !== "skip") ) await stopIfHeld(tokenDoc, reactorToken, reach, movement);
  }
}

/** Foundry movement actions that aren't the creature moving itself (no Opportunity Attack). */
const INVOLUNTARY_MOVES = new Set(["displace", "blink"]);

/** Statuses that leave a creature with no speed (it can't finish a move it was making). */
const NO_SPEED = ["grappled", "restrained", "incapacitated", "paralyzed", "petrified", "stunned", "unconscious", "dead"];

/**
 * The Opportunity Attack happens as the mover leaves reach, but Foundry reports the move after it ended. If the
 * attack left the mover unable to move (an Unarmed Strike Grapple, or it dropped), put it back at the last point of its
 * path still within the reactor's reach — where it was when the attack interrupted it.
 */
async function stopIfHeld(tokenDoc, reactorToken, reach, movement) {
  // The attack's effects (a save's outcome) land a little after the reaction resolves.
  for ( let i = 0; i < 10; i++ ) {
    const actor = tokenDoc.actor;
    if ( NO_SPEED.some(s => actor?.statuses?.has(s)) || ((actor?.system.attributes?.hp?.value ?? 1) <= 0) ) break;
    if ( i === 9 ) return;
    await new Promise(r => setTimeout(r, 300));
  }
  const path = [movement.origin, ...(movement.passed?.waypoints ?? [])].filter(p => Number.isFinite(p?.x));
  const inReach = path.filter(p => distanceFt(tokenDoc, reactorToken, p) <= reach);
  const spot = inReach.at(-1) ?? movement.origin;
  if ( !spot || ((spot.x === tokenDoc._source.x) && (spot.y === tokenDoc._source.y)) ) return;
  await displaceToken(tokenDoc, { x: spot.x, y: spot.y }, "place");
}

/** Quick check: could anyone on the subject's scene react in this window? */
export function anyoneCouldReact(window, subject) {
  const scene = tokenFor(subject)?.parent;
  return candidates(scene).some(actor => eligible(actor, window, { scene, subject, data: {} }).length > 0);
}

export const api = { eligible, distanceFt, tokenFor, reactionUsed, markReactionUsed, candidates, controllerOf };
