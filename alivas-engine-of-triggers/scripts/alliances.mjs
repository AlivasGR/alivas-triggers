/**
 * Alivas's Engine of Triggers — alliances (setting `alliances`, default on).
 *
 * A creature's alliance is one letter A–Z, or none. Same letter = allies; different letters = enemies; a creature with
 * no alliance is nobody's ally (relation "neutral"). It is resolved, most specific first:
 *   1. its combatant's flag `alliance` in a combat on its scene (the GM edits it on the combat tracker; "" = none)
 *   2. its actor's default, flag `alliance` (the sheet's "Alliance" header button; unset = automatic, "-" = none)
 *   3. automatic: a player-owned creature → setting `alliancePC` (default "A"); a summon → its summoner's alliance;
 *      otherwise its token's disposition: Friendly → "A", Hostile → "B", Neutral → none
 * So until the GM changes a letter, sides are the same as with token dispositions.
 *
 * When a creature joins a combat (createCombatant, lead GM) its resolved letter is stamped on the combatant, so the
 * tracker shows it and later changes to the actor's default don't rewrite a running encounter.
 *
 * Creatures.relation(a, b) reads alliances when the setting is on (creatures.mjs setAllianceResolver), so selectors
 * (side ally / enemy / notAlly), reaction filters (subjectIsAlly / subjectIsEnemy) and Opportunity Attacks follow them.
 * Creature pickers that filter by side offer "Include creatures outside this alliance" (creatures.mjs pickOnMap).
 *
 * API (engine api.alliances): of(actor, scene) → letter | "", relation(a, b, scene), set(combatant, letter),
 * setDefault(actor, letter | null | "-"), enabled(). Hook "alivasTriggers.allianceChanged" ({ actor, combatant, alliance }).
 */

import { tokenFor, setAllianceResolver, isLeadGM } from "./creatures.mjs";
import { opt } from "./settings.mjs";

const MODULE_ID = "alivas-engine-of-triggers";

export const enabled = () => { try { return !!opt("alliances"); } catch(err) { return false; } };

/** A stored value → a letter, or "" for none. */
const clean = value => String(value ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);

/** The combatant standing for this actor in a combat on its scene (started combats first). */
function combatantOf(actor, scene) {
  const token = tokenFor(actor, scene);
  const combats = [...game.combats.contents].sort((x, y) => Number(y.started) - Number(x.started));
  for ( const combat of combats ) {
    if ( token && combat.scene && (combat.scene !== token.parent) ) continue;
    const cb = combat.combatants.find(c => (token && (c.tokenId === token.id)) || (c.actor?.uuid === actor.uuid));
    if ( cb ) return cb;
  }
  return null;
}

/** The letter an actor gets when nothing is set for it (steps 2–3 above). */
export function defaultOf(actor, scene, seen=new Set(), { automatic=false }={}) {
  if ( !actor ) return "";
  const own = automatic ? undefined : actor.getFlag?.(MODULE_ID, "alliance");
  if ( own === "-" ) return "";
  if ( clean(own) ) return clean(own);
  if ( actor.hasPlayerOwner ) return clean(opt("alliancePC")) || "A";
  const summoner = actor.flags?.dnd5e?.summon?.origin ? fromUuidSync(actor.flags.dnd5e.summon.origin)?.actor : null;
  if ( summoner && !seen.has(summoner.uuid) ) {
    seen.add(actor.uuid);
    return allianceOf(summoner, scene, seen);
  }
  const { FRIENDLY, HOSTILE } = CONST.TOKEN_DISPOSITIONS;
  const disposition = tokenFor(actor, scene)?.disposition;
  return disposition === FRIENDLY ? "A" : disposition === HOSTILE ? "B" : "";
}

/** A creature's alliance letter, or "" for none. */
export function allianceOf(actor, scene, seen=new Set()) {
  if ( !actor ) return "";
  const cb = combatantOf(actor, scene);
  const stamped = cb?.getFlag(MODULE_ID, "alliance");
  if ( typeof stamped === "string" ) return clean(stamped);
  return defaultOf(actor, scene, seen);
}

/** How b stands relative to a by alliance: "self" | "ally" | "enemy" | "neutral". */
export function relation(a, b, scene) {
  if ( a && b && (a.uuid === b.uuid) ) return "self";
  const la = allianceOf(a, scene);
  const lb = allianceOf(b, scene);
  if ( !la || !lb ) return "neutral";
  return la === lb ? "ally" : "enemy";
}

/** Set a combatant's alliance for this encounter ("" = none). GM only. */
export async function set(combatant, letter) {
  if ( !game.user.isGM || !combatant ) return;
  await combatant.setFlag(MODULE_ID, "alliance", clean(letter));
}

/** Set an actor's default: a letter, "-" for none, or null / "" for automatic. GM only. */
export async function setDefault(actor, letter) {
  if ( !game.user.isGM || !actor ) return;
  if ( letter === "-" ) return actor.setFlag(MODULE_ID, "alliance", "-");
  const l = clean(letter);
  return l ? actor.setFlag(MODULE_ID, "alliance", l) : actor.unsetFlag(MODULE_ID, "alliance");
}

export function registerAlliances() {
  setAllianceResolver({ enabled, relation, allianceOf });

  // A creature joins a combat: stamp its resolved letter (lead GM; the stamp is what the tracker shows and edits).
  Hooks.on("createCombatant", async combatant => {
    if ( !enabled() || !isLeadGM() ) return;
    if ( typeof combatant.getFlag(MODULE_ID, "alliance") === "string" ) return;
    const actor = combatant.actor;
    if ( actor ) await combatant.setFlag(MODULE_ID, "alliance", defaultOf(actor, combatant.parent?.scene));
  });

  // Announce changes (for features built on alliances).
  Hooks.on("updateCombatant", (combatant, changed) => {
    if ( foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.alliance`) || foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.-=alliance`) ) {
      Hooks.callAll("alivasTriggers.allianceChanged", { actor: combatant.actor, combatant, alliance: allianceOf(combatant.actor, combatant.parent?.scene) });
    }
  });
  Hooks.on("updateActor", (actor, changed) => {
    if ( foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.alliance`) || foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.-=alliance`) ) {
      Hooks.callAll("alivasTriggers.allianceChanged", { actor, combatant: null, alliance: allianceOf(actor) });
    }
  });

  // Combat tracker: a one-letter field per combatant, GM only.
  Hooks.on("renderCombatTracker", (app, html) => {
    if ( !enabled() || !game.user.isGM ) return;
    const combat = app.viewed;
    if ( !combat ) return;
    const root = html instanceof HTMLElement ? html : html[0];
    for ( const li of root.querySelectorAll("[data-combatant-id]") ) {
      const combatant = combat.combatants.get(li.dataset.combatantId);
      if ( !combatant?.actor || li.querySelector(".aet-alliance") ) continue;
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 1;
      input.className = "aet-alliance";
      input.value = allianceOf(combatant.actor, combat.scene);
      input.placeholder = "–";
      input.dataset.tooltip = "Alliance (A–Z; empty = none). The same letter are allies, different letters enemies.";
      input.setAttribute("aria-label", "Alliance");
      Object.assign(input.style, { width: "1.6em", height: "1.6em", flex: "0 0 1.6em", textAlign: "center", padding: "0",
        textTransform: "uppercase", fontWeight: "bold", margin: "0 2px" });
      for ( const type of ["click", "dblclick", "pointerdown", "mousedown", "contextmenu"] ) input.addEventListener(type, e => e.stopPropagation());
      input.addEventListener("keydown", e => { e.stopPropagation(); if ( e.key === "Enter" ) input.blur(); });
      input.addEventListener("change", () => set(combatant, input.value));
      const controls = li.querySelector(".combatant-controls") ?? li.querySelector(".token-name, .name") ?? li;
      controls.prepend(input);
    }
  });

  // Actor sheets: an "Alliance" header button (GM) for the actor's default.
  Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
    const actor = app.document;
    if ( !enabled() || !game.user.isGM || !(actor instanceof Actor) || !["character", "npc"].includes(actor.type) ) return;
    controls.push({ icon: "fa-solid fa-flag", label: "Alliance", action: "aetAlliance", visible: true,
      onClick: () => editDefault(actor) });
  });
}

/** The default-alliance dialog: a letter, automatic (empty), or "-" for none. */
async function editDefault(actor) {
  const own = actor.getFlag(MODULE_ID, "alliance") ?? "";
  const auto = defaultOf(actor, undefined, new Set(), { automatic: true }) || "none";
  const esc = foundry.utils.escapeHTML;
  const value = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${actor.name} — Alliance` }, position: { width: 380 }, rejectClose: false,
    content: `<p>The alliance this creature starts each combat with. The same letter are allies, different letters enemies.</p>
      <label style="display:flex;gap:8px;align-items:center"><span>Letter</span>
      <input name="alliance" type="text" maxlength="1" value="${esc(own)}" placeholder="auto" style="width:3em;text-align:center;text-transform:uppercase"></label>
      <p class="hint">Empty: automatic (now <strong>${esc(auto)}</strong> — players' creatures ${esc(clean(opt("alliancePC")) || "A")}, summons their summoner's,
      others by token disposition: Friendly A, Hostile B, Neutral none). “-”: no alliance. Change it for one encounter on the combat tracker.</p>`,
    ok: { label: "Save", callback: (event, button) => button.form.elements.alliance.value }
  });
  if ( value === null || value === undefined ) return;
  await setDefault(actor, String(value).trim() === "-" ? "-" : value);
}
