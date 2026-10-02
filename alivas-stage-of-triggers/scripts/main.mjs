/**
 * Alivas's Stage of Triggers — animations and sounds for everything Alivas's Engine of Triggers and dnd5e do.
 *
 * Plays through Sequencer (JB2A animations, PSFX sounds). Works alongside Automated Animations: anything this module
 * animates, it owns (Automated Animations is told to skip it); everything else Automated Animations keeps playing —
 * only with whole-word name matches (no "Natural Armor" → "Alarm").
 *
 *   cues.mjs        the cue format and the Sequencer player
 *   sources.mjs     where cues come from (items, effects, conditions, engine actions, presets) and when they play
 *   cue-editor.mjs  the cue editor, the item / effect animation windows, the settings windows
 *   picker.mjs      the animation / sound browser (search, filters, recommendations)
 *   catalog.mjs     the searchable catalog built from Sequencer's database
 */

import { MODULE_ID, playCue, describeCue, normalizeCue } from "./cues.mjs";
import * as Sources from "./sources.mjs";
import { CueEditor, ItemAnimations, EffectAnimations, ConditionAnimations, MoveAnimations, contextFor } from "./cue-editor.mjs";
import { registerPickerSettings } from "./picker.mjs";

Hooks.once("init", () => {
  registerPickerSettings();
  const reg = (key, data) => game.settings.register(MODULE_ID, key, data);
  reg("enabled", { name: "Play animations", hint: "On this device. Sounds and animations from this module (and its presets).",
    scope: "client", config: true, type: Boolean, default: true });
  reg("volume", { name: "Sound volume", hint: "Multiplies every sound this module plays, on this device.",
    scope: "client", config: true, type: Number, default: 1, range: { min: 0, max: 1, step: 0.05 } });
  reg("presets", { name: "Use the built-in presets", hint: "Animations for the Box of Triggers' items, spells and features, and "
    + "for conditions, whenever an item or effect has none of its own.",
    scope: "world", config: true, type: Boolean, default: true, onChange: () => Sources.loadPresets() });
  reg("aaHandOff", { name: "Take over from Automated Animations", hint: "When this module has an animation for something, "
    + "Automated Animations doesn't play its own for it.", scope: "world", config: true, type: Boolean, default: true });
  reg("aaGuard", { name: "Automated Animations: whole-word matches only", hint: "Automated Animations matches its presets "
    + "anywhere inside a name (Natural Armor → Alarm, Spellcasting → Sting, “(Recharge 5–6)” → Charge). With this on, its "
    + "preset only plays when the preset's name appears as whole words.", scope: "world", config: true, type: Boolean, default: true });
  reg("statusCues", { scope: "world", config: false, type: Object, default: {} });
  reg("moveCues", { scope: "world", config: false, type: Object, default: {
    teleport: { steps: [{ kind: "teleport", file: "jb2a.misty_step.01.blue", sound: { file: "psfx.2nd-level-spells.misty-step.v1.001", volume: 0.5 } }] },
    push: { steps: [{ kind: "impact", at: "targets", file: "jb2a.impact.002.white", scale: 1 }] }
  } });
  reg("debug", { name: "Debug logging", scope: "client", config: true, type: Boolean, default: false });
  game.settings.registerMenu(MODULE_ID, "conditions", { name: "Condition animations", label: "Conditions…",
    hint: "Animations and sounds when a condition starts, while it lasts, and when it ends.", icon: "fa-solid fa-person-falling",
    type: ConditionAnimations, restricted: true });
  game.settings.registerMenu(MODULE_ID, "moves", { name: "Teleport and forced movement", label: "Moves…",
    hint: "What plays when Alivas's Engine teleports, pushes or pulls a creature and the action has no animation of its own.",
    icon: "fa-solid fa-person-through-window", type: MoveAnimations, restricted: true });
});

/* -------------------------------------------- */
/*  Alivas's Engine of Triggers                 */
/* -------------------------------------------- */

Hooks.once("alivasTriggers.ready", api => {
  // An action that only plays a cue.
  api.registerAction("animate", {
    label: "Animation / sound", icon: "fa-film", hint: "Play an animation or a sound (no other effect)",
    defaults: { cue: null },
    describe: a => normalizeCue(a.cue) ? `play ${describeCue(a.cue)}` : "play an animation (none chosen yet)",
    validate: a => normalizeCue(a.cue) ? [] : ["Animation: choose an animation or a sound."],
    fields: (a) => sectionBody(a.cue, "extAction", ""),
    onAction: (op, { editor, model }) => cueOp(op, model, "cue", editor),
    run: async (trigger, effect, bearer, event, context) => {
      await playCue(trigger.action.cue, Sources.actionContext({ effect, bearer, context, moves: [] }));
      return {};
    }
  });
  // Every other action: an optional animation that plays with it.
  api.registerEditorSection({
    id: "stage",
    render: ({ model }) => {
      if ( !model?.action?.type || (model.action.type === "animate") || (model.action.type === "note") ) return "";
      return `<details class="ast-section"${normalizeCue(model.action.animation) ? " open" : ""}>
        <summary><i class="fa-solid fa-film"></i> Animation and sound <span class="aet-muted">(optional)</span></summary>
        ${sectionBody(model.action.animation, "extSection", ' data-section="stage"')}</details>`;
    },
    describe: model => (model?.action?.type !== "animate") && normalizeCue(model?.action?.animation) ? `with ${describeCue(model.action.animation).toLowerCase()}` : "",
    onAction: (op, { editor, model }) => cueOp(op, model, "animation", editor)
  });
});

/** The cue summary + buttons shown in the engine's editor. */
function sectionBody(cue, action, extra) {
  const c = normalizeCue(cue);
  return `<div class="ast-cue-summary">
    <span class="${c ? "" : "aet-muted"}">${c ? foundry.utils.escapeHTML(describeCue(c)) : "Nothing plays."}</span>
    <span class="ast-cue-buttons">
      <button type="button" class="aet-add-small aet-edit" data-action="${action}"${extra} data-op="edit"><i class="fa-solid fa-pen"></i> ${c ? "Edit" : "Choose"}</button>
      ${c ? `<button type="button" class="aet-add-small aet-edit" data-action="${action}"${extra} data-op="preview"><i class="fa-solid fa-play"></i> Preview</button>
      <button type="button" class="aet-icon aet-danger aet-edit" data-action="${action}"${extra} data-op="clear" data-tooltip="Remove"><i class="fa-solid fa-xmark"></i></button>` : ""}
    </span></div>`;
}

/** Edit / preview / clear a cue stored at model.action[key]. Returns false when nothing changed yet (async edit). */
async function cueOp(op, model, key, editor) {
  const a = model.action;
  if ( op === "clear" ) { delete a[key]; return true; }
  if ( op === "preview" ) { previewCue(a[key]); return false; }
  if ( op === "edit" ) {
    const doc = editor.document;
    const item = doc?.documentName === "Item" ? doc : (doc?.parent?.documentName === "Item" ? doc.parent : null);
    const effect = doc?.documentName === "ActiveEffect" ? doc : null;
    const recommend = contextFor({ item, effect, activity: editor.activity, action: a });
    if ( a.type === "teleport" ) recommend.words.push("teleport", "misty", "step");
    if ( a.type === "push" ) recommend.words.push("push", "shockwave", "impact");
    if ( a.damageType ) recommend.damageTypes = [...(recommend.damageTypes ?? []), a.damageType];
    const cue = await CueEditor.edit(a[key], { title: `Animation — ${editor.title ?? ""}`,
      context: { recommend: { ...recommend, events: model.events } } });
    if ( cue === undefined ) return false;
    if ( normalizeCue(cue) ) a[key] = cue; else delete a[key];
    editor.render();
    return false;
  }
  return false;
}

/** Preview a cue on the selected token (or the first owned one), aimed at the user's targets. */
export function previewCue(cue) {
  const source = canvas.tokens.controlled[0] ?? canvas.tokens.ownedTokens?.[0];
  if ( !source ) return ui.notifications.warn("Select a token to preview on.");
  const targets = [...game.user.targets].filter(t => t !== source);
  const tgts = targets.length ? targets : [source];
  const radius = 10;
  const units = canvas.grid.size / canvas.scene.grid.distance;
  const region = { x: (tgts[0].center ?? source.center).x, y: (tgts[0].center ?? source.center).y, radius, shape: "circle" };
  const moves = [{ token: source.document, from: { x: source.document.x, y: source.document.y },
    to: { x: source.document.x + (2 * canvas.grid.size), y: source.document.y }, kind: "teleport" }];
  const hit = new Map(tgts.map(t => [t.id, true]));
  return playCue(cue, { source: source.document, bearer: source.document, targets: tgts.map(t => t.document),
    subject: tgts[0].document, region, radius: 10, moves, hit, origin: null, preview: units }, { local: true });
}

/* -------------------------------------------- */
/*  Sheets                                      */
/* -------------------------------------------- */

/** Header controls on item and effect sheets (ApplicationV2). */
Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
  const activity = app.activity ?? (app.document?.documentName === "Activity" ? app.document : null);
  if ( activity?.item ) {
    if ( activity.item.isOwner ) controls.push({ icon: "fa-solid fa-film", label: "Animations", action: "astAnimations",
      onClick: () => ItemAnimations.open(activity.item) });
    return;
  }
  const doc = app.document;
  if ( !doc?.isOwner ) return;
  if ( doc.documentName === "Item" ) controls.push({ icon: "fa-solid fa-film", label: "Animations", action: "astAnimations",
    onClick: () => ItemAnimations.open(doc) });
  if ( doc.documentName === "ActiveEffect" ) controls.push({ icon: "fa-solid fa-film", label: "Animations", action: "astAnimations",
    onClick: () => EffectAnimations.open(doc) });
});

/* -------------------------------------------- */
/*  Ready                                       */
/* -------------------------------------------- */

Hooks.once("ready", async () => {
  Sources.loadPresets();
  Sources.registerActivityHooks();
  Sources.registerEffectHooks();
  Sources.registerEngineHooks();
  Sources.registerAutomatedAnimationsGuard();
  game.modules.get(MODULE_ID).api = { playCue, describeCue, previewCue, sources: Sources, CueEditor };
  if ( !globalThis.Sequencer ) ui.notifications.warn("Alivas's Stage of Triggers needs the Sequencer module to play anything.");
});
