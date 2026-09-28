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
  const results = await Promise.all(targets.map(async actor => ({ actor, ...(await rollSaveOutcome(actor, { ability, dc }, label)) })));

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
        value: Math.max(0, roll.total) * ((roll.options.type in CONFIG.DND5E.healingTypes) ? -1 : 1),
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

  // Effects: on a failure; on a success only those marked "also on a successful save".
  if ( deps.setting("autoApplyEffects") && activity.effects?.length && usage ) {
    for ( const r of results ) {
      if ( r.total === null ) continue;
      const profiles = activity.effects.filter(p => !r.success || p.onSave);
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
  const rolls = await activity.rollDamage({ isCritical: !!roll?.isCritical }, { configure: false }, { data: {
    system: { targets: hit.flatMap(descriptors) }
  } });
  if ( !rolls?.length || (deps.setting("triggerDamage") !== "auto") ) return;
  const message = game.messages.contents.at(-1);
  const damages = dnd5e.dice.aggregateDamageRolls(rolls, { respectProperties: true }).map(r => ({
    value: Math.max(0, r.total) * ((r.options.type in CONFIG.DND5E.healingTypes) ? -1 : 1),
    type: r.options.type, properties: Array.from(r.options.properties ?? [])
  }));
  for ( const actor of hit ) await deps.applyDamageAs(actor, damages, activity, { messageId: message?.id });
}

/** Does this attack's damage get rolled by the workflow (so other code shouldn't roll it too)? */
export function rollsDamageOnHit(activity) {
  return modeFor("Attack", activity?.actor) === "full";
}
