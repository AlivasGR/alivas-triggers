/**
 * Alivas's Engine of Triggers — cover on attacks (2024): Half Cover +2 AC, Three-Quarters Cover +5 AC, for one attack.
 *
 * Before the roll: the attack roll dialog gets a "Target's cover" choice. It rides on the roll as
 *   roll.options["alivas-engine-of-triggers"].cover = "half" | "threeQuarters"
 * and the engine's hit check (main.mjs, dnd5e.rollAttackV2) adds coverBonus() to each target's AC.
 *
 * World settings `coverDialog` / `coverButtons` (default on) switch the dialog choice and the card buttons off.
 *
 * After the roll (message flag `cover` records it): attack roll chat cards get "½ cover" / "¾ cover" buttons (GM and the card's author). Applying cover
 * re-checks each target against AC + cover; a target that was hit and now isn't has what the hit did to it undone —
 * the HP and temporary HP it lost, and the effects that landed on it during the attack (the ledger below). Things the
 * hit caused elsewhere (a concentration check, movement from onHit steps) are not undone; the chat line says so.
 *
 * Ignoring cover — effect flag on the attacker (Sharpshooter, Spell Sniper, Wand of the War Mage):
 *   flags.alivas-engine-of-triggers.ignoreCover = { level: "half"|"threeQuarters", classification?: "weapon"|"spell"|"unarmed",
 *                                                    type?: "melee"|"ranged" }
 *   An attack matching classification/type ignores cover up to that level (Three-Quarters includes Half).
 *
 * Ledger (message flag `coverLedger`, written by the attack's client): [{ actorUuid, hp, temp, effects: [uuid] }]
 * — hp/temp lost to this attack and the effects created on the target while it resolved.
 *
 * API (engine api.cover): coverBonus(level), effectiveCover(level, attacker, activity), beginLedger(targets),
 *   finishLedger(ledger, message), applyCoverAfter(message, level)
 */

import * as Creatures from "./creatures.mjs";
import { opt } from "./settings.mjs";

const MODULE_ID = "alivas-engine-of-triggers";
const LEVELS = { none: 0, half: 2, threeQuarters: 5 };
const LABEL = { none: "No cover", half: "Half cover (+2 AC)", threeQuarters: "Three-quarters cover (+5 AC)" };
const SHORT = { half: "half cover", threeQuarters: "three-quarters cover" };
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

export const coverBonus = level => LEVELS[level] ?? 0;

/** The cover that still counts after the attacker's "ignore cover" effects for this attack. */
export function effectiveCover(level, attacker, activity) {
  if ( !coverBonus(level) || !attacker ) return level in LEVELS ? level : "none";
  const classification = activity?.attack?.type?.classification ?? (activity?.item?.type === "spell" ? "spell" : "weapon");
  const type = activity?.attack?.type?.value ?? "";
  let ignores = 0;
  for ( const e of attacker.appliedEffects ?? [] ) {
    const rule = e.getFlag?.(MODULE_ID, "ignoreCover");
    if ( !rule ) continue;
    if ( rule.classification && (rule.classification !== classification) ) continue;
    if ( rule.type && (rule.type !== type) ) continue;
    ignores = Math.max(ignores, coverBonus(rule.level));
  }
  return coverBonus(level) <= ignores ? "none" : level;
}

/** The cover chosen in the dialog for this roll (or later with the buttons). */
export const rollCover = roll => roll?.options?.[MODULE_ID]?.cover ?? "none";

/** The cover an attack card currently counts: set after the roll (flag), else chosen before it. */
export const messageCover = message => message?.getFlag?.(MODULE_ID, "cover") ?? rollCover(message?.rolls?.[0]);

/* -------------------------------------------- */
/*  Before the roll: the dialog                 */
/* -------------------------------------------- */

const chosen = new WeakMap();   // dialog app → level

function onRenderAttackDialog(app, html) {
  if ( !opt("coverDialog") ) return;
  const root = html instanceof HTMLElement ? html : (html?.[0] ?? app.element);
  const form = root?.querySelector?.("form") ?? root;
  if ( !form || form.querySelector("[name=aetCover]") ) return;
  const current = chosen.get(app) ?? "none";
  const group = document.createElement("div");
  group.className = "form-group";
  group.innerHTML = `<label>Target's cover</label><div class="form-fields"><select name="aetCover">${
    Object.entries(LABEL).map(([k, l]) => `<option value="${k}"${k === current ? " selected" : ""}>${l}</option>`).join("")}</select></div>`;
  const anchor = form.querySelector(".rolls, fieldset, .form-group");
  (anchor?.parentElement ?? form).insertBefore(group, anchor ?? null);
  group.querySelector("select").addEventListener("change", ev => {
    chosen.set(app, ev.currentTarget.value);
    pendingBySubject.set(app.config?.subject?.uuid ?? "", ev.currentTarget.value);
  });
}

/** The dialog's choice, waiting for the rolls to be built (keyed by the activity uuid). */
const pendingBySubject = new Map();

function onPostAttackConfiguration(rolls, config) {
  const key = config?.subject?.uuid ?? "";
  const level = pendingBySubject.get(key);
  pendingBySubject.delete(key);
  if ( !level || (level === "none") ) return;
  for ( const roll of rolls ?? [] ) foundry.utils.setProperty(roll.options, `${MODULE_ID}.cover`, level);
}

/* -------------------------------------------- */
/*  Ledger of what a hit did                    */
/* -------------------------------------------- */

/** Start recording what happens to these targets: their HP now, and effects created on them from now on. */
export function beginLedger(targets) {
  const ledger = { start: new Map(), effects: new Map(), hook: null };
  for ( const actor of targets ) {
    const hp = actor.system.attributes?.hp ?? {};
    ledger.start.set(actor.uuid, { actor, hp: hp.value ?? 0, temp: hp.temp ?? 0 });
    ledger.effects.set(actor.uuid, []);
  }
  ledger.hook = Hooks.on("createActiveEffect", effect => {
    const list = ledger.effects.get(effect.parent?.uuid);
    if ( list ) list.push(effect.uuid);
  });
  return ledger;
}

/** Stop recording and store the differences on the attack's message. */
export async function finishLedger(ledger, message) {
  if ( !ledger ) return;
  Hooks.off("createActiveEffect", ledger.hook);
  if ( !message?.isOwner ) return;
  const out = [];
  for ( const [uuid, s] of ledger.start ) {
    const hp = s.actor.system.attributes?.hp ?? {};
    const lost = Math.max(0, s.hp - (hp.value ?? 0)), lostTemp = Math.max(0, s.temp - (hp.temp ?? 0));
    const effects = ledger.effects.get(uuid) ?? [];
    if ( lost || lostTemp || effects.length ) out.push({ actorUuid: uuid, hp: lost, temp: lostTemp, effects });
  }
  await message.setFlag(MODULE_ID, "coverLedger", out).catch(() => {});
}

/** GM side: give back HP / temp HP and delete the effects. */
Creatures.HANDLERS.coverUndo = async function({ actorUuid, hp=0, temp=0, effects=[] }) {
  const actor = fromUuidSync(actorUuid);
  if ( !actor ) return false;
  const cur = actor.system.attributes?.hp ?? {};
  const update = {};
  if ( hp ) update["system.attributes.hp.value"] = Math.min(cur.effectiveMax ?? cur.max ?? Infinity, (cur.value ?? 0) + hp);
  if ( temp ) update["system.attributes.hp.temp"] = (cur.temp ?? 0) + temp;
  if ( Object.keys(update).length ) await actor.update(update);
  for ( const uuid of effects ) await fromUuidSync(uuid)?.delete().catch(() => {});
  return true;
};

/* -------------------------------------------- */
/*  After the roll: the buttons                 */
/* -------------------------------------------- */

/** A dnd5e attack roll card (dnd5e 6: message type "attack"; older: flags.dnd5e.roll.type). */
export const isAttackMessage = message => ((message?.type === "attack") || (message?.flags?.dnd5e?.roll?.type === "attack"))
  && !!message.rolls?.length;

/** The activity uuid an attack card belongs to. */
export const messageActivityUuid = message => message?.system?.activity?.uuid ?? message?.flags?.dnd5e?.activity?.uuid ?? null;

/** Targets recorded on an attack card: [{ uuid (actor), ac, name }]. */
function messageTargets(message) {
  return Array.from(message.system?.targets ?? message.flags?.dnd5e?.targets ?? [])
    .map(t => ({ uuid: t.actor ?? t.uuid, ac: t.ac, name: t.name })).filter(t => t.uuid);
}

/** Apply cover after the roll: re-check every target, undo what a lost hit did, and say what changed. */
export async function applyCoverAfter(message, level) {
  if ( !isAttackMessage(message) ) return;
  const roll = message.rolls[0];
  const before = messageCover(message);
  const activity = fromUuidSync(messageActivityUuid(message) ?? "");
  const attacker = activity?.actor ?? ChatMessage.implementation.getSpeakerActor(message.speaker);
  const was = coverBonus(effectiveCover(before, attacker, activity));
  const effective = effectiveCover(level, attacker, activity);
  const now = coverBonus(effective);
  const ledger = message.getFlag(MODULE_ID, "coverLedger") ?? [];
  const lines = [];
  if ( (effective === "none") && (level !== "none") ) lines.push(`${esc(attacker?.name ?? "The attacker")} ignores ${SHORT[level]}.`);
  for ( const t of messageTargets(message) ) {
    const doc = fromUuidSync(t.uuid);
    const actor = (doc instanceof Actor) ? doc : (doc?.actor ?? null);
    const ac = actor?.system?.attributes?.ac?.value ?? t.ac;
    if ( !Number.isFinite(ac) ) continue;
    const hitBefore = roll.isCritical || (!roll.isFumble && (roll.total >= ac + was));
    const hitNow = roll.isCritical || (!roll.isFumble && (roll.total >= ac + now));
    if ( hitBefore && !hitNow ) {
      const entry = Array.isArray(ledger) ? (ledger.find(e => e.actorUuid === actor?.uuid) ?? null) : null;
      if ( entry ) {
        const gm = game.user.isGM ? game.user : game.users.activeGM;
        if ( gm ) await Creatures.runAs(gm, "coverUndo", entry);
      }
      lines.push(`With ${SHORT[level]}, the attack misses <strong>${esc(actor?.name ?? t.name)}</strong> (${roll.total} vs AC ${ac + now})${
        entry ? " — its damage and effects are undone" : ""}.`);
    } else if ( !hitBefore && hitNow ) {
      lines.push(`Without that cover the attack would hit <strong>${esc(actor?.name ?? t.name)}</strong> — resolve it by hand.`);
    } else lines.push(`<strong>${esc(actor?.name ?? t.name)}</strong>: still a ${hitNow ? "hit" : "miss"} (${roll.total} vs AC ${ac + now}).`);
  }
  if ( message.isOwner ) await message.setFlag(MODULE_ID, "cover", level).catch(() => {});
  await ChatMessage.implementation.create({ speaker: message.speaker,
    content: `<p><strong>Cover</strong>: ${lines.join(" ")}</p>`, whisper: message.whisper?.length ? message.whisper : [] });
}

function onRenderChatMessage(message, html) {
  if ( !opt("coverButtons") || !isAttackMessage(message) || !(game.user.isGM || message.isAuthor) ) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if ( !root ) return;
  const current = messageCover(message);
  const bar = document.createElement("div");
  bar.className = "aet-cover";
  bar.style.cssText = "display:flex;gap:4px;margin-top:4px;font-size:var(--font-size-11, 11px)";
  for ( const level of ["half", "threeQuarters"] ) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = level === "half" ? "½ cover" : "¾ cover";
    b.dataset.tooltip = `Apply ${SHORT[level]} to this attack after the roll`;
    if ( current === level ) { b.disabled = true; b.style.opacity = "0.5"; }
    b.style.cssText += ";flex:1;line-height:18px;padding:0 4px";
    b.addEventListener("click", ev => { ev.preventDefault(); applyCoverAfter(message, level); });
    bar.append(b);
  }
  // Added a tick later, inside the card's content: other render hooks (Plutonium's compact chat) rebuild the content
  // after this one runs.
  setTimeout(() => {
    if ( !root.querySelector(".aet-cover") ) (root.querySelector(".message-content") ?? root).append(bar);
  }, 0);
}

export function registerCoverHooks() {
  Hooks.on("renderAttackRollConfigurationDialog", onRenderAttackDialog);
  Hooks.on("dnd5e.postAttackRollConfiguration", onPostAttackConfiguration);
  Hooks.on("renderChatMessageHTML", onRenderChatMessage);
}
