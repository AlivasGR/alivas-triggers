/**
 * Alivas's Engine of Triggers — factions (setting `factions`, default on). Spec: tasks/T-026-factions-spec.md.
 *
 * Every creature token has a FACTION, one letter A–Z (non-creatures — loot piles, vehicles, groups — have none). How
 * factions regard each other is the scene's RELATIONS TABLE: "ally" | "neutral" | "hostile" per ordered pair (row =
 * the faction that regards, column = the one regarded). Defaults: a faction is always ally to itself; the party letter
 * (setting `factionPC`, "A") and "B" are hostile both ways; every other pair is neutral. The GM edits cells in the
 * relations window (factions-window.mjs); cells are stored on the scene, `flags.<module>.relations[from][to]`.
 *
 * A token's faction, most specific first:
 *   1. an active effect on its actor with the rule `faction`: a letter, or "source" (the effect's source's faction —
 *      Dominate: the target joins the caster's side while it lasts; nothing is written, so it ends by itself)
 *   2. the token's flag `faction` (the GM edits it on the combat tracker or the Token HUD; "" = none)
 *   3. its default: none for non-creatures; the actor's seed (flag `faction`, sheet "Faction" button; "-" = none);
 *      player-owned → the party letter; a summon → its summoner's faction; any other NPC → "B"
 * New tokens get their default stamped (lead GM, shortly after creation so summon data is in place).
 *
 * Disposition follows the table: each creature token's Foundry disposition is written as the PARTY's relation to its
 * faction (ally → Friendly, neutral → Neutral, hostile → Hostile), by the lead GM, whenever a letter or the table
 * changes. Secret tokens are never rewritten. Nothing else ever changes a disposition.
 *
 * Border colours are drawn per viewer from the table, seen from the viewer's PERSPECTIVE faction (perspective()): for a
 * player, the faction of the last of their tokens they clicked (it stays until they click another), else their assigned
 * character's, else the party letter; the GM always sees the party's view.
 *
 * Creatures.relation(a, b) reads the table when the setting is on (setAllianceResolver), so selector sides, reaction
 * filters, Opportunity Attacks, Sneak Attack's ally check, movement and flanking follow it.
 *
 * Charmed: a creature charmed by X can't attack X (attack rolls are refused) and X is left out of its hostile pickers.
 *
 * API (engine api.factions): enabled, factionOf, relationOf, relation, perspective, lettersInUse, tokensOf, getTable,
 * setRelation, setFaction, setSeed, addFaction, copyTable, partyLetter, isLinked, setLinked, openWindow.
 * Hook "alivasTriggers.factionsChanged" ({ scene }) after a letter or table change.
 */

import { tokenFor, setAllianceResolver, isLeadGM, charmersOf } from "./creatures.mjs";
import { opt } from "./settings.mjs";
import { openRelationsWindow } from "./factions-window.mjs";

const MODULE_ID = "alivas-engine-of-triggers";
const NPC_DEFAULT = "B";
export const RELATIONS = ["ally", "neutral", "hostile"];

export const enabled = () => { try { return !!opt("factions"); } catch(err) { return false; } };
export const partyLetter = () => clean(opt("factionPC")) || "A";

/** A stored value → a letter, or "" for none. */
export const clean = value => String(value ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);

/* -------------------------------------------- */
/*  Resolving factions                          */
/* -------------------------------------------- */

const isCreature = actor => {
  if ( !actor ) return false;
  if ( actor.flags?.["item-piles"]?.data?.enabled ) return false;
  return actor.system?.isCreature ?? ["character", "npc"].includes(actor.type);
};

/** A TokenDocument from a Token, TokenDocument or Actor. */
function docOf(x, scene) {
  if ( !x ) return null;
  if ( x.document?.documentName === "Token" ) return x.document;
  if ( x.documentName === "Token" ) return x;
  if ( x.documentName === "Actor" ) return tokenFor(x, scene) ?? null;
  return null;
}
const actorOf = x => (x?.documentName === "Actor") ? x : (x?.actor ?? x?.document?.actor ?? null);

/** The faction an actor starts with (step 3 above). */
export function defaultFaction(actor, scene, seen=new Set()) {
  if ( !isCreature(actor) ) return "";
  const seed = actor.getFlag?.(MODULE_ID, "faction");
  if ( seed === "-" ) return "";
  if ( clean(seed) ) return clean(seed);
  if ( actor.hasPlayerOwner ) return partyLetter();
  const origin = actor.flags?.dnd5e?.summon?.origin;
  const summoner = origin ? fromUuidSync(origin, { strict: false })?.actor : null;
  if ( summoner && !seen.has(summoner.uuid) ) {
    seen.add(actor.uuid);
    return factionOf(summoner, scene, seen);
  }
  return NPC_DEFAULT;
}

/** A creature's faction letter ("" = none). Accepts a Token, TokenDocument or Actor. */
export function factionOf(x, scene, seen=new Set()) {
  const actor = actorOf(x);
  if ( !actor || !isCreature(actor) ) return "";
  // 1. An effect that sets the faction (Dominate).
  for ( const effect of actor.appliedEffects ?? [] ) {
    const rule = effect.getFlag?.(MODULE_ID, "faction");
    if ( !rule ) continue;
    if ( rule === "source" ) {
      const source = effect.getSourceActor?.();
      if ( source && (source.uuid !== actor.uuid) && !seen.has(source.uuid) ) {
        seen.add(actor.uuid);
        const l = factionOf(source, scene, seen);
        if ( l ) return l;
      }
    } else if ( clean(rule) ) return clean(rule);
  }
  // 2. The token's own letter.
  const doc = docOf(x, scene);
  const own = doc?.getFlag?.(MODULE_ID, "faction");
  if ( typeof own === "string" ) return clean(own);
  // 3. The default.
  return defaultFaction(actor, doc?.parent ?? scene, seen);
}

/** The scene a creature is judged on. */
const sceneOf = (x, scene) => docOf(x, scene)?.parent ?? scene ?? canvas?.scene ?? null;

/* -------------------------------------------- */
/*  The relations table                         */
/* -------------------------------------------- */

/** The stored cells of a scene's table: { from: { to: relation } }. */
export const getTable = scene => foundry.utils.deepClone(scene?.getFlag?.(MODULE_ID, "relations") ?? {});

/** How faction `from` regards faction `to` on a scene: "ally" | "neutral" | "hostile". */
export function relationOf(from, to, scene) {
  if ( !from || !to ) return "neutral";
  if ( from === to ) return "ally";
  const cell = scene?.getFlag?.(MODULE_ID, "relations")?.[from]?.[to];
  if ( RELATIONS.includes(cell) ) return cell;
  const party = partyLetter();
  if ( ((from === party) && (to === NPC_DEFAULT)) || ((from === NPC_DEFAULT) && (to === party)) ) return "hostile";
  return "neutral";
}

/** How creature a regards creature b: "self" | "ally" | "enemy" | "neutral" (the engine's relation vocabulary). */
export function relation(a, b, scene) {
  const aa = actorOf(a), ab = actorOf(b);
  if ( aa && ab && (aa.uuid === ab.uuid) ) return "self";
  const s = sceneOf(a, scene) ?? sceneOf(b, scene);
  const la = factionOf(a, s), lb = factionOf(b, s);
  if ( !la || !lb ) return "neutral";
  const r = relationOf(la, lb, s);
  return r === "hostile" ? "enemy" : r;
}

/** Are relations edited both ways at once on this scene? (The window's link toggle; default linked.) */
export const isLinked = scene => scene?.getFlag?.(MODULE_ID, "relationsUnlinked") !== true;
export async function setLinked(scene, linked) {
  if ( !game.user.isGM || !scene ) return;
  await scene.setFlag(MODULE_ID, "relationsUnlinked", !linked);
}

/** Set a cell (GM). With linked (default: the scene's link setting) the reverse cell is set too. The diagonal is fixed. */
export async function setRelation(scene, from, to, value, { linked }={}) {
  from = clean(from); to = clean(to);
  if ( !game.user.isGM || !scene || !from || !to || (from === to) || !RELATIONS.includes(value) ) return;
  linked ??= isLinked(scene);
  const update = { [`flags.${MODULE_ID}.relations.${from}.${to}`]: value };
  if ( linked ) update[`flags.${MODULE_ID}.relations.${to}.${from}`] = value;
  await scene.update(update);
}

/** Letters to show in the table: in use on the scene's tokens, in the stored table, and prepared with "+". */
export function lettersInUse(scene) {
  const letters = new Set();
  for ( const t of scene?.tokens ?? [] ) { const l = factionOf(t, scene); if ( l ) letters.add(l); }
  for ( const [from, row] of Object.entries(scene?.getFlag?.(MODULE_ID, "relations") ?? {}) ) {
    letters.add(from);
    for ( const to of Object.keys(row ?? {}) ) letters.add(to);
  }
  for ( const l of scene?.getFlag?.(MODULE_ID, "factionsExtra") ?? [] ) if ( clean(l) ) letters.add(clean(l));
  return [...letters].filter(Boolean).sort();
}

/** Prepare an empty faction in the table ("+"): the next free letter, or the one given. */
export async function addFaction(scene, letter) {
  if ( !game.user.isGM || !scene ) return null;
  const used = new Set(lettersInUse(scene));
  const l = clean(letter) || "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").find(c => !used.has(c));
  if ( !l ) return null;
  const extra = new Set(scene.getFlag(MODULE_ID, "factionsExtra") ?? []);
  extra.add(l);
  await scene.setFlag(MODULE_ID, "factionsExtra", [...extra]);
  return l;
}

/** The tokens of a faction on a scene. */
export const tokensOf = (scene, letter) => (scene?.tokens?.contents ?? []).filter(t => factionOf(t, scene) === clean(letter));

/** Copy another scene's relations (and link state) onto a scene (GM). */
export async function copyTable(fromScene, toScene) {
  if ( !game.user.isGM || !fromScene || !toScene ) return;
  await toScene.update({
    [`flags.${MODULE_ID}.-=relations`]: null
  });
  await toScene.update({
    [`flags.${MODULE_ID}.relations`]: getTable(fromScene),
    [`flags.${MODULE_ID}.relationsUnlinked`]: !isLinked(fromScene),
    [`flags.${MODULE_ID}.factionsExtra`]: fromScene.getFlag(MODULE_ID, "factionsExtra") ?? []
  });
}

/** Set a token's faction (GM): a letter, or "" for none. */
export async function setFaction(tokenDoc, letter) {
  if ( !game.user.isGM || !tokenDoc ) return;
  await tokenDoc.setFlag(MODULE_ID, "faction", clean(letter));
}

/** Set an actor's seed (GM): a letter, "-" for none, or null / "" for automatic. */
export async function setSeed(actor, letter) {
  if ( !game.user.isGM || !actor ) return;
  if ( letter === "-" ) return actor.setFlag(MODULE_ID, "faction", "-");
  const l = clean(letter);
  return l ? actor.setFlag(MODULE_ID, "faction", l) : actor.unsetFlag(MODULE_ID, "faction");
}

export const openWindow = scene => openRelationsWindow(scene ?? canvas?.scene);

/* -------------------------------------------- */
/*  Perspective (whose eyes the colours use)    */
/* -------------------------------------------- */

export function perspective(user=game.user) {
  if ( user?.isGM ) return partyLetter();
  const scene = canvas?.scene;
  // The last of this player's tokens they clicked (kept after they release it), while it's still on the scene.
  const last = lastClicked && scene?.tokens.get(lastClicked);
  const l = last ? factionOf(last, scene) : "";
  if ( l ) return l;
  const character = user?.character ? factionOf(user.character, scene) : "";
  return character || partyLetter();
}

/** The id of the last token this (non-GM) user took control of, on this client. */
let lastClicked = null;

/* -------------------------------------------- */
/*  Disposition sync                            */
/* -------------------------------------------- */

const DISPOSITION = () => ({ ally: CONST.TOKEN_DISPOSITIONS.FRIENDLY, neutral: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
  hostile: CONST.TOKEN_DISPOSITIONS.HOSTILE });

/** Write each creature token's disposition from the party's relation to its faction (lead GM). Secret is kept. */
export async function syncDispositions(scene, tokens) {
  if ( !enabled() || !scene || !isLeadGM() ) return;
  const party = partyLetter();
  const map = DISPOSITION();
  const updates = [];
  for ( const t of tokens ?? scene.tokens.contents ) {
    if ( t.disposition === CONST.TOKEN_DISPOSITIONS.SECRET ) continue;
    const l = factionOf(t, scene);
    if ( !l ) continue;
    const want = map[relationOf(party, l, scene)];
    if ( t.disposition !== want ) updates.push({ _id: t.id, disposition: want });
  }
  if ( updates.length ) await scene.updateEmbeddedDocuments("Token", updates, { [MODULE_ID]: { factionSync: true } });
}

/** Redraw every token's border here (colours depend on the table and the perspective). */
const refreshBorders = foundry.utils.debounce(() => {
  if ( canvas?.ready ) canvas.tokens?.setAllRenderFlags?.({ refreshState: true });
  for ( const app of foundry.applications.instances?.values?.() ?? [] ) {
    if ( app.constructor?.name === "CombatTracker" ) app.render();
  }
}, 50);

const announce = scene => Hooks.callAll("alivasTriggers.factionsChanged", { scene });

/* -------------------------------------------- */
/*  Registration                                */
/* -------------------------------------------- */

const COLORS = () => CONFIG.Canvas.dispositionColors;
const cssColor = n => `#${Number(n ?? 0).toString(16).padStart(6, "0")}`;
/** A relation's colour (the disposition palette). */
export const relationColor = r => ({ ally: COLORS().FRIENDLY, neutral: COLORS().NEUTRAL, hostile: COLORS().HOSTILE })[r] ?? COLORS().INACTIVE;
export const relationCss = r => cssColor(relationColor(r));

export function registerFactions() {
  setAllianceResolver({ enabled, relation, allianceOf: factionOf });

  // Stamp new tokens with their default (lead GM; a moment later so summon flags are in place), then sync.
  Hooks.on("createToken", tokenDoc => {
    if ( !enabled() || !isLeadGM() ) return;
    setTimeout(async () => {
      if ( !tokenDoc.parent?.tokens.has(tokenDoc.id) ) return;
      if ( (typeof tokenDoc.getFlag(MODULE_ID, "faction") !== "string") && isCreature(tokenDoc.actor) ) {
        await tokenDoc.setFlag(MODULE_ID, "faction", defaultFaction(tokenDoc.actor, tokenDoc.parent));
      } else await syncDispositions(tokenDoc.parent, [tokenDoc]);
    }, 400);
  });

  // A letter changed: sync its disposition, redraw.
  Hooks.on("updateToken", (tokenDoc, changed) => {
    if ( !foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.faction`) ) return;
    syncDispositions(tokenDoc.parent, [tokenDoc]);
    refreshBorders();
    announce(tokenDoc.parent);
  });

  // The table changed: sync the scene, redraw.
  Hooks.on("updateScene", (scene, changed) => {
    const keys = ["relations", "-=relations", "factionsExtra", "relationsUnlinked"];
    if ( !keys.some(k => foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.${k}`)) ) return;
    syncDispositions(scene);
    refreshBorders();
    announce(scene);
  });

  // An effect that sets a faction (Dominate) starts or ends: that actor's tokens change side.
  const factionEffect = effect => (effect.parent instanceof Actor) && effect.getFlag?.(MODULE_ID, "faction");
  const onEffect = effect => {
    if ( !factionEffect(effect) ) return;
    const actor = effect.parent;
    for ( const scene of game.scenes ) {
      const tokens = scene.tokens.filter(t => t.actor === actor || t.actorId === actor.id && t.actorLink);
      if ( tokens.length ) syncDispositions(scene, tokens);
    }
    refreshBorders();
  };
  Hooks.on("createActiveEffect", onEffect);
  Hooks.on("deleteActiveEffect", onEffect);
  Hooks.on("updateActiveEffect", (effect, changed) => { if ( "disabled" in changed ) onEffect(effect); });

  // Perspective changes when a player clicks one of their tokens.
  Hooks.on("controlToken", (token, controlled) => {
    if ( !enabled() || game.user.isGM ) return;
    if ( controlled && token.document?.isOwner ) lastClicked = token.document.id;
    refreshBorders();
  });
  Hooks.on("canvasReady", () => {
    if ( !enabled() ) return;
    // A token already controlled when the canvas loads (no controlToken event for it) counts as clicked.
    const owned = !game.user.isGM && canvas.tokens?.controlled?.find(t => t.document?.isOwner);
    if ( owned ) lastClicked = owned.document.id;
    refreshBorders();
  });

  // Border colours: from the table, seen from this viewer's perspective (Secret and non-creatures as Foundry draws them).
  // (registerFactions runs during "ready", so this is installed right away, not in a later hook.)
  {
    const cls = CONFIG.Token.objectClass;
    const original = cls.prototype.getDispositionColor;
    cls.prototype.getDispositionColor = function() {
      if ( !enabled() || (this.document.disposition === CONST.TOKEN_DISPOSITIONS.SECRET) ) return original.call(this);
      const scene = this.document.parent;
      const l = factionOf(this.document, scene);
      if ( !l ) return original.call(this);
      const r = relationOf(perspective(), l, scene);
      if ( r === "ally" ) return this.actor?.hasPlayerOwner ? COLORS().PARTY : COLORS().FRIENDLY;
      return relationColor(r);
    };
    refreshBorders();
  }

  // Once (lead GM): bring every scene's dispositions in line with its table (the lead-GM election settles first).
  setTimeout(() => {
    if ( !enabled() || !isLeadGM() ) return;
    for ( const scene of game.scenes ) syncDispositions(scene);
  }, 3000);

  // Charmed: no attacks against the charmer.
  Hooks.on("dnd5e.preRollAttackV2", config => {
    const attacker = config.subject?.actor;
    const charmers = charmersOf(attacker);
    if ( !charmers.size ) return;
    const hit = Array.from(game.user.targets ?? []).find(t => t.actor && charmers.has(t.actor.uuid));
    if ( !hit ) return;
    ui.notifications.warn(`${attacker.name} is Charmed by ${hit.name} and can't attack it.`);
    return false;
  });

  registerFactionFields();
}

/* -------------------------------------------- */
/*  GM fields: tracker, Token HUD, sheet         */
/* -------------------------------------------- */

/** A one-letter faction input bound to a token (GM). Its background shows the party's relation to that faction. */
function letterInput(tokenDoc, { size="1.6em" }={}) {
  const scene = tokenDoc.parent;
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 1;
  input.className = "aet-faction";
  const l = factionOf(tokenDoc, scene);
  input.value = l;
  input.placeholder = "–";
  const r = l ? relationOf(partyLetter(), l, scene) : null;
  input.dataset.tooltip = "Faction (A–Z; empty = none). Colour: how the party sees it. Relations: the table (flag button).";
  input.setAttribute("aria-label", "Faction");
  Object.assign(input.style, { width: size, height: size, flex: `0 0 ${size}`, textAlign: "center", padding: "0",
    textTransform: "uppercase", fontWeight: "bold", margin: "0 2px", borderRadius: "4px",
    background: r ? `${relationCss(r)}55` : "", border: r ? `1px solid ${relationCss(r)}` : "" });
  for ( const type of ["click", "dblclick", "pointerdown", "mousedown", "contextmenu"] ) input.addEventListener(type, e => e.stopPropagation());
  input.addEventListener("keydown", e => { e.stopPropagation(); if ( e.key === "Enter" ) input.blur(); });
  input.addEventListener("change", () => setFaction(tokenDoc, input.value));
  return input;
}

function tableButton(scene) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "inline-control icon fa-solid fa-flag aet-faction-table";
  button.dataset.tooltip = "Faction relations";
  button.setAttribute("aria-label", "Faction relations");
  button.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); openRelationsWindow(scene); });
  return button;
}

function registerFactionFields() {
  // Combat tracker: a letter per combatant (edits its token) and a relations button in the header.
  Hooks.on("renderCombatTracker", (app, html) => {
    if ( !enabled() || !game.user.isGM ) return;
    const combat = app.viewed;
    const root = html instanceof HTMLElement ? html : html[0];
    const header = root.querySelector(".combat-tracker-header .encounter-controls, .encounter-controls, header");
    if ( header && !header.querySelector(".aet-faction-table") ) header.append(tableButton(combat?.scene ?? canvas?.scene));
    if ( !combat ) return;
    for ( const li of root.querySelectorAll("[data-combatant-id]") ) {
      const combatant = combat.combatants.get(li.dataset.combatantId);
      if ( !combatant?.token || !isCreature(combatant.actor) || li.querySelector(".aet-faction") ) continue;
      const controls = li.querySelector(".combatant-controls") ?? li.querySelector(".token-name, .name") ?? li;
      controls.prepend(letterInput(combatant.token));
    }
  });

  // Token HUD (GM): the letter and the relations button.
  Hooks.on("renderTokenHUD", (hud, html) => {
    if ( !enabled() || !game.user.isGM ) return;
    const tokenDoc = hud.object?.document;
    if ( !tokenDoc || !isCreature(tokenDoc.actor) ) return;
    const root = html instanceof HTMLElement ? html : html[0];
    const col = root.querySelector(".col.left") ?? root;
    if ( col.querySelector(".aet-faction") ) return;
    const wrap = document.createElement("div");
    wrap.className = "control-icon aet-faction-hud";
    Object.assign(wrap.style, { display: "flex", gap: "2px", alignItems: "center", justifyContent: "center", width: "auto", padding: "0 3px" });
    wrap.append(letterInput(tokenDoc, { size: "1.9em" }), tableButton(tokenDoc.parent));
    col.prepend(wrap);
  });

  // Actor sheets (GM): "Faction" — the seed new tokens of this actor start with.
  Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
    const actor = app.document;
    if ( !enabled() || !game.user.isGM || !(actor instanceof Actor) || !isCreature(actor) ) return;
    controls.push({ icon: "fa-solid fa-flag", label: "Faction", action: "aetFaction", visible: true, onClick: () => editSeed(actor) });
  });
}

/** The seed dialog: a letter, empty for automatic, "-" for none. */
async function editSeed(actor) {
  const own = actor.getFlag(MODULE_ID, "faction") ?? "";
  const auto = (actor.hasPlayerOwner ? partyLetter() : (actor.flags?.dnd5e?.summon?.origin ? "the summoner's" : NPC_DEFAULT));
  const esc = foundry.utils.escapeHTML;
  const value = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${actor.name} — Faction` }, position: { width: 400 }, rejectClose: false,
    content: `<p>The faction new tokens of this creature start with. Change a placed token's faction on the combat tracker or
      its Token HUD; relations between factions are in the scene's table.</p>
      <label style="display:flex;gap:8px;align-items:center"><span>Letter</span>
      <input name="faction" type="text" maxlength="1" value="${esc(own)}" placeholder="auto" style="width:3em;text-align:center;text-transform:uppercase"></label>
      <p class="hint">Empty: automatic (${esc(auto)} — players' creatures ${esc(partyLetter())}, summons their summoner's, other NPCs ${NPC_DEFAULT}). “-”: no faction.</p>`,
    ok: { label: "Save", callback: (event, button) => button.form.elements.faction.value }
  });
  if ( value === null || value === undefined ) return;
  await setSeed(actor, String(value).trim() === "-" ? "-" : value);
}
