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
 * Resolve a save activity against creatures.
 * @param {Activity} activity   The (scaled) activity that was used.
 * @param {Actor5e[]} targets
 * @param {object} [options]
 * @param {ChatMessage5e} [options.usage]    Its usage card (for effects).
 * @param {string} [options.label]
 */
export async function resolveSave(activity, targets, { usage=null, label, origin }={}) {
  const ability = activity.save?.ability?.first?.() ?? [...(activity.save?.ability ?? [])][0];
  const dc = activity.save?.dc?.value;
  if ( !ability || !Number.isFinite(dc) || !targets.length ) return;
  label ??= activity.item.name;

  // Saves, all at once.
  const statuses = (activity.effects ?? []).flatMap(p => Array.from(p.effect?.statuses ?? []));
  const results = await Promise.all(targets.map(async actor => ({ actor,
    ...(await rollSaveOutcome(actor, { ability, dc, advantage: hasSaveAdvantage(actor, statuses) }, label)) })));

  // Damage: one roll for everyone.
  let damages = null;
  let message = null;
  if ( activity.damage?.parts?.length ) {
    const onSave = activity.damage.onSave ?? "half";
    const hurt = results.filter(r => (r.total !== null) && (!r.success || (onSave !== "none")));
    if ( hurt.length ) {
      const rolls = await activity.rollDamage({}, { configure: false }, { data: {
        flavor: `${label} — damage`, system: { targets: hurt.flatMap(r => descriptors(r.actor)), ...(origin ? { origin } : {}) }
      } });
      message = game.messages.contents.at(-1);
      if ( rolls?.length ) damages = dnd5e.dice.aggregateDamageRolls(rolls, { respectProperties: true }).map(roll => ({
        value: Math.max(0, roll.total),
        type: roll.options.type, properties: Array.from(roll.options.properties ?? [])
      }));
    }
    const auto = deps.setting("triggerDamage") === "auto";
    for ( const r of results ) {
      if ( !damages || (r.total === null) ) continue;
      let mult = r.success ? ({ half: 0.5, none: 0, full: 1 }[onSave] ?? 0.5) : 1;
      if ( (onSave === "half") && hasEvasion(r.actor, ability) ) mult = r.success ? 0 : 0.5;
      r.multiplier = mult;
      if ( !mult || !auto ) continue;
      const scaled = damages.map(d => ({ ...d, value: Math.floor(d.value * mult) }));
      await deps.applyDamageAs(r.actor, scaled, activity, { messageId: message?.id });
    }
  }

  // Effects: on a failure; on a success only those marked "also on a successful save". With chooseEffects the user
  // picks which ones first (Command's order).
  if ( deps.setting("autoApplyEffects") && activity.effects?.length && usage ) {
    const chosen = (activity.flags?.[MODULE_ID]?.chooseEffects && results.some(r => (r.total !== null) && !r.success))
      ? await deps.chooseProfiles(activity) : activity.effects;
    for ( const r of results ) {
      if ( r.total === null ) continue;
      const profiles = chosen.filter(p => !r.success || p.onSave);
      if ( profiles.length ) await deps.autoApply(activity, r.actor, profiles, usage);
    }
  }

  await summary(activity, label, ability, dc, results);
}

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
export async function rollSaveFor(actor, { ability, dc, advantage=false, disadvantage=false, bonus=[] }, label) {
  const user = Creatures.controllerOf(actor);
  const spec = { ability, dc, advantage, disadvantage, bonus };
  const prompt = !user?.isGM && (deps.setting("wfTargetPC") === "prompt");
  if ( user && (user.id !== game.user.id) ) {
    const result = await Creatures.runAs(user, prompt ? "rollSavePrompt" : "rollSave", { actorUuid: actor.uuid, spec, label });
    return result?.total ?? null;
  }
  if ( prompt ) return (await Creatures.HANDLERS.rollSavePrompt({ actorUuid: actor.uuid, spec, label }))?.total ?? null;
  const rolls = await deps.rollSave(actor, spec);
  return rolls?.[0]?.total ?? null;
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
  const total = await rollSaveFor(actor, spec, label);
  if ( total === null ) return { total: null, success: false };
  let success = total >= spec.dc;
  if ( success && deps.setting("reactions") && deps.saveSucceeded ) {
    success = (await deps.saveSucceeded({ actor, roll: { total }, dc: spec.dc, label: `the save against ${label}` })).success;
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
  return rolls?.[0] ? { total: rolls[0].total } : null;
};

/** One chat card listing each creature's result (NPC totals are not shown to players). */
async function summary(activity, label, ability, dc, results) {
  const abilityLabel = CONFIG.DND5E.abilities[ability]?.label ?? ability;
  const rows = results.map(r => {
    const mark = r.total === null ? "—" : (r.success ? "✔ saved" : "✘ failed");
    const dmg = r.multiplier === undefined ? "" : (r.multiplier === 0 ? " · no damage" : (r.multiplier < 1 ? " · half damage" : " · full damage"));
    return `<li><strong>${foundry.utils.escapeHTML(Creatures.tokenFor(r.actor)?.name ?? r.actor.name)}</strong>: ${mark}${dmg}</li>`;
  }).join("");
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor: activity.actor }),
    content: `<div class="aet-summary"><p><strong>${foundry.utils.escapeHTML(label)}</strong> — ${abilityLabel} save, DC ${dc}</p><ul>${rows}</ul></div>`
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
  if ( (activity.type === "save") && (modeFor("Save", actor) === "auto") ) {
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
  if ( (activity.type === "attack") && (modeFor("Attack", actor) !== "off") && game.user.targets?.size ) {
    usageConfig.subsequentActions = false;
    activity.rollAttack({}, { configure: false }, { data: { system: { origin } } });
  }
});

/**
 * Attack workflow "full": after the engine has resolved which targets were hit (reactions included), roll damage once
 * and apply it to them. Called by the engine's attack handler.
 * @param {Activity} activity
 * @param {Actor5e[]} hit
 * @param {D20Roll} roll
 */
export async function attackLanded(activity, hit, roll) {
  if ( !hit.length || (modeFor("Attack", activity.actor) !== "full") ) return;
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
  return modeFor("Attack", activity?.actor) === "full";
}
