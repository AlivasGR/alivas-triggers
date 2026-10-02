/**
 * Alivas's Engine of Triggers — Ready (2024): prepare one of your activities for a trigger; when it happens, use your
 * reaction to release it against the creature that triggered it.
 *
 * Action `ready { trigger?, range? }`: the bearer's player picks an activity (one with an action activation) and, unless
 * fixed, a trigger and range. The bearer gets the effect "Readied: <activity>" until the start of its next turn:
 *   flags.alivas-engine-of-triggers.readied = { activity: <uuid>, trigger, range }
 * Triggers (a hostile creature, within range of the bearer):
 *   enters   moves into range                        (checked where the mover moves)
 *   casts    casts a spell                            (after its casting is announced)
 *   attacks  makes an attack roll
 *   manual   the GM presses "Trigger" on the readied card (anything the table decides: "if the door opens")
 * The bearer's controller gets the usual reaction popup (it waits); using it spends the reaction and ends the readiness.
 * A readied spell is cast when released (its slot spent then).
 */

import * as Creatures from "./creatures.mjs";
import * as Reactions from "./reactions.mjs";

const MODULE_ID = "alivas-engine-of-triggers";
const TRIGGERS = { enters: "a hostile creature comes within range", casts: "a hostile creature within range casts a spell",
  attacks: "a hostile creature within range attacks", manual: "something else happens (the GM triggers it)" };

let deps = {};
export function initReady(d) {
  deps = d;
  d.ACTIONS.ready = readyAction;
}

const readiedOn = actor => (actor?.effects?.contents ?? []).filter(e => e.getFlag(MODULE_ID, "readied"));

/** The action: choose what and when, then become readied. */
async function readyAction(trigger, effect, bearer, event, context={}) {
  const a = trigger.action ?? {};
  const user = Creatures.controllerOf(bearer);
  if ( !user ) return {};
  const activities = bearer.items.contents.flatMap(i => [...(i.system.activities ?? [])]
    .filter(x => ["action"].includes(x.activation?.type) && (x.item.type !== "feat" || x.item.getFlag?.("alivas-box-of-triggers", "maneuvers") !== true))
    .map(x => ({ value: x.uuid, label: `${x.item.name}${x.name && x.name !== x.item.name ? ` — ${x.name}` : ""}` })));
  if ( !activities.length ) return {};
  const picked = await Creatures.runAs(user, "readyPrompt", { actorName: bearer.name, activities, trigger: a.trigger ?? null,
    range: a.range ?? null });
  if ( !picked?.activity ) return {};
  const act = fromUuidSync(picked.activity);
  const name = `Readied: ${act?.item?.name ?? "action"}`;
  await Creatures.giveEffect({ name, img: act?.item?.img ?? "icons/svg/clockwork.svg",
    duration: { value: 1, units: "rounds", expiry: "turnStart" },
    flags: { [MODULE_ID]: { readied: { activity: picked.activity, trigger: picked.trigger, range: Number(picked.range) || 5 } } } }, [bearer]);
  await ChatMessage.implementation.create({ speaker: ChatMessage.implementation.getSpeaker({ actor: bearer }),
    content: `<p><strong>${foundry.utils.escapeHTML(bearer.name)}</strong> readies <em>${foundry.utils.escapeHTML(act?.item?.name ?? "")}</em> —
      when ${TRIGGERS[picked.trigger]}${picked.trigger !== "manual" ? ` (${picked.range} ft)` : ""}.</p>
      <button type="button" data-aet-ready="${bearer.uuid}"><i class="fa-solid fa-bolt"></i> Trigger now</button>` });
  return {};
}

/** The player's choice of activity, trigger and range. */
Creatures.HANDLERS.readyPrompt = async function({ actorName, activities, trigger, range }) {
  const opts = (list, v) => list.map(([k, l]) => `<option value="${k}"${k === v ? " selected" : ""}>${foundry.utils.escapeHTML(l)}</option>`).join("");
  const content = `<div class="aet-ready">
    <label>Ready<select name="activity">${opts(activities.map(a => [a.value, a.label]))}</select></label>
    <label>When<select name="trigger"${trigger ? " disabled" : ""}>${opts(Object.entries(TRIGGERS), trigger ?? "enters")}</select></label>
    <label>Within<input type="number" name="range" value="${range ?? 5}" min="0" step="5"> ft</label></div>`;
  const result = await foundry.applications.api.DialogV2.prompt({ window: { title: `${actorName} — Ready` }, content, rejectClose: false,
    ok: { label: "Ready", callback: (event, button) => {
      const f = button.form.elements;
      return { activity: f.activity.value, trigger: trigger ?? f.trigger.value, range: Number(f.range.value) || 5 };
    } } });
  return result ?? null;
};

/** Offer the readied creature its reaction against a subject. */
async function release(reactor, effect, subject) {
  const data = effect.getFlag(MODULE_ID, "readied");
  const activity = fromUuidSync(data?.activity);
  if ( !activity || Reactions.reactionUsed(reactor) ) return;
  const subjectToken = Creatures.tokenFor(subject);
  const option = { id: `ready.${activity.id}`, label: `Readied — ${activity.item.name}${activity.name ? ` (${activity.name})` : ""}`,
    itemId: activity.item.id, activityId: activity.id, targetUuid: subjectToken?.uuid ?? null, rollAttack: activity.type === "attack" };
  const result = await Reactions.ask(reactor, `<strong>${subject?.name ?? "The trigger"}</strong> — ${TRIGGERS[data.trigger]}.`, [option]);
  if ( result?.used ) await effect.delete().catch(() => {});
}

/** Readied creatures that a hostile `subject` triggers with `kind`, within their range of it. */
function readiedFor(subject, kind, { before=null }={}) {
  const subjectToken = Creatures.tokenFor(subject);
  if ( !subjectToken ) return [];
  const out = [];
  for ( const t of subjectToken.parent.tokens ) {
    const actor = t.actor;
    if ( !actor || (t.id === subjectToken.id) || (Creatures.relation(actor, subject) !== "enemy") ) continue;
    for ( const e of readiedOn(actor) ) {
      const r = e.getFlag(MODULE_ID, "readied");
      if ( r.trigger !== kind ) continue;
      const now = Creatures.distanceFt(t, subjectToken);
      if ( now > r.range ) continue;
      if ( (kind === "enters") && before && (Creatures.distanceFt(t, subjectToken, before) <= r.range) ) continue;
      out.push([actor, e]);
    }
  }
  return out;
}

/** A token moved (from the engine's moveToken handler, on the mover's client). */
export async function readyMoved(tokenDoc, movement) {
  for ( const [actor, e] of readiedFor(tokenDoc.actor, "enters", { before: movement.origin }) ) await release(actor, e, tokenDoc.actor);
}

export function registerReadyHooks() {
  Hooks.on("dnd5e.postUseActivity", activity => {
    if ( activity?.item?.type !== "spell" || !activity.actor?.isOwner ) return;
    for ( const [actor, e] of readiedFor(activity.actor, "casts") ) release(actor, e, activity.actor);
  });
  Hooks.on("dnd5e.rollAttackV2", (rolls, { subject }={}) => {
    const actor = subject?.actor;
    if ( !actor?.isOwner ) return;
    for ( const [reactor, e] of readiedFor(actor, "attacks") ) release(reactor, e, actor);
  });
  // "Trigger now" on the readied card (GM): the target is the GM's current target, if any.
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const button = html.querySelector?.("[data-aet-ready]");
    if ( !button ) return;
    if ( !game.user.isGM ) { button.remove(); return; }
    button.addEventListener("click", async () => {
      const actor = fromUuidSync(button.dataset.aetReady);
      const e = readiedOn(actor)[0];
      if ( !e ) return ui.notifications.info("No longer readied.");
      const target = [...game.user.targets][0]?.actor ?? null;
      await release(actor, e, target ?? actor);
    });
  });
}
