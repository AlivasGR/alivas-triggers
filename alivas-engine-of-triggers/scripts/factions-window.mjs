/**
 * Alivas's Engine of Triggers — the faction relations window (GM). Spec: tasks/T-026-factions-spec.md,
 * "Relations table, one per scene". Uses the API in factions.mjs (imports are used at call time only, so the circular
 * import with factions.mjs is harmless).
 *
 * One window per scene. A grid of the factions in use: a cell is how the ROW faction regards the COLUMN faction; a click
 * cycles ally -> neutral -> hostile. Hovering a letter outlines that faction's tokens on the map, clicking pins the outline.
 */

import {
  factionOf, relationOf, lettersInUse, tokensOf, setRelation, addFaction, copyTable, isLinked, setLinked,
  perspective, relationCss
} from "./factions.mjs";

const { ApplicationV2 } = foundry.applications.api;
const CYCLE = ["ally", "neutral", "hostile"];

/* -------------------------------------------- */
/*  Map highlights                              */
/* -------------------------------------------- */

/** sceneId -> { pinned: Set<letter>, hover: letter|null } */
const marks = new Map();
/** letter -> PIXI.Graphics (only for canvas.scene) */
const graphics = new Map();
let teardownHook = null;

const markState = scene => {
  if ( !marks.has(scene.id) ) marks.set(scene.id, { pinned: new Set(), hover: null });
  return marks.get(scene.id);
};

function clearGraphics() {
  for ( const g of graphics.values() ) { try { g.parent?.removeChild(g); g.destroy(); } catch(err) { /* gone with the canvas */ } }
  graphics.clear();
}

/** Redraw the outlines for a scene's pinned and hovered letters (only if that scene is the one on screen). */
function redrawHighlights(scene) {
  clearGraphics();
  try {
    if ( !scene || !canvas?.ready || (canvas.scene !== scene) ) return;
    const state = markState(scene);
    const active = new Set(state.pinned);
    if ( state.hover ) active.add(state.hover);
    const layer = canvas.controls ?? canvas.interface;
    if ( !layer ) return;
    for ( const letter of active ) {
      const css = relationCss(relationOf(perspective(), letter, scene));
      const color = parseInt(css.replace("#", ""), 16) || 0xFFFFFF;
      const g = new PIXI.Graphics();
      g.eventMode = "none";
      for ( const doc of tokensOf(scene, letter) ) {
        const obj = doc.object;
        if ( !obj || doc.hidden && !game.user.isGM ) continue;
        const c = obj.center;
        const r = Math.max(obj.w ?? 0, obj.h ?? 0) / 2 + 8;
        if ( typeof g.setStrokeStyle === "function" ) {
          g.circle(c.x, c.y, r).stroke({ width: 5, color, alpha: 0.9 });
        } else {
          g.lineStyle(5, color, 0.9);
          g.drawCircle(c.x, c.y, r);
        }
      }
      layer.addChild(g);
      graphics.set(letter, g);
    }
  } catch(err) { console.warn("alivas-engine-of-triggers | faction highlight failed", err); }
}

/* -------------------------------------------- */
/*  The window                                  */
/* -------------------------------------------- */

const windows = new Map();

class RelationsWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["aet-editor", "aet-factions-app"],
    window: { icon: "fa-solid fa-flag", resizable: true },
    position: { width: "auto", height: "auto" }
  };

  constructor(scene, options={}) {
    super({ ...options, id: `aet-factions-${scene.id}` });
    this.scene = scene;
    this._hooks = [];
    this._rerender = foundry.utils.debounce(() => { if ( this.rendered ) this.render(); }, 50);
  }

  get title() { return `Faction relations — ${this.scene.name}`; }

  async _onFirstRender(context, options) {
    await super._onFirstRender?.(context, options);
    const mine = scene => scene === this.scene;
    const on = (name, fn) => this._hooks.push([name, Hooks.on(name, fn)]);
    on("alivasTriggers.factionsChanged", ({ scene }={}) => { if ( mine(scene) ) { this._rerender(); redrawHighlights(this.scene); } });
    const tokenChanged = doc => { if ( mine(doc?.parent) ) { this._rerender(); redrawHighlights(this.scene); } };
    on("createToken", tokenChanged);
    on("deleteToken", tokenChanged);
    on("updateToken", tokenChanged);
    on("canvasReady", () => redrawHighlights(this.scene));
    on("controlToken", () => redrawHighlights(this.scene));
    if ( !teardownHook ) teardownHook = Hooks.on("canvasTearDown", () => clearGraphics());
  }

  async _onClose(options) {
    for ( const [name, id] of this._hooks ) Hooks.off(name, id);
    this._hooks = [];
    windows.delete(this.scene.id);
    marks.delete(this.scene.id);
    clearGraphics();
    return super._onClose?.(options);
  }

  async _renderHTML() {
    const scene = this.scene;
    const esc = foundry.utils.escapeHTML;
    const letters = lettersInUse(scene);
    const onScene = canvas?.scene === scene;
    const state = markState(scene);
    const root = document.createElement("div");
    root.className = "aet-root";
    Object.assign(root.style, { display: "flex", flexDirection: "column", gap: "8px", padding: "8px", minWidth: "320px" });

    // Hint
    const hint = document.createElement("div");
    hint.className = "aet-muted";
    hint.innerHTML = `<p style="margin:0">Click a cell to cycle: ally (green) → neutral (yellow) → hostile (red). Row = how that faction regards the column's faction.</p>
      <p style="margin:4px 0 0">Map colours are shown as seen by: <strong>${esc(perspective())}</strong></p>`;
    root.append(hint);

    // Grid
    const grid = document.createElement("div");
    Object.assign(grid.style, { display: "grid", gap: "3px", alignItems: "center", justifyItems: "center",
      gridTemplateColumns: `repeat(${letters.length + 1}, auto)`, overflow: "auto" });
    const header = letter => {
      const el = document.createElement("div");
      el.className = "aet-faction-head";
      el.dataset.letter = letter;
      const pinned = state.pinned.has(letter);
      Object.assign(el.style, { textAlign: "center", padding: "2px 6px", borderRadius: "4px", cursor: onScene ? "pointer" : "default",
        lineHeight: "1.1", border: pinned ? "2px solid var(--color-text-hyperlink, #ff6400)" : "2px solid transparent",
        background: pinned ? "rgba(255,100,0,0.18)" : "" });
      el.innerHTML = `<strong>${esc(letter)}</strong><br><small class="aet-muted">${tokensOf(scene, letter).length}</small>`;
      el.dataset.tooltip = onScene ? "Hover to highlight this faction's tokens; click to keep the highlight" : "Open this scene to highlight";
      if ( onScene ) {
        el.addEventListener("pointerenter", () => { state.hover = letter; redrawHighlights(scene); });
        el.addEventListener("pointerleave", () => { if ( state.hover === letter ) state.hover = null; redrawHighlights(scene); });
        el.addEventListener("click", () => {
          if ( state.pinned.has(letter) ) state.pinned.delete(letter); else state.pinned.add(letter);
          this.render();
          redrawHighlights(scene);
        });
      }
      return el;
    };
    if ( letters.length ) {
      grid.append(document.createElement("div"));
      for ( const col of letters ) grid.append(header(col));
      for ( const row of letters ) {
        grid.append(header(row));
        for ( const col of letters ) {
          const rel = relationOf(row, col, scene);
          const cell = document.createElement("button");
          cell.type = "button";
          const self = row === col;
          Object.assign(cell.style, { width: "2em", height: "2em", minWidth: "2em", padding: "0", margin: "0", lineHeight: "1",
            background: relationCss(rel), border: "1px solid rgba(0,0,0,0.6)", borderRadius: "4px",
            cursor: self ? "not-allowed" : "pointer", color: "#000", opacity: self ? "0.75" : "1" });
          if ( self ) {
            cell.disabled = true;
            cell.innerHTML = `<i class="fa-solid fa-lock"></i>`;
            cell.dataset.tooltip = "A faction is always allied with itself";
          } else {
            cell.dataset.tooltip = `${row} regards ${col}: ${rel}`;
            cell.setAttribute("aria-label", `${row} regards ${col}: ${rel}`);
            cell.addEventListener("click", async event => {
              event.preventDefault();
              const next = CYCLE[(CYCLE.indexOf(rel) + 1) % CYCLE.length];
              await setRelation(scene, row, col, next);
            });
          }
          grid.append(cell);
        }
      }
    }
    root.append(grid);

    // Controls row: add, linked
    const controls = document.createElement("div");
    Object.assign(controls.style, { display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "aet-btn";
    add.style.width = "auto";
    add.innerHTML = `<i class="fa-solid fa-plus"></i>`;
    add.dataset.tooltip = "Add a faction (the next free letter)";
    add.addEventListener("click", async () => { await addFaction(scene); });
    controls.append(add);
    const linkLabel = document.createElement("label");
    Object.assign(linkLabel.style, { display: "flex", gap: "4px", alignItems: "center", margin: "0" });
    const link = document.createElement("input");
    link.type = "checkbox";
    link.checked = isLinked(scene);
    link.addEventListener("change", async () => { await setLinked(scene, link.checked); this.render(); });
    linkLabel.append(link, document.createTextNode("Linked (edit both directions)"));
    controls.append(linkLabel);
    root.append(controls);

    // Copy from another scene
    const others = game.scenes.filter(s => s.id !== scene.id);
    if ( others.length ) {
      const copy = document.createElement("div");
      Object.assign(copy.style, { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" });
      const select = document.createElement("select");
      select.style.width = "auto";
      select.innerHTML = others.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "aet-btn";
      button.style.width = "auto";
      button.textContent = "Copy";
      button.addEventListener("click", async () => {
        const from = game.scenes.get(select.value);
        if ( !from ) return;
        const ok = await foundry.applications.api.DialogV2.confirm({
          window: { title: "Copy relations" }, rejectClose: false, modal: true,
          content: `<p>Replace the relations of <strong>${esc(scene.name)}</strong> with those of <strong>${esc(from.name)}</strong>?</p>`
        });
        if ( ok ) await copyTable(from, scene);
      });
      const label = document.createElement("span");
      label.textContent = "Copy relations from scene:";
      copy.append(label, select, button);
      root.append(copy);
    }
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }
}

/** Open (or bring to front) the relations window for a scene. */
export function openRelationsWindow(scene) {
  if ( !game.user.isGM ) return ui.notifications.warn("Only the GM can edit faction relations.");
  if ( !scene ) return ui.notifications.warn("No scene to show relations for.");
  let app = windows.get(scene.id);
  if ( !app ) {
    app = new RelationsWindow(scene);
    windows.set(scene.id, app);
  }
  app.render({ force: true });
  app.bringToFront?.();
  return app;
}
