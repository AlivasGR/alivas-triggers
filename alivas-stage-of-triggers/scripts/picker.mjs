/**
 * Alivas's Stage of Triggers — the animation / sound browser.
 *
 *   Picker.pick({ mode, cue, current, context }) → Sequencer database path | null
 *   registerPickerSettings()                     → call from the module's init hook
 *
 * The catalog (catalog.mjs) is built once per session from Sequencer's database. The window renders its shell once;
 * after that only the results, the pills and the facet counts are touched, in place.
 */

import { MODULE_ID } from "./cues.mjs";
import { buildCatalog, search, recommend } from "./catalog.mjs";

const { ApplicationV2 } = foundry.applications.api;
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

const PAGE = 60;
const RECENT_MAX = 24;
const MAX_PLAYING = 2;

/* -------------------------------------------- */
/*  Settings                                    */
/* -------------------------------------------- */

export function registerPickerSettings() {
  for ( const key of ["pickerFavorites", "pickerRecent"] ) {
    game.settings.register(MODULE_ID, key, { scope: "client", config: false, type: Array, default: [] });
  }
}

function readList(key) {
  try {
    const v = game.settings.get(MODULE_ID, key);
    return Array.isArray(v) ? v.filter(x => typeof x === "string") : [];
  } catch ( e ) { return []; }
}
function writeList(key, list) {
  try { return Promise.resolve(game.settings.set(MODULE_ID, key, list)).catch(() => {}); } catch ( e ) { return null; }
}

/* -------------------------------------------- */
/*  Sequencer access                            */
/* -------------------------------------------- */

const NAME_CACHE = new Map();   // prefix → name | null
const FILE_CACHE = new Map();   // path → url | null

function dbEntry(path) {
  try { return Sequencer?.Database?.getEntry?.(path, { softFail: true }) ?? null; } catch ( e ) { return null; }
}

function prefixName(prefix) {
  if ( NAME_CACHE.has(prefix) ) return NAME_CACHE.get(prefix);
  let name = null;
  try {
    let e = dbEntry(prefix);
    if ( Array.isArray(e) ) e = e.find(x => x?.metadata?.name) ?? e[0];
    const n = e?.metadata?.name;
    if ( typeof n === "string" && n.trim() ) name = n.trim();
  } catch ( e ) { /* ignore */ }
  NAME_CACHE.set(prefix, name);
  return name;
}

/** The JB2A metadata name of the nearest ancestor (or the path itself) that has one. */
function getName(path) {
  const segs = String(path).split(".");
  for ( let i = segs.length; i >= 1; i-- ) {
    const name = prefixName(segs.slice(0, i).join("."));
    if ( name ) return name;
  }
  return undefined;
}

/** Reduce whatever a database entry's `file` is to one URL string. */
function resolveFile(x, depth = 0) {
  if ( x == null || depth > 6 ) return null;
  if ( typeof x === "string" ) return x.includes("{{") ? null : x;
  if ( Array.isArray(x) ) {
    for ( const item of x ) { const r = resolveFile(item, depth + 1); if ( r ) return r; }
    return null;
  }
  if ( typeof x === "object" ) {
    if ( x.file !== undefined ) { const r = resolveFile(x.file, depth + 1); if ( r ) return r; }
    if ( x.rawData !== undefined ) { const r = resolveFile(x.rawData, depth + 1); if ( r ) return r; }
    const keys = Object.keys(x);
    const dist = keys.find(k => /^30ft$/i.test(k)) ?? keys.find(k => /^\d+ft$/i.test(k));
    if ( dist ) { const r = resolveFile(x[dist], depth + 1); if ( r ) return r; }
    for ( const k of keys ) { const r = resolveFile(x[k], depth + 1); if ( r ) return r; }
  }
  return null;
}

function getFile(path) {
  if ( !path ) return null;
  if ( FILE_CACHE.has(path) ) return FILE_CACHE.get(path);
  let url = null;
  try { url = resolveFile(dbEntry(path)); } catch ( e ) { url = null; }
  if ( !url && /\.(webm|mp4|ogg|mp3|wav|flac|webp|m4a)$/i.test(path) ) url = path;   // a pasted file
  FILE_CACHE.set(path, url);
  return url;
}

let CATALOG = null;   // Promise
const settle = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 20)));

/** Build the catalog once per session. */
export function loadCatalog() {
  CATALOG ??= (async () => {
    await settle();   // let the spinner paint before the synchronous build
    const db = globalThis.Sequencer?.Database;
    const raw = db?.flattenedEntries ?? db?.publicFlattenedEntries ?? [];
    const paths = [...raw].filter(p => typeof p === "string" && !p.startsWith("autoanimations."));
    if ( !paths.length ) throw new Error("Sequencer's database is empty (is Sequencer active, and JB2A / PSFX installed?)");
    const catalog = buildCatalog(paths, { getName, getFile });
    const byPath = new Map();
    for ( const f of catalog.families ) f.variants.forEach((v, i) => byPath.set(v.path, { family: f, index: i }));
    catalog.byPath = byPath;
    return catalog;
  })();
  CATALOG.catch(() => { CATALOG = null; });
  return CATALOG;
}

/* -------------------------------------------- */
/*  Colours                                     */
/* -------------------------------------------- */

const COLOR_CSS = {
  blue: "#3d7be0", lightblue: "#86c8f5", darkblue: "#1d3a8a", green: "#3fae4e", lightgreen: "#94de80", darkgreen: "#1f6b32",
  red: "#d63a3a", darkred: "#8a1f1f", lightred: "#f0807a", orange: "#f08a24", yellow: "#f2d338", purple: "#8a4fd1",
  darkpurple: "#4b2a7c", lightpurple: "#b99be8", pink: "#ee7fb6", white: "#f6f6f6", grey: "#8d8d8d", gray: "#8d8d8d",
  black: "#1b1b1b", teal: "#1fa598", cyan: "#34d0e0", turquoise: "#2fd1bd", brown: "#8a5a34", tan: "#c9a77a", gold: "#d4a82a",
  silver: "#bfc4cc", magenta: "#d1359f", violet: "#7c4bd8", indigo: "#4b3ec2", lime: "#a6e22e", amber: "#f2a516", bronze: "#a8743a",
  maroon: "#7a1f2f", navy: "#1a2a66", sky: "#6cb8ee", aqua: "#40d4c8", ice: "#bfe9f7", blood: "#8a1010", fire: "#f06a1e",
  rainbow: "conic-gradient(#e74c3c, #f1c40f, #2ecc71, #3498db, #9b59b6, #e74c3c)"
};
const COLOR_KEYS = Object.keys(COLOR_CSS).sort((a, b) => b.length - a.length);
const COLOR_MEMO = new Map();

function splitColor(s) {
  if ( !s ) return [];
  for ( const k of COLOR_KEYS ) {
    if ( s.startsWith(k) ) {
      const rest = splitColor(s.slice(k.length));
      if ( s.length === k.length || rest.length ) return [k, ...rest];
    }
  }
  return [];
}

/** CSS background for a JB2A colour word (two-tone for combined names). */
export function colorCss(name) {
  const key = String(name ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if ( COLOR_MEMO.has(key) ) return COLOR_MEMO.get(key);
  let css;
  const parts = COLOR_CSS[key] ? [key] : splitColor(key);
  if ( !parts.length ) css = "repeating-linear-gradient(45deg, #888 0 4px, #bbb 4px 8px)";
  else if ( parts.length === 1 ) css = COLOR_CSS[parts[0]];
  else {
    const n = parts.length;
    css = `linear-gradient(135deg, ${parts.map((p, i) => `${COLOR_CSS[p].startsWith("#") ? COLOR_CSS[p] : "#ccc"} ${(i / n * 100).toFixed(0)}% ${((i + 1) / n * 100).toFixed(0)}%`).join(", ")})`;
  }
  COLOR_MEMO.set(key, css);
  return css;
}

/* -------------------------------------------- */
/*  Static tables                               */
/* -------------------------------------------- */

const KINDS = [
  ["projectile", "fa-arrow-right-long", "Projectile"], ["melee", "fa-hand-fist", "Melee"], ["onToken", "fa-user", "On creature"],
  ["impact", "fa-burst", "Impact"], ["area", "fa-circle-dot", "Area"], ["aura", "fa-circle-radiation", "Aura"],
  ["marker", "fa-location-dot", "Marker"]
];
const KIND_META = Object.fromEntries([...KINDS, ["sound", "fa-volume-high", "Sound"]].map(([id, icon, label]) => [id, { icon, label }]));
const SHAPES = [["circle", "fa-circle", "Circle"], ["cone", "fa-angle-up", "Cone"], ["line", "fa-grip-lines", "Line"], ["square", "fa-square", "Square"]];
const SHAPE_META = Object.fromEntries(SHAPES.map(([id, icon, label]) => [id, { icon, label }]));

/** Soft default Kind filter for a step kind. */
function softKinds(cue) {
  if ( cue === "aura" ) return ["aura", "area"];
  if ( cue === "teleport" ) return ["onToken", "impact"];
  if ( KINDS.some(([k]) => k === cue) ) return [cue];
  return [];
}

const cap = s => String(s ?? "").replace(/(^|[\s_-])(\w)/g, (m, a, b) => a.replace(/[_-]/, " ") + b.toUpperCase()).trim();

/* -------------------------------------------- */
/*  Picker                                      */
/* -------------------------------------------- */

export class Picker extends ApplicationV2 {
  /**
   * @param {{mode?: "animation"|"sound", cue?: string, current?: string, context?: object}} opts
   * @returns {Promise<string|null>}
   */
  static pick(opts = {}) {
    return new Promise(resolve => new Picker({ ...opts, resolve }).render({ force: true }));
  }

  static DEFAULT_OPTIONS = {
    classes: ["ast-app", "ast-picker"],
    window: { icon: "fa-solid fa-magnifying-glass", resizable: true },
    actions: {
      setLibrary: Picker.#onSetLibrary, toggleFilter: Picker.#onToggleFilter, removePill: Picker.#onRemovePill,
      clearAll: Picker.#onClearAll, clearSearch: Picker.#onClearSearch, toggleSection: Picker.#onToggleSection,
      toggleFav: Picker.#onToggleFav, setVariant: Picker.#onSetVariant, playSound: Picker.#onPlaySound,
      showMore: Picker.#onShowMore, previewOnToken: Picker.#onPreviewOnToken, use: Picker.#onUse, cancel: Picker.#onCancel
    }
  };

  constructor({ mode = "animation", cue, current, context = {}, resolve } = {}) {
    super({
      window: { title: mode === "sound" ? "Choose a sound" : "Choose an animation" },
      position: { width: 1000, height: 720 }
    });
    this.mode = mode === "sound" ? "sound" : "animation";
    this.cueKind = cue ?? (this.mode === "sound" ? "sound" : "onToken");
    this.current = current || "";
    this.ctx = context ?? {};
    this._resolve = resolve;
    this._result = null;
    this._closed = false;

    this.lib = this.mode === "sound" ? "psfx" : (String(this.current).startsWith("psfx.") ? "psfx" : "jb2a");
    this.query = "";
    this.f = { kind: new Set(), shape: new Set(), colors: new Set(), persistent: false, category: "" };
    if ( this.mode === "animation" && !this.current ) for ( const k of softKinds(this.cueKind) ) this.f.kind.add(k);

    this.catalog = null;
    this._sel = null;               // { family, custom }
    this._variant = new Map();      // family id → variant index
    this._favs = readList("pickerFavorites");
    this._recent = readList("pickerRecent");
    this._recCache = new Map();     // lib → [{family, why, variant}]
    this._hits = null; this._hitsKey = null;
    this._filtered = [];
    this._sections = [];
    this._paged = null;
    this._counts = null;
    this._playing = [];
    this._hover = null;
    this._sound = null; this._soundBtn = null;
    this._io = null; this._more = null;
    this._debounce = null;
    this._wired = false;
  }

  /* ---- rendering shell ---- */

  async _renderHTML() {
    const libs = this.mode === "sound" ? [["psfx", "PSFX"]] : [["jb2a", "JB2A"], ["psfx", "PSFX"]];
    return `<div class="ast-picker-root">
      <header class="ast-picker-top">
        <div class="ast-picker-search">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input type="text" class="ast-picker-q" placeholder="${this.mode === "sound" ? "Search sounds — try “fire whoosh”" : "Search animations — try “green bolt”, “cone”, “loop”"}" autocomplete="off" spellcheck="false">
          <button type="button" class="ast-picker-clear" data-action="clearSearch" data-tooltip="Clear" hidden><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="ast-picker-libs">${libs.map(([id, label]) => `<button type="button" class="ast-picker-lib${id === this.lib ? " active" : ""}" data-action="setLibrary" data-lib="${id}"${libs.length === 1 ? " disabled" : ""}>${label}</button>`).join("")}</div>
        <input type="text" class="ast-picker-custom" placeholder="…or paste a database path / file" autocomplete="off" spellcheck="false">
      </header>
      <div class="ast-picker-body">
        <aside class="ast-picker-side"></aside>
        <main class="ast-picker-main">
          <div class="ast-picker-bar"><div class="ast-picker-pills"></div><div class="ast-picker-count"></div></div>
          <div class="ast-picker-results"><div class="ast-picker-loading"><i class="fa-solid fa-spinner fa-spin-pulse"></i><span>Building the catalog…</span></div></div>
        </main>
      </div>
      <footer class="ast-picker-foot">
        <code class="ast-picker-path">Nothing selected</code>
        <button type="button" data-action="previewOnToken" class="ast-picker-btn"><i class="fa-solid fa-play"></i> Preview on token</button>
        <button type="button" data-action="cancel" class="ast-picker-btn">Cancel</button>
        <button type="button" data-action="use" class="ast-picker-btn ast-picker-primary" disabled><i class="fa-solid fa-check"></i> Use</button>
      </footer></div>`;
  }

  _replaceHTML(result, content) { content.innerHTML = result; }

  _onRender(context, options) {
    if ( this._wired ) return;
    this._wired = true;
    this.#wire();
    this.#init();
  }

  async close(options = {}) {
    this._closed = true;
    return super.close(options);
  }

  _onClose(options) {
    this.#teardown();
    const r = this._resolve; this._resolve = null;
    r?.(this._result);
    return super._onClose?.(options);
  }

  #teardown() {
    clearTimeout(this._debounce);
    this._io?.disconnect(); this._more?.disconnect();
    for ( const v of this._playing ) try { v.pause(); } catch ( e ) { /* ignore */ }
    this._playing = [];
    this.#stopSound();
  }

  $(sel) { return this.element?.querySelector(sel) ?? null; }

  /* ---- init ---- */

  async #init() {
    try {
      this.catalog = await loadCatalog();
    } catch ( err ) {
      console.error(`${MODULE_ID} | picker catalog`, err);
      if ( !this._closed ) this.$(".ast-picker-results").innerHTML = `<div class="ast-picker-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>Couldn't read Sequencer's database.</p><small>${esc(err?.message)}</small></div>`;
      return;
    }
    if ( this._closed || !this.element ) return;

    // Opening on a current path: show it, select it, filter nothing.
    if ( this.current ) {
      const hit = this.catalog.byPath.get(this.current) ?? this.#familyOfPath(this.current);
      if ( hit ) {
        this._variant.set(hit.family.id, hit.index);
        this._sel = { family: hit.family };
        this.lib = hit.family.library;
      } else {
        this._sel = { custom: this.current };
        this.$(".ast-picker-custom").value = this.current;
      }
    }
    this.#syncLibButtons();
    this.#buildSide();
    this.#refresh({ scrollToSelected: true });
    this.#syncFooter();
    this.$(".ast-picker-q")?.focus();
  }

  /** A pasted path that is a leaf or child of a family variant (e.g. "jb2a.x.orange.30ft"). */
  #familyOfPath(path) {
    let best = null;
    for ( const [p, hit] of this.catalog.byPath ) if ( path.startsWith(`${p}.`) && (!best || p.length > best.p.length) ) best = { p, ...hit };
    return best;
  }

  /* ---- listeners ---- */

  #wire() {
    const root = this.element;
    const q = this.$(".ast-picker-q");
    q.addEventListener("input", () => {
      clearTimeout(this._debounce);
      this.$(".ast-picker-clear").hidden = !q.value;
      this._debounce = setTimeout(() => { this.query = q.value; this.#refresh(); }, 80);
    });
    this.$(".ast-picker-custom").addEventListener("input", ev => {
      const v = ev.target.value.trim();
      if ( v ) this._sel = { custom: v };
      else if ( this._sel?.custom ) this._sel = null;
      this.#syncSelection(); this.#syncFooter();
    });

    const results = this.$(".ast-picker-results");
    results.addEventListener("click", ev => {
      if ( ev.target.closest("[data-action]") ) return;
      const card = ev.target.closest(".ast-picker-card");
      if ( card ) this.#select(card.dataset.fam);
    });
    results.addEventListener("dblclick", ev => {
      if ( ev.target.closest("[data-action]") ) return;
      const card = ev.target.closest(".ast-picker-card");
      if ( card ) { this.#select(card.dataset.fam); this.#use(); }
    });
    results.addEventListener("mouseover", ev => {
      const card = ev.target.closest(".ast-picker-card");
      if ( card === this._hover ) return;
      this.#stopHover();
      this._hover = card;
      if ( card ) this.#playCard(card);
    });
    results.addEventListener("mouseleave", () => this.#stopHover());
    results.addEventListener("error", ev => {
      if ( ev.target?.tagName === "VIDEO" ) ev.target.closest(".ast-picker-card")?.classList.add("nopreview");
    }, true);

    this._io = new IntersectionObserver(entries => {
      for ( const e of entries ) {
        if ( !e.isIntersecting ) continue;
        this._io.unobserve(e.target);
        this.#loadVideo(e.target);
      }
    }, { root: results, rootMargin: "240px" });
    this._more = new IntersectionObserver(entries => {
      if ( entries.some(e => e.isIntersecting) ) this.#showMore();
    }, { root: results, rootMargin: "400px" });

    root.addEventListener("keydown", ev => this.#onKey(ev));
  }

  #onKey(ev) {
    const t = ev.target;
    const inText = t?.matches?.("input[type=text], input:not([type]), textarea");
    if ( ev.key === "Escape" ) { ev.preventDefault(); ev.stopPropagation(); this.close(); return; }
    if ( ev.key === "/" && !inText ) { ev.preventDefault(); const q = this.$(".ast-picker-q"); q.focus(); q.select(); return; }
    if ( ev.key === "Enter" ) {
      if ( t?.closest?.("button") && !t.closest(".ast-picker-card") ) return;
      ev.preventDefault();
      if ( !this._sel ) { const first = this.$(".ast-picker-card"); if ( first ) this.#select(first.dataset.fam); }
      this.#use();
      return;
    }
    if ( ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key) ) {
      if ( inText && (ev.key === "ArrowLeft" || ev.key === "ArrowRight" || ev.key === "ArrowUp") ) return;
      ev.preventDefault();
      this.#move(ev.key.replace("Arrow", "").toLowerCase());
    }
  }

  /* ---- facets, filtering ---- */

  #hits() {
    const key = `${this.lib}|${this.query.trim()}`;
    if ( this._hitsKey === key ) return this._hits;
    const q = this.query.trim();
    let hits;
    try { hits = search(this.catalog, q, { library: this.lib }); } catch ( e ) {
      console.warn(`${MODULE_ID} | search failed, falling back`, e);
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      hits = this.catalog.families.filter(f => f.library === this.lib && words.every(w => f.text.includes(w)));
    }
    this._hits = hits; this._hitsKey = key;
    return hits;
  }

  /** Which facets does a family fail? */
  #fails(fam) {
    const f = this.f, out = [];
    if ( f.kind.size && !f.kind.has(fam.kind) ) out.push("kind");
    if ( f.shape.size && !f.shape.has(fam.shape) ) out.push("shape");
    if ( f.colors.size && !fam.colors.some(c => f.colors.has(c)) ) out.push("colors");
    if ( f.persistent && !fam.persistent ) out.push("persistent");
    if ( f.category && fam.category !== f.category ) out.push("category");
    return out;
  }

  #passes(fam) { return fam.library === this.lib && this.#fails(fam).length === 0; }

  /** Filter the hits and count each facet over what the *other* filters allow. */
  #compute() {
    const counts = { kind: {}, shape: {}, colors: {}, persistent: 0, category: {} };
    const bump = (facet, fam) => {
      if ( facet === "kind" ) counts.kind[fam.kind] = (counts.kind[fam.kind] ?? 0) + 1;
      else if ( facet === "shape" ) { if ( fam.shape ) counts.shape[fam.shape] = (counts.shape[fam.shape] ?? 0) + 1; }
      else if ( facet === "colors" ) for ( const c of new Set(fam.colors) ) counts.colors[c] = (counts.colors[c] ?? 0) + 1;
      else if ( facet === "persistent" ) { if ( fam.persistent ) counts.persistent++; }
      else if ( facet === "category" ) counts.category[fam.category] = (counts.category[fam.category] ?? 0) + 1;
    };
    const FACETS = ["kind", "shape", "colors", "persistent", "category"];
    const out = [];
    for ( const fam of this.#hits() ) {
      const fails = this.#fails(fam);
      if ( !fails.length ) { out.push(fam); for ( const k of FACETS ) bump(k, fam); }
      else if ( fails.length === 1 ) bump(fails[0], fam);
    }
    this._counts = counts;
    this._filtered = out;
  }

  #anyFilter() {
    const f = this.f;
    return !!(f.kind.size || f.shape.size || f.colors.size || f.persistent || f.category);
  }

  #recommended() {
    if ( !this._recCache.has(this.lib) ) {
      let recs = [];
      try {
        recs = recommend(this.catalog, { ...this.ctx, cue: this.cueKind, library: this.lib }, { limit: 36 }) ?? [];
      } catch ( e ) { console.warn(`${MODULE_ID} | recommend failed`, e); }
      this._recCache.set(this.lib, recs);
    }
    return this._recCache.get(this.lib);
  }

  #resolveIds(list) {
    const out = [];
    for ( const id of list ) {
      let fam = this.catalog.byId.get(id);
      if ( !fam ) { const hit = this.catalog.byPath.get(id); fam = hit?.family; }
      if ( fam && fam.library === this.lib && !out.includes(fam) ) out.push(fam);
    }
    return out;
  }

  /* ---- results ---- */

  #refresh({ scrollToSelected = false } = {}) {
    if ( !this.catalog || this._closed ) return;
    this.#compute();
    this.#updateCounts();
    this.#renderPills();
    this.#renderResults(scrollToSelected);
  }

  #buildSections() {
    const q = this.query.trim();
    const sections = [];
    if ( q ) {
      sections.push({ key: "results", title: "", list: this._filtered, paged: true });
      return sections;
    }
    const cur = this._sel?.family && this.current ? this._sel.family : null;
    if ( cur && cur.library === this.lib ) sections.push({ key: "current", title: "Current", list: [cur] });
    const rec = this.#recommended().filter(r => this.#passes(r.family)).slice(0, 12);
    if ( rec.length ) {
      const why = new Map(rec.map(r => [r.family.id, r.why]));
      for ( const r of rec ) if ( r.variant && !this._variant.has(r.family.id) ) {
        const i = r.family.variants.findIndex(v => v.path === r.variant.path);
        if ( i >= 0 ) this._variant.set(r.family.id, i);
      }
      sections.push({ key: "rec", title: "Recommended", icon: "fa-wand-magic-sparkles", list: rec.map(r => r.family), why });
    }
    const favs = this.#resolveIds(this._favs);
    if ( favs.length ) sections.push({ key: "fav", title: "Favorites", icon: "fa-star", list: favs });
    const recent = this.#resolveIds(this._recent).slice(0, RECENT_MAX);
    if ( recent.length ) sections.push({ key: "recent", title: "Recent", icon: "fa-clock-rotate-left", list: recent });
    sections.push({ key: "all", title: "All", list: this._filtered, paged: true });
    return sections;
  }

  #renderResults(scrollToSelected = false) {
    const el = this.$(".ast-picker-results");
    this._more?.disconnect();
    this._io?.disconnect();
    this.#stopHover();
    const sections = this._sections = this.#buildSections();
    const total = this._filtered.length;
    this.$(".ast-picker-count").textContent = `${total.toLocaleString()} ${total === 1 ? "result" : "results"}`;

    if ( !total && this.query.trim() ) {
      this._paged = null;
      el.innerHTML = this.#emptyHtml();
      el.scrollTop = 0;
      return;
    }
    const parts = [];
    for ( const s of sections ) {
      const list = s.paged ? s.list.slice(0, PAGE) : s.list;
      if ( s.paged && !s.list.length ) { parts.push(this.#emptyHtml()); continue; }
      const head = s.title ? `<h4 class="ast-picker-h">${s.icon ? `<i class="fa-solid ${s.icon}"></i>` : ""}${esc(s.title)}${s.paged ? `<small>${s.list.length.toLocaleString()}</small>` : ""}</h4>` : "";
      parts.push(`<section class="ast-picker-sec" data-key="${s.key}">${head}<div class="ast-picker-grid">${list.map(f => this.#cardHtml(f, s.why?.get(f.id))).join("")}</div>${
        s.paged ? '<div class="ast-picker-more"><button type="button" class="ast-picker-btn" data-action="showMore"></button></div>' : ""}</section>`);
    }
    el.innerHTML = parts.join("");
    const pagedSec = sections.find(s => s.paged);
    this._paged = pagedSec ? { list: pagedSec.list, shown: Math.min(PAGE, pagedSec.list.length), grid: el.querySelector(`[data-key="${pagedSec.key}"] .ast-picker-grid`) } : null;
    this.#afterAppend(el);
    this.#updateMore();
    el.scrollTop = 0;
    if ( scrollToSelected ) this.#scrollToSelected();
  }

  #emptyHtml() {
    return `<div class="ast-picker-empty"><i class="fa-regular fa-face-frown-open"></i><p>Nothing matches${this.query.trim() ? ` “${esc(this.query.trim())}”` : ""}${this.#anyFilter() ? " with these filters" : ""}.</p>${
      this.#anyFilter() ? '<button type="button" class="ast-picker-btn" data-action="clearAll"><i class="fa-solid fa-filter-circle-xmark"></i> Clear filters</button>' : ""}</div>`;
  }

  #showMore() {
    const p = this._paged;
    if ( !p || p.shown >= p.list.length ) return;
    const next = p.list.slice(p.shown, p.shown + PAGE);
    p.shown += next.length;
    p.grid.insertAdjacentHTML("beforeend", next.map(f => this.#cardHtml(f)).join(""));
    this.#afterAppend(p.grid);
    this.#updateMore();
  }

  #updateMore() {
    const wrap = this.$(".ast-picker-more");
    const p = this._paged;
    if ( !wrap || !p ) return;
    const left = p.list.length - p.shown;
    wrap.hidden = left <= 0;
    const btn = wrap.querySelector("button");
    if ( btn ) btn.textContent = `Show more (${left.toLocaleString()})`;
    this._more.disconnect();
    if ( left > 0 ) this._more.observe(wrap);
  }

  #afterAppend(root) {
    for ( const v of root.querySelectorAll("video[data-lazy]") ) this._io.observe(v);
  }

  /* ---- cards ---- */

  #variantIndex(fam) {
    const i = this._variant.get(fam.id) ?? 0;
    return Math.min(Math.max(i, 0), fam.variants.length - 1);
  }
  #variantOf(fam) { return fam.variants[this.#variantIndex(fam)]; }

  #varsHtml(fam) {
    const n = fam.variants.length;
    if ( n < 2 ) return fam.library === "psfx" ? '<span class="ast-picker-nvar">1 variant</span>' : "";
    const idx = this.#variantIndex(fam);
    const swatches = fam.library !== "psfx" && fam.variants.every(v => v.color);
    if ( swatches ) {
      return fam.variants.map((v, i) => `<button type="button" class="ast-picker-swatch${i === idx ? " on" : ""}" data-action="setVariant" data-index="${i}" data-fam="${esc(fam.id)}" style="background:${colorCss(v.color)}" data-tooltip="${esc(v.label)}"></button>`).join("");
    }
    return `<button type="button" class="ast-picker-step" data-action="setVariant" data-step="-1" data-fam="${esc(fam.id)}"><i class="fa-solid fa-chevron-left"></i></button>
      <span class="ast-picker-nvar" data-tooltip="${esc(fam.variants[idx].label)}">${idx + 1} / ${n}${fam.library === "psfx" ? " variants" : ""}</span>
      <button type="button" class="ast-picker-step" data-action="setVariant" data-step="1" data-fam="${esc(fam.id)}"><i class="fa-solid fa-chevron-right"></i></button>`;
  }

  #cardHtml(fam, why) {
    const v = this.#variantOf(fam);
    const sound = fam.library === "psfx" || fam.kind === "sound";
    const sel = this._sel?.family === fam && !this._sel.custom;
    const km = KIND_META[fam.kind] ?? { icon: "fa-film", label: cap(fam.kind) };
    const sm = fam.shape ? SHAPE_META[fam.shape] : null;
    const fav = this._favs.includes(fam.id);
    const tile = sound
      ? `<div class="ast-picker-tile ast-picker-soundtile"><i class="ast-picker-wave fa-solid fa-wave-square"></i>
          <button type="button" class="ast-picker-play" data-action="playSound" data-tooltip="Play / stop"><i class="fa-solid fa-play"></i></button></div>`
      : `<div class="ast-picker-tile"><video muted loop playsinline preload="none" data-lazy="1"></video><i class="ast-picker-fallback fa-solid fa-film"></i>
          ${fam.persistent ? '<span class="ast-picker-loop" data-tooltip="Loops / persistent"><i class="fa-solid fa-repeat"></i></span>' : ""}</div>`;
    return `<div class="ast-picker-card${sel ? " selected" : ""}${sound ? " sound" : ""}" data-fam="${esc(fam.id)}" data-path="${esc(v.path)}" title="${esc(fam.id)}">
      ${tile}
      <button type="button" class="ast-picker-star${fav ? " on" : ""}" data-action="toggleFav" data-tooltip="Favorite"><i class="fa-${fav ? "solid" : "regular"} fa-star"></i></button>
      <div class="ast-picker-info">
        <div class="ast-picker-name">${esc(fam.name)}</div>
        <div class="ast-picker-badges">${sound ? "" : `<span class="ast-picker-badge"><i class="fa-solid ${km.icon}"></i>${esc(km.label)}</span>`}${sm ? `<span class="ast-picker-badge"><i class="fa-solid ${sm.icon}"></i>${esc(sm.label)}</span>` : ""}${fam.persistent && sound ? '<span class="ast-picker-badge"><i class="fa-solid fa-repeat"></i>Loop</span>' : ""}${sound ? `<span class="ast-picker-badge muted">${esc(fam.category)}</span>` : ""}</div>
        <div class="ast-picker-vars">${this.#varsHtml(fam)}</div>
        ${why?.length ? `<div class="ast-picker-why">${esc(why.join(" · "))}</div>` : ""}
      </div></div>`;
  }

  #cards(famId) {
    const sel = `.ast-picker-card[data-fam="${CSS.escape(famId)}"]`;
    return [...(this.element?.querySelectorAll(sel) ?? [])];
  }

  #refreshCard(fam) {
    const v = this.#variantOf(fam);
    for ( const card of this.#cards(fam.id) ) {
      card.dataset.path = v.path;
      const vars = card.querySelector(".ast-picker-vars");
      if ( vars ) vars.innerHTML = this.#varsHtml(fam);
      const video = card.querySelector("video");
      if ( video?.dataset.loaded ) {
        this.#loadVideo(video, true);
        if ( this._playing.includes(video) || card === this._hover ) this.#playCard(card);
      }
    }
  }

  /* ---- video & sound ---- */

  #loadVideo(video, force = false) {
    if ( !force && video.dataset.loaded ) return;
    const card = video.closest(".ast-picker-card");
    const path = card?.dataset.path;
    const fam = card && this.catalog.byId.get(card.dataset.fam);
    const url = getFile(path) ?? (fam ? getFile(fam.sample) : null);
    video.dataset.loaded = "1";
    if ( !url ) { card?.classList.add("nopreview"); return; }
    card.classList.remove("nopreview");
    video.preload = "metadata";
    // Show a frame from the middle as the still (first frames are often empty: projectiles, intros).
    video.addEventListener("loadedmetadata", () => {
      if ( Number.isFinite(video.duration) && (video.duration > 0) ) video.currentTime = video.duration * 0.45;
    }, { once: true });
    video.src = url;
  }

  #playCard(card) {
    const video = card.querySelector("video");
    if ( !video ) return;
    if ( !video.dataset.loaded ) this.#loadVideo(video);
    if ( !video.src ) return;
    this._playing = this._playing.filter(v => v !== video);
    while ( this._playing.length >= MAX_PLAYING ) { const old = this._playing.shift(); try { old.pause(); } catch ( e ) { /* ignore */ } }
    this._playing.push(video);
    const p = video.play();
    if ( p?.catch ) p.catch(() => {});
  }

  #stopHover() {
    const card = this._hover;
    this._hover = null;
    const video = card?.querySelector?.("video");
    if ( video ) {
      try { video.pause(); if ( Number.isFinite(video.duration) ) video.currentTime = video.duration * 0.45; } catch ( e ) { /* ignore */ }
      this._playing = this._playing.filter(v => v !== video);
    }
  }

  #stopSound() {
    try { this._sound?.stop?.(); } catch ( e ) { /* ignore */ }
    this._sound = null;
    if ( this._soundBtn ) this._soundBtn.classList.remove("playing");
    const i = this._soundBtn?.querySelector("i");
    if ( i ) i.className = "fa-solid fa-play";
    this._soundBtn = null;
  }

  async #playSoundFor(card, btn) {
    const wasThis = this._soundBtn === btn;
    this.#stopSound();
    if ( wasThis ) return;
    const url = getFile(card.dataset.path);
    if ( !url ) return ui.notifications?.warn("No playable file found for that sound.");
    this._soundBtn = btn;
    btn.classList.add("playing");
    btn.querySelector("i").className = "fa-solid fa-stop";
    try {
      const sound = await foundry.audio.AudioHelper.play({ src: url, volume: 0.6, loop: false }, false);
      if ( this._soundBtn !== btn ) { sound?.stop?.(); return; }
      this._sound = sound;
      const done = () => { if ( this._soundBtn === btn ) this.#stopSound(); };
      sound?.addEventListener?.("end", done);
      sound?.addEventListener?.("stop", done);
    } catch ( e ) {
      console.warn(`${MODULE_ID} | sound preview failed`, e);
      if ( this._soundBtn === btn ) this.#stopSound();
    }
  }

  /* ---- selection ---- */

  #select(famId, { scroll = false, play = false } = {}) {
    const fam = this.catalog.byId.get(famId);
    if ( !fam ) return;
    this._sel = { family: fam };
    const custom = this.$(".ast-picker-custom");
    if ( custom.value ) custom.value = "";
    this.#syncSelection();
    this.#syncFooter();
    if ( scroll || play ) {
      const card = this.#cards(famId)[0];
      card?.scrollIntoView({ block: "nearest" });
      if ( play && card && !card.classList.contains("sound") ) { this.#stopHover(); this._hover = card; this.#playCard(card); }
    }
  }

  #syncSelection() {
    const id = this._sel?.family && !this._sel.custom ? this._sel.family.id : null;
    for ( const c of this.element.querySelectorAll(".ast-picker-card") ) c.classList.toggle("selected", c.dataset.fam === id);
  }

  #selectedPath() {
    if ( this._sel?.custom ) return this._sel.custom;
    if ( this._sel?.family ) return this.#variantOf(this._sel.family)?.path ?? null;
    return null;
  }

  #syncFooter() {
    const path = this.#selectedPath();
    const el = this.$(".ast-picker-path");
    el.textContent = path ?? "Nothing selected";
    el.classList.toggle("empty", !path);
    el.title = path ?? "";
    this.$('[data-action="use"]').disabled = !path;
  }

  #scrollToSelected() {
    const id = this._sel?.family?.id;
    if ( !id ) return;
    const card = this.#cards(id)[0];
    if ( card ) requestAnimationFrame(() => card.scrollIntoView({ block: "center" }));
  }

  #move(dir) {
    const cards = [...this.element.querySelectorAll(".ast-picker-results .ast-picker-card")];
    if ( !cards.length ) return;
    const selId = this._sel?.family?.id;
    let cur = cards.find(c => c.dataset.fam === selId && c.matches(".selected"));
    if ( !cur ) { this.#select(cards[0].dataset.fam, { scroll: true, play: true }); return; }
    const i = cards.indexOf(cur);
    let target = null;
    if ( dir === "left" ) target = cards[i - 1];
    else if ( dir === "right" ) target = cards[i + 1];
    else {
      const r = cur.getBoundingClientRect(), cx = r.left + r.width / 2;
      const down = dir === "down";
      let bestRow = null, best = null;
      for ( const c of cards ) {
        const b = c.getBoundingClientRect();
        if ( down ? b.top <= r.top + 4 : b.top >= r.top - 4 ) continue;
        const rowDist = Math.abs(b.top - r.top);
        if ( bestRow === null || rowDist < bestRow - 4 ) { bestRow = rowDist; best = c; }
        else if ( Math.abs(rowDist - bestRow) <= 4 ) {
          if ( Math.abs(b.left + b.width / 2 - cx) < Math.abs(best.getBoundingClientRect().left + best.getBoundingClientRect().width / 2 - cx) ) best = c;
        }
      }
      target = best;
    }
    if ( !target && (dir === "right" || dir === "down") && this._paged && this._paged.shown < this._paged.list.length ) {
      this.#showMore();
      const more = [...this.element.querySelectorAll(".ast-picker-results .ast-picker-card")];
      target = dir === "right" ? more[i + 1] : more[Math.min(i + 1, more.length - 1)];
    }
    if ( target ) { (document.activeElement)?.blur?.(); this.#select(target.dataset.fam, { scroll: true, play: true }); }
  }

  /* ---- sidebar ---- */

  #syncLibButtons() {
    for ( const b of this.element.querySelectorAll(".ast-picker-lib") ) b.classList.toggle("active", b.dataset.lib === this.lib);
  }

  #buildSide() {
    const side = this.$(".ast-picker-side");
    const isSound = this.lib === "psfx";
    const fams = this.catalog.families.filter(f => f.library === this.lib);

    const colorTotals = {}, catTotals = {};
    for ( const f of fams ) {
      catTotals[f.category] = (catTotals[f.category] ?? 0) + 1;
      for ( const c of new Set(f.colors) ) colorTotals[c] = (colorTotals[c] ?? 0) + 1;
    }
    const colors = Object.keys(colorTotals).sort((a, b) => colorTotals[b] - colorTotals[a] || a.localeCompare(b));
    const cats = Object.keys(catTotals).sort((a, b) => a.localeCompare(b));
    const section = (key, title, body, open = true) => `<div class="ast-picker-sbox${open ? "" : " collapsed"}" data-box="${key}">
      <button type="button" class="ast-picker-shead" data-action="toggleSection" data-box="${key}"><i class="fa-solid fa-chevron-down"></i><span>${title}</span><em class="ast-picker-active" data-active="${key}"></em></button>
      <div class="ast-picker-sbody">${body}</div></div>`;

    let html = "";
    if ( !isSound ) {
      html += section("kind", "Kind", `<div class="ast-picker-chips">${KINDS.map(([id, icon, label]) =>
        `<button type="button" class="ast-picker-chip" data-action="toggleFilter" data-facet="kind" data-value="${id}"><i class="fa-solid ${icon}"></i><span>${label}</span><em data-count="kind:${id}"></em></button>`).join("")}</div>`);
      html += section("shape", "Shape", `<div class="ast-picker-chips">${SHAPES.map(([id, icon, label]) =>
        `<button type="button" class="ast-picker-chip" data-action="toggleFilter" data-facet="shape" data-value="${id}"><i class="fa-solid ${icon}"></i><span>${label}</span><em data-count="shape:${id}"></em></button>`).join("")}</div>`);
      html += section("persistent", "Loops / persistent", `<div class="ast-picker-chips"><button type="button" class="ast-picker-chip" data-action="toggleFilter" data-facet="persistent" data-value="1"><i class="fa-solid fa-repeat"></i><span>Only looping</span><em data-count="persistent"></em></button></div>`);
      if ( colors.length ) html += section("colors", "Colour", `<div class="ast-picker-swatches">${colors.map(c =>
        `<button type="button" class="ast-picker-cs" data-action="toggleFilter" data-facet="colors" data-value="${esc(c)}" data-tooltip="${esc(cap(c))}"><span class="ast-picker-dot" style="background:${colorCss(c)}"></span><em data-count="colors:${esc(c)}"></em></button>`).join("")}</div>`);
    }
    html += section("category", "Category", `<input type="text" class="ast-picker-catq" placeholder="Filter categories…" autocomplete="off" spellcheck="false">
      <div class="ast-picker-cats">${cats.map(c =>
        `<button type="button" class="ast-picker-cat" data-action="toggleFilter" data-facet="category" data-value="${esc(c)}" data-name="${esc(c.toLowerCase())}"><span>${esc(c)}</span><em data-count="category:${esc(c)}"></em></button>`).join("")}</div>`);
    side.innerHTML = html;
    side.querySelector(".ast-picker-catq")?.addEventListener("input", ev => {
      const q = ev.target.value.trim().toLowerCase();
      for ( const b of side.querySelectorAll(".ast-picker-cat") ) b.classList.toggle("nomatch", !!q && !b.dataset.name.includes(q));
    });
  }

  #updateCounts() {
    const side = this.$(".ast-picker-side");
    const c = this._counts;
    if ( !side || !c ) return;
    for ( const el of side.querySelectorAll("[data-count]") ) {
      const [facet, value] = el.dataset.count.split(/:(.*)/s);
      const n = facet === "persistent" ? c.persistent : (c[facet]?.[value] ?? 0);
      el.textContent = n ? n.toLocaleString() : "0";
      el.parentElement.classList.toggle("zero", !n);
    }
    for ( const b of side.querySelectorAll("[data-facet]") ) {
      const { facet, value } = b.dataset;
      const on = facet === "persistent" ? this.f.persistent : facet === "category" ? this.f.category === value
        : facet === "colors" ? this.f.colors.has(value) : this.f[facet].has(value);
      b.classList.toggle("active", on);
    }
    const act = { kind: this.f.kind.size, shape: this.f.shape.size, colors: this.f.colors.size, persistent: this.f.persistent ? 1 : 0, category: this.f.category ? 1 : 0 };
    for ( const el of side.querySelectorAll("[data-active]") ) { const n = act[el.dataset.active]; el.textContent = n || ""; }
  }

  #renderPills() {
    const pills = [];
    const pill = (facet, value, icon, label, swatch) => pills.push(`<span class="ast-picker-pill">${swatch ? `<span class="ast-picker-dot" style="background:${swatch}"></span>` : (icon ? `<i class="fa-solid ${icon}"></i>` : "")}${esc(label)}<button type="button" data-action="removePill" data-facet="${facet}" data-value="${esc(value)}" data-tooltip="Remove"><i class="fa-solid fa-xmark"></i></button></span>`);
    for ( const k of this.f.kind ) pill("kind", k, KIND_META[k]?.icon, KIND_META[k]?.label ?? cap(k));
    for ( const s of this.f.shape ) pill("shape", s, SHAPE_META[s]?.icon, SHAPE_META[s]?.label ?? cap(s));
    if ( this.f.persistent ) pill("persistent", "1", "fa-repeat", "Looping");
    for ( const c of this.f.colors ) pill("colors", c, null, cap(c), colorCss(c));
    if ( this.f.category ) pill("category", this.f.category, "fa-folder", this.f.category);
    const el = this.$(".ast-picker-pills");
    el.innerHTML = pills.join("") + (pills.length ? '<button type="button" class="ast-picker-clearall" data-action="clearAll">Clear all</button>' : "");
  }

  /* ---- actions ---- */

  static #onSetLibrary(ev, t) {
    const lib = t.dataset.lib;
    if ( !lib || lib === this.lib || t.disabled ) return;
    this.lib = lib;
    this.f = { kind: new Set(), shape: new Set(), colors: new Set(), persistent: false, category: "" };
    this.#stopSound();
    this.#syncLibButtons();
    this.#buildSide();
    this.#refresh();
  }

  static #onToggleFilter(ev, t) {
    const { facet, value } = t.dataset;
    if ( facet === "persistent" ) this.f.persistent = !this.f.persistent;
    else if ( facet === "category" ) this.f.category = this.f.category === value ? "" : value;
    else { const set = this.f[facet]; if ( set.has(value) ) set.delete(value); else set.add(value); }
    this.#refresh();
  }

  static #onRemovePill(ev, t) {
    const { facet, value } = t.dataset;
    if ( facet === "persistent" ) this.f.persistent = false;
    else if ( facet === "category" ) this.f.category = "";
    else this.f[facet].delete(value);
    this.#refresh();
  }

  static #onClearAll() {
    this.f = { kind: new Set(), shape: new Set(), colors: new Set(), persistent: false, category: "" };
    this.#refresh();
  }

  static #onClearSearch() {
    const q = this.$(".ast-picker-q");
    q.value = ""; this.query = "";
    this.$(".ast-picker-clear").hidden = true;
    q.focus();
    this.#refresh();
  }

  static #onToggleSection(ev, t) {
    t.closest(".ast-picker-sbox")?.classList.toggle("collapsed");
  }

  static #onToggleFav(ev, t) {
    const id = t.closest(".ast-picker-card")?.dataset.fam;
    if ( !id ) return;
    const i = this._favs.indexOf(id);
    if ( i >= 0 ) this._favs.splice(i, 1); else this._favs.unshift(id);
    writeList("pickerFavorites", [...this._favs]);
    const on = i < 0;
    for ( const c of this.#cards(id) ) {
      const star = c.querySelector(".ast-picker-star");
      star.classList.toggle("on", on);
      star.querySelector("i").className = `fa-${on ? "solid" : "regular"} fa-star`;
    }
    // Keep the Favorites section honest without a full re-render when it is on screen.
    if ( !this.query.trim() && this._sections.some(s => s.key === "fav") !== (this._favs.length > 0) ) this.#renderResults();
  }

  static #onSetVariant(ev, t) {
    const card = t.closest(".ast-picker-card");
    const fam = this.catalog.byId.get(t.dataset.fam ?? card?.dataset.fam);
    if ( !fam ) return;
    const n = fam.variants.length;
    const idx = t.dataset.step ? (this.#variantIndex(fam) + Number(t.dataset.step) + n) % n : Number(t.dataset.index);
    this._variant.set(fam.id, idx);
    this.#refreshCard(fam);
    if ( this._sel?.family === fam && !this._sel.custom ) this.#syncFooter();
    else this.#select(fam.id);
  }

  static #onPlaySound(ev, t) {
    const card = t.closest(".ast-picker-card");
    if ( !card ) return;
    this.#playSoundFor(card, t);
  }

  static #onShowMore() { this.#showMore(); }

  static async #onPreviewOnToken() {
    const path = this.#selectedPath();
    if ( !path ) return ui.notifications?.warn("Select something first.");
    if ( !globalThis.Sequence ) return ui.notifications?.error("Sequencer is not available.");
    const fam = this._sel?.family;
    const isSound = this.mode === "sound" || fam?.library === "psfx" || fam?.kind === "sound";
    try {
      if ( isSound ) { await new Sequence().sound().file(path).volume(0.6).play(); return; }
      const token = canvas.tokens?.controlled?.[0];
      if ( !token ) return ui.notifications?.warn("Control a token to preview on.");
      const targets = game.user.targets;
      const tgt = targets?.first?.() ?? [...(targets ?? [])][0] ?? null;
      const kind = fam?.kind ?? this.cueKind;
      const seq = new Sequence();
      const e = seq.effect().file(path);
      if ( ["projectile", "melee"].includes(kind) && tgt && tgt !== token ) e.atLocation(token).stretchTo(tgt);
      else e.atLocation(tgt ?? token).scaleToObject(1.5);
      if ( fam?.persistent || ["aura", "marker"].includes(kind) ) e.duration(4000).fadeIn(250).fadeOut(500);
      await seq.play();
    } catch ( err ) {
      console.warn(`${MODULE_ID} | preview failed`, err);
      ui.notifications?.warn("That couldn't be previewed (see the console).");
    }
  }

  #use() {
    const path = this.#selectedPath();
    if ( !path ) return ui.notifications?.warn("Select something first.");
    const fam = this._sel?.family;
    const rec = (fam && !this._sel.custom) ? fam.id : path;
    this._recent = [rec, ...this._recent.filter(x => x !== rec)].slice(0, RECENT_MAX);
    writeList("pickerRecent", [...this._recent]);
    this._result = path;
    this.close();
  }

  static #onUse() { this.#use(); }

  static #onCancel() { this._result = null; this.close(); }
}
