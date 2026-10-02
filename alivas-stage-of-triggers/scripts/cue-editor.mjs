/**
 * Alivas's Stage of Triggers — editors.
 *
 *   CueEditor            one cue: its steps (kind, animation, sound, where, options). CueEditor.edit(cue, opts) → cue
 *   ItemAnimations       an item: each activity × moment (used, attack, hit, damage, area) + its effects
 *   EffectAnimations     an effect: start / while active / end
 *   ConditionAnimations  every condition: start / while active / end (world setting)
 *   MoveAnimations       teleport / push defaults for the engine (world setting)
 */

import { MODULE_ID, STEP_KINDS, KIND_LABEL, WHO_ENTRIES, newStep, normalizeCue, describeCue, playCue } from "./cues.mjs";
import { itemCues, effectCues, presetFor, statusCues } from "./sources.mjs";
import { Picker } from "./picker.mjs";

const { ApplicationV2 } = foundry.applications.api;
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
const clone = x => foundry.utils.deepClone(x);
const options = (entries, value) => entries.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value ?? "") ? " selected" : ""}>${esc(l)}</option>`).join("");
const short = path => String(path ?? "").split(".").slice(1).join(" › ").replace(/_/g, " ");

/* -------------------------------------------- */
/*  Recommendation context                      */
/* -------------------------------------------- */

/** What the picker should know about the thing being animated. */
export function contextFor({ item, activity, effect, status, phase, action } = {}) {
  const ctx = { words: [] };
  if ( item ) {
    ctx.name = item.name;
    if ( item.type === "spell" ) ctx.school = item.system.school;
    const acts = activity ? [activity] : [...(item.system.activities ?? [])];
    const types = new Set();
    for ( const a of acts ) {
      for ( const p of a.damage?.parts ?? [] ) for ( const t of p.types ?? [] ) types.add(t);
      if ( a.healing?.types ) for ( const t of a.healing.types ) types.add(t);
      if ( a.type === "heal" ) types.add("healing");
      ctx.activityType ??= a.type;
      if ( a.type === "attack" ) ctx.attackType ??= a.attack?.type?.value === "ranged" ? "ranged" : "melee";
      const shape = a.target?.template?.type;
      if ( shape ) ctx.targetShape ??= { sphere: "circle", radius: "circle", cylinder: "circle", cone: "cone", line: "line",
        cube: "square", square: "square", wall: "line" }[shape] ?? null;
    }
    ctx.damageTypes = [...types];
  }
  if ( effect ) {
    ctx.name = ctx.name ? `${ctx.name} ${effect.name}` : effect.name;
    ctx.statuses = [...(effect.statuses ?? [])];
    ctx.persistent = true;
  }
  if ( status ) { ctx.statuses = [status]; ctx.name = CONFIG.statusEffects.find(s => s.id === status)?.name ?? status; }
  if ( action?.type ) ctx.words.push(action.type);
  if ( phase ) ctx.phase = phase;
  return ctx;
}

/* -------------------------------------------- */
/*  Base                                        */
/* -------------------------------------------- */

class StageApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = { classes: ["ast-app"], window: { icon: "fa-solid fa-film", resizable: true } };
  async _renderHTML() { return this.html(); }
  _replaceHTML(result, content) {
    const scroll = content.querySelector(".ast-scroll")?.scrollTop ?? 0;
    content.innerHTML = result;
    const el = content.querySelector(".ast-scroll");
    if ( el ) el.scrollTop = scroll;
  }
}

/* -------------------------------------------- */
/*  CueEditor                                   */
/* -------------------------------------------- */

export class CueEditor extends StageApp {
  /**
   * Edit a cue in a window. Resolves with the new cue (null = removed), or undefined if cancelled.
   * @param {object|null} cue
   * @param {{title?: string, context?: object, kinds?: string[], persistent?: boolean}} opts
   */
  static edit(cue, opts={}) {
    return new Promise(resolve => new CueEditor(cue, { ...opts, resolve }).render({ force: true }));
  }

  constructor(cue, { title, context = {}, kinds, persistent = false, resolve }) {
    super({ window: { title: title ?? "Animation" }, position: { width: 640, height: 640 } });
    this.cue = clone(normalizeCue(cue) ?? { steps: [] });
    this.ctx = context;
    this.kinds = kinds;
    this.persistent = persistent;
    this.resolve = resolve;
    if ( !this.cue.steps.length ) this.cue.steps.push(newStep(this.defaultKind()));
  }

  defaultKind() {
    if ( this.persistent ) return "aura";
    const c = this.ctx.recommend ?? {};
    if ( this.ctx.phase === "attack" ) return c.attackType === "ranged" ? "projectile" : "melee";
    if ( this.ctx.phase === "area" ) return "area";
    return "onToken";
  }

  static DEFAULT_OPTIONS = {
    actions: {
      addStep: CueEditor.#onAddStep, removeStep: CueEditor.#onRemoveStep, moveStep: CueEditor.#onMoveStep,
      setKind: CueEditor.#onSetKind, pick: CueEditor.#onPick, clearFile: CueEditor.#onClearFile,
      preview: CueEditor.#onPreview, save: CueEditor.#onSave, cancel: CueEditor.#onCancel
    }
  };

  html() {
    const steps = this.cue.steps.map((s, i) => this.stepHtml(s, i)).join("");
    return `<div class="ast-editor">
      <div class="ast-scroll">${steps}
        <button type="button" class="ast-add" data-action="addStep"><i class="fa-solid fa-plus"></i> Add a step <span class="ast-muted">(played after the one above)</span></button>
      </div>
      <footer class="ast-footer">
        <span class="ast-muted ast-summary">${esc(describeCue(this.cue) || "Nothing plays yet.")}</span>
        <button type="button" data-action="preview"><i class="fa-solid fa-play"></i> Preview</button>
        <button type="button" data-action="cancel">Cancel</button>
        <button type="button" class="ast-primary" data-action="save"><i class="fa-solid fa-check"></i> Save</button>
      </footer></div>`;
  }

  stepHtml(s, i) {
    const kinds = (this.kinds ? STEP_KINDS.filter(([k]) => this.kinds.includes(k)) : STEP_KINDS).map(([id, icon, label, hint]) =>
      `<button type="button" class="ast-kind${s.kind === id ? " active" : ""}" data-action="setKind" data-kind="${id}" data-tooltip="${esc(hint)}">
        <i class="fa-solid ${icon}"></i><span>${esc(label)}</span></button>`).join("");
    const who = (path, value, list) => `<select data-path="${path}">${options(WHO_ENTRIES.filter(([k]) => list.includes(k)), value)}</select>`;
    const roles = ["source", "targets", "subject", "bearer"];
    let where = "";
    if ( ["projectile", "melee"].includes(s.kind) ) where = `<label><span>From</span>${who(`steps.${i}.from`, s.from ?? "source", roles)}</label>
      <label><span>To</span>${who(`steps.${i}.to`, s.to ?? "targets", roles)}</label>`;
    else if ( !["sound", "teleport", "area"].includes(s.kind) ) where = `<label><span>On</span>${who(`steps.${i}.at`, s.at ?? "targets", [...roles, "region"])}</label>`;
    const fileRow = s.kind === "sound" ? "" : `<div class="ast-file">
      <span class="ast-label">Animation</span>
      ${s.file ? `<span class="ast-chosen" data-tooltip="${esc(s.file)}">${esc(short(s.file))}</span>` : '<span class="ast-muted">none</span>'}
      <button type="button" data-action="pick" data-what="file"><i class="fa-solid fa-magnifying-glass"></i> ${s.file ? "Change" : "Choose"}</button>
      ${s.file ? '<button type="button" class="ast-icon" data-action="clearFile" data-what="file" data-tooltip="Remove"><i class="fa-solid fa-xmark"></i></button>' : ""}</div>`;
    const soundFile = s.kind === "sound" ? s.file : s.sound?.file;
    const soundRow = `<div class="ast-file">
      <span class="ast-label">Sound</span>
      ${soundFile ? `<span class="ast-chosen" data-tooltip="${esc(soundFile)}">${esc(short(soundFile))}</span>` : '<span class="ast-muted">none</span>'}
      <button type="button" data-action="pick" data-what="sound"><i class="fa-solid fa-magnifying-glass"></i> ${soundFile ? "Change" : "Choose"}</button>
      ${soundFile ? '<button type="button" class="ast-icon" data-action="clearFile" data-what="sound" data-tooltip="Remove"><i class="fa-solid fa-xmark"></i></button>' : ""}
      ${soundFile && s.kind !== "sound" ? `<label class="ast-mini"><span>Volume</span><input type="number" min="0" max="1" step="0.05" data-path="steps.${i}.sound.volume" value="${esc(s.sound?.volume ?? 0.6)}"></label>
        <label class="ast-mini"><span>Delay</span><input type="number" min="0" step="50" data-path="steps.${i}.sound.delay" value="${esc(s.sound?.delay ?? 0)}"><span class="ast-muted">ms</span></label>` : ""}</div>`;
    const canPersist = ["onToken", "aura", "area"].includes(s.kind);
    const opts = s.kind === "sound" ? "" : `<details class="ast-more"${(s.scale ?? 1) !== 1 || s.delay || s.below || s.persist || s.repeats > 1 ? " open" : ""}><summary>Options</summary><div class="ast-grid">
      <label><span>Size ×</span><input type="number" step="0.1" min="0.1" data-path="steps.${i}.scale" value="${esc(s.scale ?? 1)}"></label>
      <label><span>Opacity</span><input type="number" step="0.05" min="0" max="1" data-path="steps.${i}.opacity" value="${esc(s.opacity ?? 1)}"></label>
      <label><span>Delay</span><input type="number" step="50" min="0" data-path="steps.${i}.delay" value="${esc(s.delay ?? 0)}"><span class="ast-muted">ms</span></label>
      <label><span>Repeat</span><input type="number" step="1" min="1" data-path="steps.${i}.repeats" value="${esc(s.repeats ?? 1)}"></label>
      <label><span>Next step</span><select data-path="steps.${i}.wait">${options([["", "starts with this one"], ["finish", "waits for this one to finish"]], s.wait ?? "")}</select></label>
      <label class="ast-check"><input type="checkbox" data-path="steps.${i}.below" data-type="boolean"${s.below ? " checked" : ""}><span>Under tokens</span></label>
      ${canPersist ? `<label class="ast-check"><input type="checkbox" data-path="steps.${i}.persist" data-type="boolean"${s.persist ? " checked" : ""}><span>Stays while it lasts (effect, area, condition)</span></label>` : ""}
      ${["projectile", "melee"].includes(s.kind) ? `<div class="ast-file ast-wide"><span class="ast-label">On a miss</span>
        ${s.missFile ? `<span class="ast-chosen">${esc(short(s.missFile))}</span>` : '<span class="ast-muted">same animation, missing</span>'}
        <button type="button" data-action="pick" data-what="missFile"><i class="fa-solid fa-magnifying-glass"></i> Choose</button>
        ${s.missFile ? '<button type="button" class="ast-icon" data-action="clearFile" data-what="missFile"><i class="fa-solid fa-xmark"></i></button>' : ""}</div>` : ""}
      </div></details>`;
    const n = this.cue.steps.length;
    return `<section class="ast-step" data-index="${i}">
      <header><span class="ast-badge">${i + 1}</span><strong>${esc(KIND_LABEL[s.kind] ?? s.kind)}</strong>
        <span class="ast-step-tools">
          ${i > 0 ? '<button type="button" class="ast-icon" data-action="moveStep" data-dir="-1" data-tooltip="Earlier"><i class="fa-solid fa-arrow-up"></i></button>' : ""}
          ${i < n - 1 ? '<button type="button" class="ast-icon" data-action="moveStep" data-dir="1" data-tooltip="Later"><i class="fa-solid fa-arrow-down"></i></button>' : ""}
          <button type="button" class="ast-icon ast-danger" data-action="removeStep" data-tooltip="Remove step"><i class="fa-solid fa-trash"></i></button></span></header>
      <div class="ast-kinds">${kinds}</div>
      ${fileRow}${soundRow}
      ${where ? `<div class="ast-where">${where}</div>` : ""}
      ${opts}</section>`;
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this.element.addEventListener("change", ev => {
      const el = ev.target;
      if ( !el.dataset.path ) return;
      let v = el.type === "checkbox" ? el.checked : el.value;
      if ( el.type === "number" ) v = el.value === "" ? undefined : Number(el.value);
      if ( v === "" ) v = undefined;
      foundry.utils.setProperty(this.cue, el.dataset.path, v);
      this.element.querySelector(".ast-summary").textContent = describeCue(this.cue) || "Nothing plays yet.";
    });
  }

  _onClose(options) {
    super._onClose?.(options);
    this.resolve?.(undefined);
    this.resolve = null;
  }

  static #i(target) { return Number(target.closest(".ast-step")?.dataset.index); }

  static #onAddStep() {
    const last = this.cue.steps.at(-1);
    this.cue.steps.push(newStep(last?.kind === "projectile" ? "impact" : "onToken"));
    this.render();
  }
  static #onRemoveStep(ev, t) { this.cue.steps.splice(CueEditor.#i(t), 1); this.render(); }
  static #onMoveStep(ev, t) {
    const i = CueEditor.#i(t), j = i + Number(t.dataset.dir);
    [this.cue.steps[i], this.cue.steps[j]] = [this.cue.steps[j], this.cue.steps[i]];
    this.render();
  }
  static #onSetKind(ev, t) {
    const i = CueEditor.#i(t);
    const old = this.cue.steps[i];
    const step = newStep(t.dataset.kind);
    step.file = t.dataset.kind === "sound" ? (old.sound?.file ?? "") : old.file;
    if ( old.sound && (t.dataset.kind !== "sound") ) step.sound = old.sound;
    this.cue.steps[i] = step;
    this.render();
  }
  static async #onPick(ev, t) {
    const i = CueEditor.#i(t);
    const s = this.cue.steps[i];
    const what = t.dataset.what;
    const sound = (what === "sound") || (s.kind === "sound");
    const current = what === "sound" ? (s.kind === "sound" ? s.file : s.sound?.file) : s[what];
    const path = await Picker.pick({ mode: sound ? "sound" : "animation", cue: sound ? "sound" : s.kind, current,
      context: { ...this.ctx.recommend, persistent: !!s.persist || this.persistent } });
    if ( !path ) return;
    if ( what === "sound" && s.kind !== "sound" ) s.sound = { volume: 0.6, ...(s.sound ?? {}), file: path };
    else if ( what === "sound" ) s.file = path;
    else s[what] = path;
    this.render();
  }
  static #onClearFile(ev, t) {
    const s = this.cue.steps[CueEditor.#i(t)];
    const what = t.dataset.what;
    if ( what === "sound" && s.kind !== "sound" ) delete s.sound;
    else if ( (what === "sound") || (what === "file") ) s.file = "";
    else delete s[what];
    this.render();
  }
  static #onPreview() { game.modules.get(MODULE_ID).api?.previewCue?.(this.cue); }
  static #onSave() {
    const r = this.resolve;
    this.resolve = null;
    r?.(normalizeCue(this.cue));
    this.close();
  }
  static #onCancel() { this.close(); }
}

/* -------------------------------------------- */
/*  Shared: a table of moments → cues           */
/* -------------------------------------------- */

/** A row: label, the cue, whether it comes from a preset, buttons. */
function cueRow(key, label, hint, cue, { preset=false }={}) {
  const c = normalizeCue(cue);
  return `<div class="ast-row" data-key="${esc(key)}">
    <div class="ast-row-label"><strong>${esc(label)}</strong>${hint ? `<small>${esc(hint)}</small>` : ""}</div>
    <div class="ast-row-cue">${c ? `${preset ? '<span class="ast-tag">preset</span> ' : ""}${esc(describeCue(c))}` : '<span class="ast-muted">—</span>'}</div>
    <div class="ast-row-tools">
      <button type="button" data-action="editCue" data-tooltip="${c ? (preset ? "Customize" : "Edit") : "Add"}"><i class="fa-solid ${c ? "fa-pen" : "fa-plus"}"></i></button>
      ${c ? '<button type="button" data-action="previewCue" data-tooltip="Preview"><i class="fa-solid fa-play"></i></button>' : ""}
      ${c && !preset ? '<button type="button" class="ast-danger" data-action="clearCue" data-tooltip="Remove"><i class="fa-solid fa-xmark"></i></button>' : ""}
    </div></div>`;
}

const ITEM_PHASES = [
  ["use", "When used", "the user casting or using it, aimed at its targets"],
  ["attack", "Attack", "the attack itself — projectiles and swings know who was hit or missed"],
  ["hit", "On a hit", "on each creature the attack hit"],
  ["damage", "Damage / healing", "when its damage or healing is rolled"],
  ["area", "Area placed", "when its area is placed — “stays while it lasts” keeps it until the area goes"]
];
const EFFECT_PHASES = [
  ["start", "Starts", "when it's applied"],
  ["active", "While active", "stays on the creature until it ends (tick “stays while it lasts”)"],
  ["end", "Ends", "when it ends"]
];

/* -------------------------------------------- */
/*  ItemAnimations                              */
/* -------------------------------------------- */

const OPEN = new Map();

export class ItemAnimations extends StageApp {
  static open(item) {
    const app = OPEN.get(item.uuid) ?? new ItemAnimations(item);
    OPEN.set(item.uuid, app);
    return app.render({ force: true });
  }

  constructor(item) {
    super({ window: { title: `Animations — ${item.name}` }, position: { width: 760, height: 680 } });
    this.item = item;
  }

  static DEFAULT_OPTIONS = { actions: { editCue: ItemAnimations.#onEdit, previewCue: ItemAnimations.#onPreview,
    clearCue: ItemAnimations.#onClear, editEffect: ItemAnimations.#onEditEffect, resetAll: ItemAnimations.#onReset } };

  get own() { return this.item.getFlag(MODULE_ID, "cues") ?? {}; }

  html() {
    const item = this.item;
    const preset = presetFor(item);
    const hasOwn = Object.keys(this.own).length > 0;
    const acts = [...(item.system.activities ?? [])];
    const blocks = (acts.length ? acts : [null]).map(a => {
      const { cues, preset: fromPreset } = itemCues(item, a);
      const phases = ITEM_PHASES.filter(([p]) => (p !== "attack" && p !== "hit") || a?.type === "attack")
        .filter(([p]) => p !== "area" || a?.target?.template?.type);
      return `<section class="ast-block"><h3>${a ? esc(a.name || a.type) : "The item"} ${a ? `<small class="ast-muted">${esc(a.type)}</small>` : ""}</h3>
        ${phases.map(([p, label, hint]) => cueRow(`${a?.id ?? "*"}.${p}`, label, hint, cues?.[p], { preset: fromPreset && !hasOwn })).join("")}</section>`;
    }).join("");
    const effects = item.effects.contents.map(e => {
      const c = effectCues(e);
      const own = !!e.getFlag(MODULE_ID, "cue");
      const summary = EFFECT_PHASES.map(([p, label]) => normalizeCue(c?.[p]) ? `${label}: ${describeCue(c[p])}` : "").filter(Boolean).join(" · ");
      return `<div class="ast-row"><div class="ast-row-label"><strong>${esc(e.name)}</strong><small>effect</small></div>
        <div class="ast-row-cue">${summary ? `${!own && preset ? '<span class="ast-tag">preset</span> ' : ""}${esc(summary)}` : '<span class="ast-muted">—</span>'}</div>
        <div class="ast-row-tools"><button type="button" data-action="editEffect" data-effect="${e.id}" data-tooltip="Edit"><i class="fa-solid fa-pen"></i></button></div></div>`;
    }).join("");
    return `<div class="ast-scroll">
      ${preset ? `<p class="ast-note"><i class="fa-solid fa-wand-magic-sparkles"></i> ${hasOwn ? "This item has its own animations (the built-in preset is ignored)."
        : "Using the built-in preset. Editing a moment makes this item's animations its own."}
        ${hasOwn ? '<button type="button" data-action="resetAll"><i class="fa-solid fa-rotate-left"></i> Back to the preset</button>' : ""}</p>` : ""}
      ${blocks}
      ${effects ? `<section class="ast-block"><h3>Effects</h3>${effects}</section>` : ""}</div>`;
  }

  /** The item's own cues, seeded from the preset the first time. */
  ownForEdit() {
    const own = clone(this.own);
    if ( Object.keys(own).length ) return own;
    const preset = presetFor(this.item);
    if ( !preset?.activities ) return {};
    const out = {};
    for ( const a of this.item.system.activities ?? [] ) {
      const c = preset.activities[a.name] ?? preset.activities["*"];
      if ( c ) out[a.id] = clone(c);
    }
    if ( !this.item.system.activities?.size && preset.activities["*"] ) out["*"] = clone(preset.activities["*"]);
    return out;
  }

  static async #onEdit(ev, t) {
    const [aid, phase] = t.closest(".ast-row").dataset.key.split(".");
    const activity = aid === "*" ? null : this.item.system.activities?.get(aid);
    const { cues } = itemCues(this.item, activity);
    const cue = await CueEditor.edit(cues?.[phase], { title: `${this.item.name} — ${ITEM_PHASES.find(p => p[0] === phase)?.[1]}`,
      context: { phase, recommend: { ...contextFor({ item: this.item, activity, phase }), phase } } });
    if ( cue === undefined ) return;
    const own = this.ownForEdit();
    own[aid] ??= {};
    if ( cue ) own[aid][phase] = cue; else delete own[aid][phase];
    await this.item.update({ [`flags.${MODULE_ID}.-=cues`]: null }, { render: false });
    await this.item.setFlag(MODULE_ID, "cues", own);
    this.render();
  }
  static #onPreview(ev, t) {
    const [aid, phase] = t.closest(".ast-row").dataset.key.split(".");
    const activity = aid === "*" ? null : this.item.system.activities?.get(aid);
    game.modules.get(MODULE_ID).api.previewCue(itemCues(this.item, activity).cues?.[phase]);
  }
  static async #onClear(ev, t) {
    const [aid, phase] = t.closest(".ast-row").dataset.key.split(".");
    const own = this.ownForEdit();
    if ( own[aid] ) delete own[aid][phase];
    await this.item.update({ [`flags.${MODULE_ID}.-=cues`]: null }, { render: false });
    await this.item.setFlag(MODULE_ID, "cues", own);
    this.render();
  }
  static async #onReset() {
    await this.item.unsetFlag(MODULE_ID, "cues");
    this.render();
  }
  static #onEditEffect(ev, t) {
    const effect = this.item.effects.get(t.dataset.effect);
    if ( effect ) EffectAnimations.open(effect, { onSave: () => this.render() });
  }
}

/* -------------------------------------------- */
/*  EffectAnimations                            */
/* -------------------------------------------- */

export class EffectAnimations extends StageApp {
  static open(effect, opts={}) {
    return new EffectAnimations(effect, opts).render({ force: true });
  }

  constructor(effect, { onSave } = {}) {
    super({ window: { title: `Animations — ${effect.name}` }, position: { width: 680, height: 380 } });
    this.effect = effect;
    this.onSave = onSave;
  }

  static DEFAULT_OPTIONS = { actions: { editCue: EffectAnimations.#onEdit, previewCue: EffectAnimations.#onPreview,
    clearCue: EffectAnimations.#onClear } };

  html() {
    const own = this.effect.getFlag(MODULE_ID, "cue");
    const cues = effectCues(this.effect) ?? {};
    return `<div class="ast-scroll"><section class="ast-block">
      ${EFFECT_PHASES.map(([p, label, hint]) => cueRow(p, label, hint, cues[p], { preset: !own && !!cues[p] })).join("")}</section>
      ${this.effect.statuses?.size ? `<p class="ast-note">Its conditions (${[...this.effect.statuses].join(", ")}) also play their own animations — see the module settings, Conditions.</p>` : ""}</div>`;
  }

  item() {
    const p = this.effect.parent;
    return p?.documentName === "Item" ? p : null;
  }

  static async #onEdit(ev, t) {
    const phase = t.closest(".ast-row").dataset.key;
    const cues = clone(effectCues(this.effect) ?? {});
    const cue = await CueEditor.edit(cues[phase], { title: `${this.effect.name} — ${EFFECT_PHASES.find(p => p[0] === phase)[1]}`,
      persistent: phase === "active",
      context: { phase, recommend: { ...contextFor({ item: this.item(), effect: this.effect }), persistent: phase === "active", cue: phase === "active" ? "aura" : "onToken" } } });
    if ( cue === undefined ) return;
    if ( cue ) {
      if ( phase === "active" ) for ( const s of cue.steps ) if ( ["onToken", "aura", "area"].includes(s.kind) && (s.persist === undefined) ) s.persist = true;
      cues[phase] = cue;
    } else delete cues[phase];
    await this.effect.update({ [`flags.${MODULE_ID}.-=cue`]: null }, { render: false });
    await this.effect.setFlag(MODULE_ID, "cue", cues);
    this.onSave?.();
    this.render();
  }
  static #onPreview(ev, t) {
    game.modules.get(MODULE_ID).api.previewCue((effectCues(this.effect) ?? {})[t.closest(".ast-row").dataset.key]);
  }
  static async #onClear(ev, t) {
    const cues = clone(this.effect.getFlag(MODULE_ID, "cue") ?? {});
    delete cues[t.closest(".ast-row").dataset.key];
    await this.effect.update({ [`flags.${MODULE_ID}.-=cue`]: null }, { render: false });
    if ( Object.keys(cues).length ) await this.effect.setFlag(MODULE_ID, "cue", cues);
    this.onSave?.();
    this.render();
  }
}

/* -------------------------------------------- */
/*  Settings windows                            */
/* -------------------------------------------- */

export class ConditionAnimations extends StageApp {
  constructor(options={}) {
    super(foundry.utils.mergeObject({ window: { title: "Condition animations" }, position: { width: 820, height: 720 } }, options));
  }
  static DEFAULT_OPTIONS = { actions: { editCue: ConditionAnimations.#onEdit, previewCue: ConditionAnimations.#onPreview,
    clearCue: ConditionAnimations.#onClear } };

  html() {
    const own = game.settings.get(MODULE_ID, "statusCues") ?? {};
    const rows = CONFIG.statusEffects.filter(s => s.id && s.name).map(s => {
      const cues = statusCues(s.id) ?? {};
      const preset = !own[s.id];
      return `<section class="ast-block ast-compact"><h3><img src="${esc(s.img)}" alt=""> ${esc(game.i18n.localize(s.name))}</h3>
        ${EFFECT_PHASES.map(([p, label, hint]) => cueRow(`${s.id}.${p}`, label, "", cues[p], { preset: preset && !!cues[p] })).join("")}</section>`;
    }).join("");
    return `<div class="ast-scroll">${rows}</div>`;
  }
  static async #onEdit(ev, t) {
    const [id, phase] = t.closest(".ast-row").dataset.key.split(".");
    const all = clone(game.settings.get(MODULE_ID, "statusCues") ?? {});
    const cues = all[id] ?? clone(statusCues(id) ?? {});
    const cue = await CueEditor.edit(cues[phase], { title: `${id} — ${phase}`, persistent: phase === "active",
      context: { phase, recommend: { ...contextFor({ status: id }), cue: phase === "active" ? "marker" : "onToken", persistent: phase === "active" } } });
    if ( cue === undefined ) return;
    if ( cue ) cues[phase] = cue; else delete cues[phase];
    all[id] = cues;
    await game.settings.set(MODULE_ID, "statusCues", all);
    this.render();
  }
  static #onPreview(ev, t) {
    const [id, phase] = t.closest(".ast-row").dataset.key.split(".");
    game.modules.get(MODULE_ID).api.previewCue(statusCues(id)?.[phase]);
  }
  static async #onClear(ev, t) {
    const [id, phase] = t.closest(".ast-row").dataset.key.split(".");
    const all = clone(game.settings.get(MODULE_ID, "statusCues") ?? {});
    all[id] = all[id] ?? clone(statusCues(id) ?? {});
    delete all[id][phase];
    await game.settings.set(MODULE_ID, "statusCues", all);
    this.render();
  }
}

export class MoveAnimations extends StageApp {
  constructor(options={}) {
    super(foundry.utils.mergeObject({ window: { title: "Teleport and forced movement" }, position: { width: 680, height: 320 } }, options));
  }
  static DEFAULT_OPTIONS = { actions: { editCue: MoveAnimations.#onEdit, previewCue: MoveAnimations.#onPreview,
    clearCue: MoveAnimations.#onClear } };
  html() {
    const cues = game.settings.get(MODULE_ID, "moveCues") ?? {};
    return `<div class="ast-scroll"><section class="ast-block">
      ${cueRow("teleport", "Teleport", "vanish and appear (Misty Step, Wild Surge, Accelerate…)", cues.teleport)}
      ${cueRow("push", "Push / pull", "on the creature moved", cues.push)}</section>
      <p class="ast-note">Used when the engine's teleport or push action has no animation of its own.</p></div>`;
  }
  static async #onEdit(ev, t) {
    const key = t.closest(".ast-row").dataset.key;
    const all = clone(game.settings.get(MODULE_ID, "moveCues") ?? {});
    const cue = await CueEditor.edit(all[key], { title: key, context: { recommend: { name: key === "teleport" ? "misty step teleport" : "push shove impact", cue: key === "teleport" ? "onToken" : "impact" } } });
    if ( cue === undefined ) return;
    if ( cue ) all[key] = cue; else delete all[key];
    await game.settings.set(MODULE_ID, "moveCues", all);
    this.render();
  }
  static #onPreview(ev, t) { game.modules.get(MODULE_ID).api.previewCue(game.settings.get(MODULE_ID, "moveCues")?.[t.closest(".ast-row").dataset.key]); }
  static async #onClear(ev, t) {
    const all = clone(game.settings.get(MODULE_ID, "moveCues") ?? {});
    delete all[t.closest(".ast-row").dataset.key];
    await game.settings.set(MODULE_ID, "moveCues", all);
    this.render();
  }
}
