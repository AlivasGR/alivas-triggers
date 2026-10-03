/**
 * Alivas's Engine of Triggers — token interactions: things a character can do to another token on the map (pick up a
 * body, loot it, pickpocket, and later traps…). One registry, two ways in:
 *   - right-clicking a token you don't own (players usually) opens a small menu of the interactions available now;
 *   - the Token HUD (owners and the GM) shows the same interactions as buttons.
 * The acting character is the user's controlled token other than the target, else their assigned character's token on
 * the scene. Each interaction states a range (default 5 ft, measured between the two tokens).
 *
 * registerInteraction({
 *   id, label, icon,                        icon: a Font Awesome class, e.g. "fa-solid fa-hand"
 *   range = 5,                               feet; null = any distance on the scene
 *   available(target, actor) → boolean       shown at all? (target: TokenDocument, actor: the acting Actor)
 *   blocked?(target, actor) → string|null    shown but disabled, with this reason
 *   run(target, actor) → Promise             does it (on the acting user's client)
 * })
 * API (engine api.interact): registerInteraction, actingToken(target), openMenu(target), interactionsFor(target, actor)
 */

import * as Creatures from "./creatures.mjs";

const MODULE_ID = "alivas-engine-of-triggers";
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
const REGISTRY = new Map();

export function registerInteraction(def) {
  if ( !def?.id || (typeof def.run !== "function") ) throw new Error("registerInteraction: id and run() are required");
  REGISTRY.set(def.id, { range: 5, icon: "fa-solid fa-hand", available: () => true, ...def });
}

/** The token the user acts with against `target`: a controlled token, else their character's token on the scene. */
export function actingToken(target) {
  const scene = target?.parent;
  const controlled = canvas.tokens?.controlled?.map(t => t.document).find(t => (t.id !== target?.id) && (t.parent === scene) && t.actor);
  if ( controlled ) return controlled;
  const character = game.user.character;
  return character ? (character.getActiveTokens(false, true).find(t => (t.parent === scene) && (t.id !== target?.id)) ?? null) : null;
}

/** [{ def, reason }] for the interactions `actor` (on token `from`) could use on `target`; reason = why it's disabled. */
export function interactionsFor(target, from) {
  const actor = from?.actor;
  if ( !target || !actor ) return [];
  const out = [];
  for ( const def of REGISTRY.values() ) {
    let ok = false;
    try { ok = def.available(target, actor); } catch(err) { console.error(`${MODULE_ID} | interaction ${def.id}`, err); }
    if ( !ok ) continue;
    let reason = null;
    if ( Number.isFinite(def.range) && (Creatures.distanceFt(from, target) > def.range) ) reason = `Within ${def.range} ft`;
    if ( !reason && def.blocked ) { try { reason = def.blocked(target, actor) ?? null; } catch(err) { reason = null; } }
    out.push({ def, reason });
  }
  return out;
}

async function runInteraction(def, target, actor) {
  try { await def.run(target, actor); }
  catch(err) { console.error(`${MODULE_ID} | interaction ${def.id} failed`, err); ui.notifications.error(`${def.label} failed — see the console.`); }
}

/** The menu for a target: a dialog with one button per interaction (disabled ones show why). */
export async function openMenu(target) {
  const from = actingToken(target);
  if ( !from ) { ui.notifications.warn("Select your character's token first."); return false; }
  const list = interactionsFor(target, from);
  if ( !list.length ) return false;
  const buttons = list.map(({ def, reason }) => ({ action: def.id, icon: def.icon, label: reason ? `${def.label} (${reason})` : def.label,
    disabled: !!reason }));
  buttons.push({ action: "cancel", label: "Cancel" });
  const pick = await foundry.applications.api.DialogV2.wait({
    window: { title: `${from.actor.name} → ${target.name}` }, rejectClose: false, buttons,
    content: `<p>What does <strong>${esc(from.actor.name)}</strong> do with <strong>${esc(target.name)}</strong>?</p>`,
    position: { width: 340 }
  });
  const chosen = list.find(x => x.def.id === pick);
  if ( chosen && !chosen.reason ) await runInteraction(chosen.def, target, from.actor);
  return true;
}

/** Right-click on a token the user can't control: the menu, when it has anything to offer. */
function wrapTokenRightClick() {
  const cls = foundry.canvas?.placeables?.Token ?? CONFIG.Token?.objectClass;
  const proto = cls?.prototype;
  if ( !proto || (typeof proto._onClickRight !== "function") ) { console.warn(`${MODULE_ID} | Token#_onClickRight not found; no token interaction menu`); return; }
  const original = proto._onClickRight;
  proto._onClickRight = function(event, ...rest) {
    try {
      const target = this.document;
      if ( !target.isOwner && REGISTRY.size ) {
        const from = actingToken(target);
        if ( from && interactionsFor(target, from).length ) {
          event?.stopPropagation?.();
          openMenu(target);
          return;
        }
      }
    } catch(err) { console.error(err); }
    return original.call(this, event, ...rest);
  };
}

/** Owners (and the GM): the interactions as Token HUD buttons, acting with another controlled token. */
function onRenderTokenHUD(app, html) {
  const target = app.document ?? app.object?.document;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if ( !target || !root ) return;
  const from = actingToken(target);
  if ( !from ) return;
  const list = interactionsFor(target, from);
  if ( !list.length ) return;
  const col = root.querySelector(".col.left") ?? root.querySelector(".left") ?? root;
  for ( const { def, reason } of list ) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "control-icon aet-interact";
    btn.dataset.tooltip = `${from.actor.name}: ${def.label}${reason ? ` (${reason})` : ""}`;
    btn.innerHTML = `<i class="${def.icon}"></i>`;
    if ( reason ) { btn.disabled = true; btn.style.opacity = "0.4"; }
    btn.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); app.close?.(); runInteraction(def, target, from.actor); });
    col.append(btn);
  }
}

export function registerInteractHooks() {
  wrapTokenRightClick();
  Hooks.on("renderTokenHUD", onRenderTokenHUD);
}
