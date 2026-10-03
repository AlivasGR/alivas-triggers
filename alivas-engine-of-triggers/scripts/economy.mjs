/**
 * Alivas's Engine of Triggers — action economy (2024): what a creature has spent on its turn in a started combat.
 *
 * Kinds tracked per combat turn of the creature (combatant flag `economy` = { key, action, bonus, interaction }):
 *   action       its Action (any activity with an "action" activation marks it; Utilize spends it)
 *   bonus        its Bonus Action (activities with a "bonus" activation mark it)
 *   interaction  its one free object interaction (drawing, handing over, retrieving needs Utilize — see below)
 * The reaction is tracked by reactions.mjs (reactionUsed / markReactionUsed) and is not repeated here.
 *
 * Outside a started combat nothing is spent and every helper says "go ahead". Off its own turn a creature has no Action,
 * Bonus Action or free interaction: the helpers ask the user to confirm (a GM ruling) instead of refusing outright.
 *
 * API (engine api.economy):
 *   inCombat(actor), isTurnOf(actor)
 *   used(actor, kind) → boolean;  mark(actor, kind) → Promise
 *   spend(actor, kind, { label }) → Promise<boolean>             spend it, or ask/refuse when it's gone
 *   spendInteraction(actor, { label }) → Promise<boolean>        free interaction, else Utilize (the Action)
 *   spendUtilize(actor, { label, fastHands }) → Promise<boolean> the Action; with fastHands, a Thief's Fast Hands lets
 *                                                                 the Bonus Action do it instead
 *   hasFastHands(actor)
 */

import * as Creatures from "./creatures.mjs";

const MODULE_ID = "alivas-engine-of-triggers";
const KINDS = ["action", "bonus", "interaction"];
const KIND_LABEL = { action: "Action", bonus: "Bonus Action", interaction: "free object interaction" };
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/** The started combat this actor is in, and its combatant. */
function combatantOf(actor) {
  if ( !actor ) return {};
  for ( const combat of game.combats ) {
    if ( !combat.started ) continue;
    const c = combat.getCombatantsByActor?.(actor)?.[0]
      ?? combat.combatants.find(cb => (cb.actorId === actor.id) || (cb.token?.actor === actor));
    if ( c ) return { combat, combatant: c };
  }
  return {};
}

export const inCombat = actor => !!combatantOf(actor).combatant;

/** Is it this creature's turn in its combat? */
export function isTurnOf(actor) {
  const { combat, combatant } = combatantOf(actor);
  return !!combatant && (combat.combatant?.id === combatant.id);
}

/** The key of the creature's current (or last) own turn: spending is only remembered for that turn. */
function turnKey(combat, combatant) {
  return `${combat.id}:${combat.round}:${combatant.id}`;
}

function state(actor) {
  const { combat, combatant } = combatantOf(actor);
  if ( !combatant ) return null;
  const flag = combatant.getFlag(MODULE_ID, "economy");
  const key = turnKey(combat, combatant);
  return { combat, combatant, key, flag: (flag?.key === key) ? flag : { key } };
}

/** Has the creature used this kind on its current turn? (Off its turn: true — it has none to use.) */
export function used(actor, kind) {
  const s = state(actor);
  if ( !s ) return false;
  if ( !isTurnOf(actor) ) return true;
  return !!s.flag[kind];
}

/** Mark a kind used for the creature's current turn (written by an owner, or the GM on a player's behalf). */
export async function mark(actor, kind) {
  if ( !KINDS.includes(kind) ) return;
  const s = state(actor);
  if ( !s ) return;
  const value = { ...s.flag, key: s.key, [kind]: true };
  if ( s.combatant.isOwner ) return s.combatant.setFlag(MODULE_ID, "economy", value);
  const gm = game.users.activeGM;
  if ( gm ) await Creatures.runAs(gm, "economyMark", { combatantUuid: s.combatant.uuid, value });
}

Creatures.HANDLERS.economyMark = async function({ combatantUuid, value }) {
  const c = fromUuidSync(combatantUuid);
  if ( c ) await c.setFlag(MODULE_ID, "economy", value);
  return true;
};

async function confirm(title, html) {
  return !!(await foundry.applications.api.DialogV2.confirm({ window: { title }, content: html, rejectClose: false }));
}

/**
 * Spend a kind. Outside combat: true. On the creature's turn with it unused: marks it, true. Already used, or not its
 * turn: the user may confirm anyway (the GM's call), else false.
 */
export async function spend(actor, kind, { label="" }={}) {
  if ( !inCombat(actor) ) return true;
  const what = KIND_LABEL[kind] ?? kind;
  if ( !isTurnOf(actor) ) {
    if ( !(await confirm(`${actor.name} — ${label || what}`,
      `<p>It isn't <strong>${esc(actor.name)}</strong>'s turn, so it has no ${esc(what)} to spend${label ? ` on <em>${esc(label)}</em>` : ""}. Do it anyway?</p>`)) ) return false;
    return true;
  }
  if ( used(actor, kind) ) {
    return confirm(`${actor.name} — ${label || what}`,
      `<p><strong>${esc(actor.name)}</strong> has already used its ${esc(what)} this turn. Do it anyway?</p>`);
  }
  await mark(actor, kind);
  return true;
}

/** A Thief's Fast Hands: the Bonus Action can take the Utilize action (and make Sleight of Hand checks). */
export function hasFastHands(actor) {
  return !!actor?.items?.some(i => (i.system?.identifier === "fast-hands") || /^fast hands$/i.test(i.name ?? ""));
}

/**
 * The Utilize action. With `fastHands` (default true) a creature with Fast Hands may use its Bonus Action instead:
 * it's chosen automatically when only one of the two is left, asked when both are.
 */
export async function spendUtilize(actor, { label="Utilize", fastHands=true }={}) {
  if ( !inCombat(actor) ) return true;
  if ( fastHands && hasFastHands(actor) && isTurnOf(actor) ) {
    const a = !used(actor, "action"), b = !used(actor, "bonus");
    if ( a && b ) {
      const pick = await foundry.applications.api.DialogV2.wait({ window: { title: `${actor.name} — ${label}` }, rejectClose: false,
        content: `<p><em>${esc(label)}</em> takes the Utilize action. With Fast Hands it can be the Bonus Action.</p>`,
        buttons: [{ action: "action", label: "Action", default: true }, { action: "bonus", label: "Bonus Action (Fast Hands)" }] });
      if ( !pick ) return false;
      await mark(actor, pick);
      return true;
    }
    if ( b && !a ) { await mark(actor, "bonus"); return true; }
  }
  return spend(actor, "action", { label: `${label} (Utilize)` });
}

/**
 * An object interaction: the turn's free one if unused, otherwise the Utilize action (asked first).
 */
export async function spendInteraction(actor, { label="Interact with an object" }={}) {
  if ( !inCombat(actor) ) return true;
  if ( isTurnOf(actor) && !used(actor, "interaction") ) { await mark(actor, "interaction"); return true; }
  if ( isTurnOf(actor) && !(await confirm(`${actor.name} — ${label}`,
    `<p><strong>${esc(actor.name)}</strong> has used its free object interaction this turn; <em>${esc(label)}</em> takes the Utilize action.</p>`)) ) return false;
  return spendUtilize(actor, { label });
}

/** Activities mark what they cost. */
export function registerEconomyHooks() {
  Hooks.on("dnd5e.postUseActivity", activity => {
    const type = activity?.activation?.type;
    const kind = (type === "action") ? "action" : (type === "bonus") ? "bonus" : null;
    if ( !kind || !activity.actor || !isTurnOf(activity.actor) ) return;
    if ( activity.actor.isOwner ) mark(activity.actor, kind);
  });
}
