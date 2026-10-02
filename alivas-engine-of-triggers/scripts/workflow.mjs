/**
 * Alivas's Engine of Triggers — automated resolution of attacks and saving throws.
 *
 * Save activities (Toll the Dead, a monster's breath, and — through its automated area, see areas.mjs — Fireball):
 * the targets roll their saves — NPCs on the GM's client, player characters on their player's (a popup, or
 * automatically) — damage is rolled once and applied per result (Evasion included), effects go on those who failed, and
 * a summary card is posted. Attack activities: the attack is rolled as soon as the activity is used, and
 * (full) damage is rolled and applied to the creatures it hit.
 *
 * Each part is a world setting, separately for creatures a player owns and for NPCs.
 */

import * as Creatures from "./creatures.mjs";
import { wantsArea } from "./areas.mjs";

const MODULE_ID = "alivas-engine-of-triggers";
let deps = {};

/**
 * @param {object} d
 * @param {Function} d.autoApply      (activity, actor, profiles, usage) → apply effect profiles.
 * @param {Function} d.rollSave       (actor, spec) → rolls
 * @param {Function} d.applyDamageAs  (actor, damages, activity, options) → apply damage (GM relay when needed).
 * @param {Function} d.setting        key → value
 */
export function initWorkflow(d) {
  deps = d;
}

/** "pc" for creatures a player owns (their summons included), "npc" otherwise. */
export function sideOf(actor) {
  return actor?.hasPlayerOwner ? "pc" : "npc";
}

/** The workflow mode for this actor: settings wfSave{PC,NPC} / wfAttack{PC,NPC}. */
export function modeFor(kind, actor) {
  const key = `wf${kind}${sideOf(actor) === "pc" ? "PC" : "NPC"}`;
  try { return deps.setting(key); } catch(err) { return "off"; }
}

/* -------------------------------------------- */
/*  Targets                                     */
/* -------------------------------------------- */

/** The user's current targets, as actors (areas find their own creatures — see areas.mjs). */
export function targetsOf() {
  return Array.from(game.user.targets ?? [], token => token.actor).filter((a, i, all) => a && (all.indexOf(a) === i));
}

/* -------------------------------------------- */
/*  Saves                                       */
/* -------------------------------------------- */

/**
 * Resolve a save activity against creatures, as far as the save workflow mode (setting wfSave{PC,NPC}, by the user's
 * side) says:
 *   auto   saves rolled, damage rolled once and applied per result, effects on those who failed, a summary card
 *   roll   saves rolled and the damage rolled (its card lists the creatures); applying damage and effects is left to the
 *          chat cards (dnd5e's Apply buttons, with their ×½ / resistance options)
 *   apply  nothing rolled for the creatures: they roll from the chat card's save button (or their sheet, linked to the
 *          card); each result, as it comes in, gets its damage (rolled once, now) and effects — see pending saves below
 *   off    (callers outside the activity workflow — triggers, attack riders) behave as auto
 * @param {Activity} activity
 * @param {Actor5e[]} targets
 * @param {{usage?: ChatMessage, label?: string, origin?: string}} [options]
 */
export async function resolveSave(activity, targets, { usage=null, label, origin }={}) {
  const ability = activity.save?.ability?.first?.() ?? [...(activity.save?.ability ?? [])][0];
  const dc = activity.save?.dc?.value;
  if ( !ability || !Number.isFinite(dc) || !targets.length ) return;
  label ??= activity.item.name;
  const mode = modeFor("Save", activity.actor);
  if ( (mode === "apply") && usage ) return pendSaves(activity, targets, { usage, label, origin, ability, dc });

  // Saves, all at once.
  const statuses = (activity.effects ?? []).flatMap(p => Array.from(p.effect?.statuses ?? []));
  const results = await Promise.all(targets.map(async actor => ({ actor,
    ...(await rollSaveOutcome(actor, { ability, dc, advantage: hasSaveAdvantage(actor, statuses) }, label)) })));
  const rolled = results.filter(r => r.total !== null);

  // Damage: one roll for everyone it can hurt.
  const onSave = activity.damage?.onSave ?? "half";
  const hurt = rolled.filter(r => !r.success || (onSave !== "none"));
  const { damages, message } = await rollSaveDamage(activity, hurt.map(r => r.actor), { label, origin });
  for ( const r of rolled ) r.multiplier = damages ? saveMultiplier(r.actor, r.success, onSave, ability) : undefined;

  if ( mode !== "roll" ) {
    const chosen = (activity.flags?.[MODULE_ID]?.chooseEffects && rolled.some(r => !r.success))
      ? await deps.chooseProfiles(activity) : activity.effects;
    for ( const r of rolled ) await applySaveOutcome(activity, r.actor, r.success, { damages, message, usage, chosen, onSave, ability });
  }
  await summary(activity, label, ability, dc, results, mode === "roll");
}

/** Roll a save activity's damage once, its card targeting those creatures. → { damages, message } */
async function rollSaveDamage(activity, actors, { label, origin }={}) {
  if ( !activity.damage?.parts?.length || !actors.length ) return { damages: null, message: null };
  const rolls = await activity.rollDamage({}, { configure: false }, { data: {
    flavor: `${label ?? activity.item.name} — damage`,
    system: { targets: actors.flatMap(descriptors), ...(origin ? { origin } : {}) }
  } });
  const message = game.messages.contents.at(-1);
  const damages = rolls?.length ? dnd5e.dice.aggregateDamageRolls(rolls, { respectProperties: true }).map(roll => ({
    value: Math.max(0, roll.total), type: roll.options.type, properties: Array.from(roll.options.properties ?? [])
  })) : null;
  return { damages, message };
}

/** The share of the damage a creature takes: by the save's result, the activity's "on a save", and Evasion. */
function saveMultiplier(actor, success, onSave, ability) {
  let mult = success ? ({ half: 0.5, none: 0, full: 1 }[onSave] ?? 0.5) : 1;
  if ( (onSave === "half") && hasEvasion(actor, ability) ) mult = success ? 0 : 0.5;
  return mult;
}

/**
 * Apply one creature's save outcome: its share of the damage (setting triggerDamage "auto"), and the effects — on a
 * failure all of them, on a success only those marked "also on a successful save".
 */
async function applySaveOutcome(activity, actor, success, { damages, message, usage, chosen, onSave, ability }) {
  if ( damages && (deps.setting("triggerDamage") === "auto") ) {
    const mult = saveMultiplier(actor, success, onSave ?? activity.damage?.onSave ?? "half", ability);
    if ( mult ) await deps.applyDamageAs(actor, damages.map(d => ({ ...d, value: Math.floor(d.value * mult) })), activity,
      { messageId: message?.id });
  }
  if ( deps.setting("autoApplyEffects") && activity.effects?.length && usage ) {
    const profiles = (chosen ?? activity.effects).filter(p => !success || p.onSave);
    if ( profiles.length ) await deps.autoApply(activity, actor, profiles, usage);
  }
}

/* -------------------------------------------- */
/*  Pending saves (mode "apply")                */
/* -------------------------------------------- */

/**
 * Mode "apply": roll the damage now, and remember on the usage card who still owes a save. The lead GM applies each
 * result as the save roll comes in (a save message whose system.origin is the usage card — dnd5e's save button does
 * that). The first result per creature counts.
 *   flags.alivas-engine-of-triggers.pendingSave = { activity, targets: [actorUuid], done: [actorUuid], ability, dc,
 *     onSave, damages, damageMessage, chosen: [effect profile ids] | null, label }
 */
async function pendSaves(activity, targets, { usage, label, origin, ability, dc }) {
  const onSave = activity.damage?.onSave ?? "half";
  const { damages, message } = await rollSaveDamage(activity, targets, { label, origin });
  const chosen = activity.flags?.[MODULE_ID]?.chooseEffects ? (await deps.chooseProfiles(activity)).map(p => p._id ?? p.id) : null;
  const pending = { activity: activity.uuid, targets: targets.map(a => a.uuid), done: [], ability, dc, onSave, damages,
    damageMessage: message?.id ?? null, chosen, label };
  await usage.setFlag(MODULE_ID, "pendingSave", pending);
  const names = targets.map(a => foundry.utils.escapeHTML(Creatures.tokenFor(a)?.name ?? a.name)).join(", ");
  const abilityLabel = CONFIG.DND5E.abilities[ability]?.label ?? ability;
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor: activity.actor }),
    content: `<div class="aet-summary"><p><strong>${foundry.utils.escapeHTML(label)}</strong> — ${abilityLabel} save, DC ${dc}</p>
      <p>Waiting for saves from: ${names}. Roll them from the spell's card; damage and effects apply as each result comes in.</p></div>`
  });
}

/** A save roll arrived (lead GM): if it answers a pending save, apply that creature's outcome. */
async function onSaveMessage(message) {
  if ( !Creatures.isLeadGM() ) return;
  const roll = message.rolls?.[0];
  // dnd5e resolves system.origin to the message document; older cards use a flag with its id.
  const origin = message.system?.origin ?? message.flags?.dnd5e?.originatingMessage;
  const originId = typeof origin === "string" ? origin : (origin?.id ?? null);
  const isSave = (message.type === "save") || (message.flags?.dnd5e?.roll?.type === "save");
  if ( !roll || !originId || !isSave ) return;
  const usage = game.messages.get(originId);
  const pending = usage?.getFlag(MODULE_ID, "pendingSave");
  if ( !pending ) return;
  const actor = ChatMessage.implementation.getSpeakerActor(message.speaker);
  if ( !actor || !pending.targets.includes(actor.uuid) || pending.done.includes(actor.uuid) ) return;
  const ability = message.system?.ability ?? message.flags?.dnd5e?.roll?.ability;
  if ( ability && (ability !== pending.ability) ) return;
  await usage.setFlag(MODULE_ID, "pendingSave.done", [...pending.done, actor.uuid]);
  const activity = await fromUuid(pending.activity);
  if ( !activity ) return;
  const success = roll.isSuccess ?? (roll.total >= pending.dc);
  const chosen = pending.chosen ? activity.effects.filter(p => pending.chosen.includes(p._id ?? p.id)) : activity.effects;
  await applySaveOutcome(activity, actor, success, { damages: pending.damages, message: game.messages.get(pending.damageMessage),
    usage, chosen, onSave: pending.onSave, ability: pending.ability });
}

Hooks.on("createChatMessage", message => { onSaveMessage(message); });

/**
 * Effect rule `evasion: [abilities]` (Evasion): against those saves that halve damage, the bearer takes none on a
 * success and half on a failure — not while Incapacitated.
 */
export function hasEvasion(actor, ability) {
  if ( !actor || actor.statuses?.has("incapacitated") ) return false;
  return (actor.appliedEffects ?? []).some(e => (e.getFlag?.(MODULE_ID, "evasion") ?? []).includes(ability));
}

/**
 * Effect rule `saveAdvantageAgainst: [statusIds]` (Dwarven Resilience: poisoned): advantage on saves against
 * something that would give one of those conditions.
 */
export function hasSaveAdvantage(actor, statuses=[]) {
  if ( !statuses.length ) return false;
  return (actor?.appliedEffects ?? []).some(e => (e.getFlag?.(MODULE_ID, "saveAdvantageAgainst") ?? []).some(s => statuses.includes(s)));
}

/**
 * A healing formula as rolled by this healer: with the healingExtraDie rule, its first die term rolls one more die and
 * keeps the rest (1d8 → 2d8kh1, 2d4 → 3d4kh2).
 */
export function healingDieFormula(healer, formula) {
  if ( !(healer?.appliedEffects ?? []).some(e => e.getFlag?.(MODULE_ID, "healingExtraDie")) ) return formula;
  return String(formula).replace(/(\d*)d(\d+)(?![\dkK])/, (m, n, x) => `${(Number(n) || 1) + 1}d${x}kh${Number(n) || 1}`);
}

/** Trigger save damage spec with Evasion applied for this creature (see saveDamage). */
export function withEvasion(spec, actor, ability) {
  if ( !spec || (spec.onSuccess !== "half") || !hasEvasion(actor, ability) ) return spec;
  return { ...spec, evasion: true };
}

function descriptors(actor) {
  const token = Creatures.tokenFor(actor)?.object;
  const TargetsField = dnd5e.dataModels.chatMessage.fields.TargetsField;
  return token ? TargetsField.getDescriptors([token]) : [];
}

/**
 * Roll a save for a creature on its controller's client: a connected player gets a popup (setting wfTargetPC "prompt")
 * that rolls by itself after the reaction timeout; NPCs are rolled on the GM's client.
 * @returns {Promise<number|null>} the total
 */
export async function rollSaveFor(actor, spec, label) {
  return (await rollSaveResult(actor, spec, label))?.total ?? null;
}

/** The same, keeping the d20's face too (rerolls need it): { total, d20 } or null. */
async function rollSaveResult(actor, { ability, dc, advantage=false, disadvantage=false, bonus=[] }, label) {
  const user = Creatures.controllerOf(actor);
  const spec = { ability, dc, advantage, disadvantage, bonus };
  const prompt = !user?.isGM && (deps.setting("wfTargetPC") === "prompt");
  if ( user && (user.id !== game.user.id) ) {
    return await Creatures.runAs(user, prompt ? "rollSavePrompt" : "rollSave", { actorUuid: actor.uuid, spec, label }) ?? null;
  }
  if ( prompt ) return (await Creatures.HANDLERS.rollSavePrompt({ actorUuid: actor.uuid, spec, label })) ?? null;
  const rolls = await deps.rollSave(actor, spec);
  return rolls?.[0] ? { total: rolls[0].total, d20: rolls[0].d20?.total ?? rolls[0].dice?.[0]?.total ?? null } : null;
}

/**
 * Roll a save the one way the engine does it — on the creature's controller's client (popup or automatic) — and give
 * reactions (Silvery Barbs…) a chance to turn a success into a failure.
 * @param {Actor5e} actor
 * @param {{ability, dc, advantage?, disadvantage?, bonus?}} spec
 * @param {string} label   What the save is against (for popups and reactions).
 * @returns {Promise<{total: number|null, success: boolean}>}
 */
export async function rollSaveOutcome(actor, spec, label) {
  const result = await rollSaveResult(actor, spec, label);
  const total = result?.total ?? null;
  if ( total === null ) return { total: null, success: false };
  let success = total >= spec.dc;
  if ( success && deps.setting("reactions") && deps.saveSucceeded ) {
    success = (await deps.saveSucceeded({ actor, roll: { total, d20: result.d20 }, dc: spec.dc, label: `the save against ${label}` })).success;
  }
  return { total, success };
}

/** A player's save popup: Roll / Advantage / Disadvantage; rolls normally by itself after the reaction timeout. */
Creatures.HANDLERS.rollSavePrompt = async function({ actorUuid, spec, label }) {
  const actor = fromUuidSync(actorUuid);
  if ( !actor?.isOwner ) return null;
  const abilityLabel = CONFIG.DND5E.abilities[spec.ability]?.label ?? spec.ability;
  const seconds = Number(deps.setting("reactionTimeout")) || 0;
  let dialog = null;
  let timer = null;
  const choice = await new Promise(resolve => {
    foundry.applications.api.DialogV2.wait({
      window: { title: `${actor.name} — ${abilityLabel} save` }, position: { width: 380 }, rejectClose: false,
      content: `<p><strong>${foundry.utils.escapeHTML(label ?? "")}</strong>: ${abilityLabel} saving throw, DC ${spec.dc}${spec.advantage && !spec.disadvantage ? " (with advantage)" : (spec.disadvantage && !spec.advantage ? " (with disadvantage)" : "")}.</p>
        ${seconds ? `<p class="hint">Rolls by itself in ${seconds} s.</p>` : ""}`,
      render: (event, app) => { dialog = app; },
      buttons: [
        { action: "normal", label: "Roll", icon: "fa-solid fa-dice-d20", default: true },
        { action: "advantage", label: "Advantage", icon: "fa-solid fa-angles-up" },
        { action: "disadvantage", label: "Disadvantage", icon: "fa-solid fa-angles-down" }
      ]
    }).then(r => resolve(r ?? "normal"));
    if ( seconds ) timer = setTimeout(() => { dialog?.close(); resolve("normal"); }, seconds * 1000);
  });
  if ( timer ) clearTimeout(timer);
  const rolls = await deps.rollSave(actor, { ...spec, advantage: !!spec.advantage || (choice === "advantage"),
    disadvantage: !!spec.disadvantage || (choice === "disadvantage") });
  return rolls?.[0] ? { total: rolls[0].total, d20: rolls[0].d20?.total ?? rolls[0].dice?.[0]?.total ?? null } : null;
};

/** One chat card listing each creature's result (NPC totals are not shown to players). */
async function summary(activity, label, ability, dc, results, manual=false) {
  const abilityLabel = CONFIG.DND5E.abilities[ability]?.label ?? ability;
  const rows = results.map(r => {
    const mark = r.total === null ? "—" : (r.success ? "✔ saved" : "✘ failed");
    const dmg = r.multiplier === undefined ? "" : (r.multiplier === 0 ? " · no damage" : (r.multiplier < 1 ? " · half damage" : " · full damage"));
    return `<li><strong>${foundry.utils.escapeHTML(Creatures.tokenFor(r.actor)?.name ?? r.actor.name)}</strong>: ${mark}${dmg}</li>`;
  }).join("");
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor: activity.actor }),
    content: `<div class="aet-summary"><p><strong>${foundry.utils.escapeHTML(label)}</strong> — ${abilityLabel} save, DC ${dc}</p><ul>${rows}</ul>${manual ? "<p>Apply the damage and effects from the cards.</p>" : ""}</div>`
  });
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/* -------------------------------------------- */
/*  Follow-up attacks                           */
/* -------------------------------------------- */

const followUps = new Map();   // actor uuid → turn key of the Extra Attack already offered

/**
 * Offer more attacks after one (Extra Attack, Flurry of Blows' second strike): for each, the user picks what to attack
 * with (or a swap such as Hand of Healing) and a target, then it's used as a free follow-up (no resources spent).
 * @param {Actor5e} actor
 * @param {object} spec
 * @param {number} spec.count            How many more.
 * @param {Activity[]} spec.activities   What each can be made with.
 * @param {string} spec.label
 * @param {Activity} [spec.swap]         An alternative (e.g. a heal) usable instead of one of them, free.
 */
export async function followUpAttacks(actor, { count, activities, label, swap=null }) {
  let swapLeft = !!swap;
  for ( let i = 0; i < count; i++ ) {
    const choices = activities.map(a => ({ value: a.uuid, label: a.item.name + (a.name && (a.name !== a.item.name) && !/^attack$/i.test(a.name) ? ` — ${a.name}` : "") }));
    if ( swapLeft ) choices.push({ value: swap.uuid, label: `${swap.item.name} instead` });
    choices.push({ value: "none", label: "Done" });
    const pick = choices.length === 2 ? choices[0].value : await Creatures.HANDLERS.pickOption({ title: `${label} — ${actor.name}`,
      prompt: `<p><strong>${label}</strong>: attack ${i + 1} of ${count} — with what?</p>`, options: choices });
    if ( !pick || (pick === "none") ) return;
    const activity = fromUuidSync(pick);
    if ( !activity ) return;
    const healing = activity === swap;
    if ( healing ) swapLeft = false;
    const reach = Math.max(5, activity.item.system.range?.reach ?? activity.range?.reach ?? 5);
    const [target] = await Creatures.selectCreatures(actor, { who: "choose", side: healing ? "ally" : "enemy",
      range: healing ? (activity.range?.value || 5) : reach }, { title: `${label} — target` });
    if ( !target ) return;
    Creatures.tokenFor(target)?.object?.setTarget(true, { releaseOthers: true });
    await activity.use({ consume: { resources: false, spellSlot: false }, [MODULE_ID]: { followUp: true } }, { configure: false }, {});
  }
}

Hooks.on("dnd5e.postUseActivity", (activity, usageConfig) => {
  const actor = activity?.actor;
  if ( !actor?.isOwner || usageConfig?.[MODULE_ID]?.followUp || (activity.type !== "attack") ) return;
  // Activity flag repeat: { count, swap: identifier } (Flurry of Blows: two strikes, one may be Hand of Healing).
  const repeat = activity.flags?.[MODULE_ID]?.repeat;
  if ( repeat?.count > 1 ) {
    const swapItem = repeat.swap ? actor.items.find(i => i.system.identifier === repeat.swap) : null;
    const swap = swapItem?.system.activities.find(a => ["heal", "utility"].includes(a.type)) ?? null;
    setTimeout(() => followUpAttacks(actor, { count: repeat.count - 1, activities: [activity], label: activity.item.name, swap }), 1500);
    return;
  }
  // Effect rule extraAttack: { count } — after an attack made with the Attack action, once per turn.
  const extra = (actor.appliedEffects ?? []).map(e => e.getFlag(MODULE_ID, "extraAttack")?.count ?? 0).reduce((a, b) => Math.max(a, b), 0);
  if ( !extra || (activity.activation?.type !== "action") ) return;
  const combat = game.combats.find(c => c.started && c.combatants.some(cb => cb.actor?.uuid === actor.uuid || cb.actorId === actor.id));
  const turn = combat ? `${combat.id}:${combat.round}:${combat.turn}` : null;
  if ( turn && (followUps.get(actor.uuid) === turn) ) return;
  if ( turn ) followUps.set(actor.uuid, turn);
  const activities = actor.items.filter(i => ["weapon"].includes(i.type) && (i.system.equipped !== false || i.system.identifier === "unarmed-strike"))
    .flatMap(i => i.system.activities.filter(a => (a.type === "attack") && (a.activation?.type === "action")));
  setTimeout(() => followUpAttacks(actor, { count: extra, activities, label: "Extra Attack" }), 1500);
});

// Runs synchronously first: where the workflow takes over, dnd5e's own follow-up roll (attack dialog, save damage) is
// switched off (dnd5e checks usageConfig.subsequentActions right after this hook).
Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => {
  const actor = activity?.actor;
  if ( !actor?.isOwner || usageConfig?.[MODULE_ID]?.noWorkflow ) return;
  const origin = results?.message?.id;
  if ( (activity.type === "save") && (modeFor("Save", actor) !== "off") ) {
    const regions = results?.templates ?? [];
    // A placed area resolves itself (areas.mjs: "when it appears"); only targeted saves are handled here.
    if ( regions.length && wantsArea(activity) ) {
      usageConfig.subsequentActions = false;
      return;
    }
    const targets = targetsOf();
    if ( !targets.length ) return;
    usageConfig.subsequentActions = false;
    resolveSave(activity, targets, { usage: results?.message ?? null, origin });
    return;
  }
  // Healing (setting wfHeal): roll it and apply it to the targets, or the user if no one is targeted.
  if ( (activity.type === "heal") && deps.setting("wfHeal") && activity.healing ) {
    usageConfig.subsequentActions = false;
    const targets = targetsOf();
    applyHealing(activity, targets.length ? targets : [actor], origin);
    return;
  }
  // Modes "attack" and "full" roll the attack themselves; "damage" leaves the attack roll to the player (dnd5e as usual).
  if ( (activity.type === "attack") && ["attack", "full"].includes(modeFor("Attack", actor)) && game.user.targets?.size ) {
    usageConfig.subsequentActions = false;
    activity.rollAttack({}, { configure: false }, { data: { system: { origin } } });
  }
});

/**
 * Attack workflow "full" / "damage": after the engine has resolved which targets were hit (reactions included), roll damage once
 * and apply it to them. Called by the engine's attack handler.
 * @param {Activity} activity
 * @param {Actor5e[]} hit
 * @param {D20Roll} roll
 */
export async function attackLanded(activity, hit, roll) {
  if ( !hit.length || !rollsDamageOnHit(activity) ) return;
  await rollHitDamage(activity, hit, roll);
  // Riders: the item's save activities with no activation of their own ("…it must make a DC 10 Con save") run
  // against each creature hit.
  const riders = activity.item.system.activities.filter(a => (a.id !== activity.id) && (a.type === "save") && !a.activation?.type);
  for ( const rider of riders ) {
    await resolveSave(rider, hit, { usage: deps.findUsageMessage?.(activity) ?? null, label: activity.item.name });
  }
}

async function rollHitDamage(activity, hit, roll) {
  if ( !activity.damage?.parts?.length ) return;
  // The attack's mode (two-handed, off-hand, thrown…) carries over: versatile damage and mode-based rules depend on it.
  const mode = { isCritical: !!roll?.isCritical };
  if ( roll?.options?.attackMode ) mode.attackMode = roll.options.attackMode;
  const rolls = await activity.rollDamage(mode, { configure: false }, { data: {
    system: { targets: hit.flatMap(descriptors) }
  } });
  if ( !rolls?.length || (deps.setting("triggerDamage") !== "auto") ) return;
  const message = game.messages.contents.at(-1);
  const damages = dnd5e.dice.aggregateDamageRolls(rolls, { respectProperties: true }).map(r => ({
    value: Math.max(0, r.total),
    type: r.options.type, properties: Array.from(r.options.properties ?? [])
  }));
  for ( const actor of hit ) await deps.applyDamageAs(actor, damages, activity, { messageId: message?.id });
}

/** Roll a heal activity once and apply it to each creature (the damage pipeline runs, so "can't regain HP" counts). */
async function applyHealing(activity, recipients, origin) {
  const rolls = await activity.rollDamage({}, { configure: false }, { data: {
    system: { targets: recipients.flatMap(descriptors), ...(origin ? { origin } : {}) } } });
  if ( !rolls?.length || (deps.setting("triggerDamage") !== "auto") ) return;
  const message = game.messages.contents.at(-1);
  const damages = dnd5e.dice.aggregateDamageRolls(rolls, { respectProperties: true })
    .map(r => ({ value: Math.max(0, r.total), type: r.options.type, properties: Array.from(r.options.properties ?? []) }));
  for ( const actor of recipients ) await deps.applyDamageAs(actor, damages, activity, { messageId: message?.id });
}

/** Does this attack's damage get rolled by the workflow (so other code shouldn't roll it too)? */
export function rollsDamageOnHit(activity) {
  return ["full", "damage"].includes(modeFor("Attack", activity?.actor));
}
