/**
 * Alivas's Engine of Triggers — Delay turn.
 *
 * On its own turn a combatant may delay (a button on the combat tracker, not for the last combatant in the order): its
 * turn ends at once and it is marked delayed (combatant flag `delayed: { round, turn }`). While delayed it has no
 * reaction. Pressing the button again at any other creature's turn brings it back: its initiative moves to just before
 * the creature whose turn it is (permanently), and it acts now; that creature's turn resumes after it without starting
 * over. If a whole round passes without returning, it forfeits that turn: its end-of-turn effects resolve when its place
 * in the order comes round again, and it takes its new turn as usual.
 *
 * What happens to its effects when it delays:
 *   - start-of-turn things already happened (its turn had started);
 *   - effects ending at the end of its turn that help its side (put on by itself or an ally, or its own effects on
 *     enemies) end now — delaying can't stretch them;
 *   - everything else at the end of its turn (enemies' effects ending, "save at the end of your turn", end-of-turn
 *     damage, area end-of-turn triggers, Rage upkeep) waits for the end of the turn it actually takes.
 * Setting `delayTurn` switches the feature on or off.
 */

import { relation, isLeadGM } from "./creatures.mjs";

const MODULE_ID = "alivas-engine-of-triggers";
const SOCKET = `module.${MODULE_ID}`;
const setting = key => game.settings.get(MODULE_ID, key);

export const isDelayed = combatant => !!combatant?.getFlag(MODULE_ID, "delayed");

/** Turn edges being skipped right now: "start|combatantId" / "end|combatantId" → time marked (lead GM). */
const skipping = new Map();
const SKIP_MS = 10000;
const mark = (kind, id) => skipping.set(`${kind}|${id}`, Date.now());
export const isSkipping = (kind, id) => (Date.now() - (skipping.get(`${kind}|${id}`) ?? 0)) < SKIP_MS;

/** The end of turn being processed is a delay (not the combatant's real end of turn). */
export function isDelayEnd(combat, combatant, context={}) {
  const d = combatant?.getFlag(MODULE_ID, "delayed");
  return !!d && (d.round === context.round) && (d.turn === context.turn) && (combat?.id === d.combat);
}

/* -------------------------------------------- */
/*  Actions                                     */
/* -------------------------------------------- */

/** Can this combatant delay now? */
export function canDelay(combat, combatant) {
  if ( !setting("delayTurn") || !combat?.started || isDelayed(combatant) ) return false;
  return (combat.combatant?.id === combatant.id) && (combat.turn < combat.turns.length - 1);
}

/** Can this combatant come back now? */
export function canReturn(combat, combatant) {
  return !!combat?.started && isDelayed(combatant) && !!combat.combatant && (combat.combatant.id !== combatant.id);
}

/** Delay: mark and end the turn. Runs on the lead GM (players ask through the socket). */
async function delay(combat, combatant) {
  if ( !canDelay(combat, combatant) ) return;
  await combatant.setFlag(MODULE_ID, "delayed", { combat: combat.id, round: combat.round, turn: combat.turn });
  await ChatMessage.implementation.create({ speaker: ChatMessage.implementation.getSpeaker({ actor: combatant.actor }),
    content: `<p><strong>${foundry.utils.escapeHTML(combatant.name)}</strong> delays their turn.</p>` });
  await combat.nextTurn();
}

/**
 * Return: initiative just before the creature whose turn it is, which becomes this combatant's turn — no turn events
 * (its turn had already started; the active creature's turn resumes afterwards without starting again).
 */
async function comeBack(combat, combatant) {
  if ( !canReturn(combat, combatant) ) return;
  const active = combat.combatant;
  const order = combat.turns.filter(c => c.id !== combatant.id);
  const k = order.findIndex(c => c.id === active.id);
  const prev = k > 0 ? order[k - 1] : null;
  const a = Number(active.initiative) || 0;
  const p = prev ? Number(prev.initiative) : null;
  const initiative = (p !== null) && Number.isFinite(p) && (p > a) ? Math.round(((a + p) / 2) * 1000) / 1000 : a + 1;
  await combat.updateEmbeddedDocuments("Combatant", [{ _id: combatant.id, initiative, [`flags.${MODULE_ID}.-=delayed`]: null }],
    { turnEvents: false });
  const turn = combat.turns.findIndex(c => c.id === combatant.id);
  await combat.update({ turn, [`flags.${MODULE_ID}.resume`]: active.id }, { turnEvents: false });
  await ChatMessage.implementation.create({ speaker: ChatMessage.implementation.getSpeaker({ actor: combatant.actor }),
    content: `<p><strong>${foundry.utils.escapeHTML(combatant.name)}</strong> returns from delaying and acts before `
      + `<strong>${foundry.utils.escapeHTML(active.name)}</strong> (initiative ${initiative}).</p>` });
}

/** Run a delay or a return here (GM) or through the lead GM. */
export function request(kind, combat, combatant) {
  if ( game.user.isGM && isLeadGM() ) return kind === "delay" ? delay(combat, combatant) : comeBack(combat, combatant);
  game.socket.emit(SOCKET, { type: "delayTurn", kind, combatId: combat.id, combatantId: combatant.id, userId: game.user.id });
}

Hooks.once("ready", () => {
  game.socket.on(SOCKET, async data => {
    if ( (data?.type !== "delayTurn") || !isLeadGM() ) return;
    const combat = game.combats.get(data.combatId);
    const combatant = combat?.combatants.get(data.combatantId);
    const user = game.users.get(data.userId);
    if ( !combatant || !user || !combatant.testUserPermission(user, "OWNER") ) return;
    return data.kind === "delay" ? delay(combat, combatant) : comeBack(combat, combatant);
  });
});

/* -------------------------------------------- */
/*  Turn edges (called by the engine's Combat wrappers, lead GM)          */
/* -------------------------------------------- */

/**
 * Before a combatant's turn starts. Returns "skip" (its turn resumes after a returning creature — it already
 * started), "forfeit" (it delayed a whole round: resolve that turn's end first), or null.
 */
export async function beforeStartTurn(combat, combatant, context={}) {
  const resume = combat.getFlag(MODULE_ID, "resume");
  if ( resume && (resume === combatant?.id) ) {
    mark("start", combatant.id);
    await combat.unsetFlag(MODULE_ID, "resume");
    return "skip";
  }
  if ( resume ) await combat.unsetFlag(MODULE_ID, "resume");
  const d = combatant?.getFlag(MODULE_ID, "delayed");
  if ( d && (d.combat === combat.id) && (context.round > d.round) ) return "forfeit";
  return null;
}

/** Resolve the end of a forfeited (delayed, never returned) turn, then clear the delay. */
export async function forfeit(combat, combatant, endOfTurn) {
  const d = combatant.getFlag(MODULE_ID, "delayed");
  await ChatMessage.implementation.create({ speaker: ChatMessage.implementation.getSpeaker({ actor: combatant.actor }),
    content: `<p><strong>${foundry.utils.escapeHTML(combatant.name)}</strong> delayed a whole round and loses that turn; its end-of-turn effects resolve now.</p>` });
  await endOfTurn(combatant);
  forcedEnd = { combat, combatant };
  try {
    const actors = new Set(combat.combatants.map(c => c.actor).filter(Boolean));
    await ActiveEffect.registry.refresh("turnEnd", { combat, round: d.round, turn: d.turn, actors });
  } finally { forcedEnd = null; }
  await combatant.unsetFlag(MODULE_ID, "delayed");
}

/** Delay end: mark it so region end-of-turn events for this combatant are skipped too. */
export function markDelayEnd(combatant) {
  mark("end", combatant.id);
}

/* -------------------------------------------- */
/*  Effect expiry                               */
/* -------------------------------------------- */

let forcedEnd = null;

/** The combatant an actor is in a combat as. */
const combatantOf = (combat, actor) => actor ? (combat?.getCombatantsByActor?.(actor)?.[0] ?? null) : null;

/** Does this effect end at the end of that combatant's turn (its own turn-end expiry, or dnd5e's source / target end)? */
function endsAtTurnEndOf(effect, combat, combatant) {
  const expiry = effect.duration?.expiry;
  if ( expiry === "turnEnd" ) return combatantOf(combat, effect.actor)?.id === combatant.id;
  const special = effect.specialDuration;
  if ( special?.endsWith?.("End") ) {
    const origin = special.startsWith("target") ? effect.actor : effect.getSourceActor?.();
    return combatantOf(combat, origin)?.id === combatant.id;
  }
  return false;
}

/** Does the effect help the delaying creature's side (its source is it or an ally, or it has no source)? */
function helpsSide(effect, combatant) {
  const source = effect.getSourceActor?.();
  if ( !source || !combatant.actor ) return true;
  return ["self", "ally"].includes(relation(combatant.actor, source));
}

/** Wrap ActiveEffect#isExpiryEvent for delays, returns and forfeits. Call in "setup". */
export function patchExpiry() {
  const proto = CONFIG.ActiveEffect.documentClass.prototype;
  const original = proto.isExpiryEvent;
  proto.isExpiryEvent = function(event, context={}) {
    const combat = context.combat ?? game.combat;
    if ( (event === "turnStart") && combat?.combatant && isSkipping("start", combat.combatant.id) ) return false;
    if ( (event === "turnEnd") && forcedEnd && (forcedEnd.combat === combat) ) return endsAtTurnEndOf(this, combat, forcedEnd.combatant);
    const result = original.call(this, event, context);
    if ( !result || (event !== "turnEnd") || !combat ) return result;
    const ending = combat.combatants.get(combat.previous?.combatantId);
    if ( !ending || !isDelayEnd(combat, ending, context) || !endsAtTurnEndOf(this, combat, ending) ) return result;
    return helpsSide(this, ending);
  };
}

/* -------------------------------------------- */
/*  Combat tracker button                       */
/* -------------------------------------------- */

Hooks.on("renderCombatTracker", (app, html) => {
  if ( !setting("delayTurn") ) return;
  const combat = app.viewed;
  if ( !combat?.started ) return;
  const root = html instanceof HTMLElement ? html : html[0];
  for ( const li of root.querySelectorAll("[data-combatant-id]") ) {
    const combatant = combat.combatants.get(li.dataset.combatantId);
    if ( !combatant?.isOwner || li.querySelector(".aet-delay") ) continue;
    const delayed = isDelayed(combatant);
    const enabled = delayed ? canReturn(combat, combatant) : canDelay(combat, combatant);
    li.classList.toggle("aet-delayed", delayed);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `inline-control combatant-control icon fa-solid ${delayed ? "fa-arrow-rotate-left" : "fa-hourglass-half"} aet-delay`;
    button.dataset.tooltip = delayed ? (enabled ? "Return from delay: act now, before the current creature" : "Delayed — return on another creature's turn")
      : (enabled ? "Delay your turn" : "Delay: only on your own turn, and not when you're last in the order");
    button.setAttribute("aria-label", button.dataset.tooltip);
    button.disabled = !enabled;
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      request(delayed ? "return" : "delay", combat, combatant);
    });
    const controls = li.querySelector(".combatant-controls") ?? li.querySelector(".token-name, .name") ?? li;
    controls.prepend(button);
  }
});
