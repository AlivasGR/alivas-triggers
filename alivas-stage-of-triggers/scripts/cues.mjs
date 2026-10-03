/**
 * Alivas's Stage of Triggers — cues: what to show and play, and the player (Sequencer).
 *
 * A cue is a list of steps played in order, each an animation and/or a sound:
 *
 *   { steps: [Step, …] }
 *
 *   Step {
 *     kind      "onToken"    on creatures (at)                       — a buff flash, a condition marker, a cast
 *               "projectile" from → to, stretched (bolts, arrows, rays; JB2A picks the file for the distance)
 *               "melee"      from → to, a swing at melee range
 *               "impact"     on creatures or a point, sized to them  — a burst where it lands
 *               "area"       on the area (a placed template / region) — sized and shaped to it
 *               "aura"       around a creature, following it          — sized to the effect's area (radius) if any
 *               "teleport"   vanish where a creature was, appear where it lands (needs a move)
 *               "sound"      sound only
 *     file      a Sequencer database path (jb2a.fire_bolt.orange) or a file path; empty = sound only. A database path
 *               that isn't installed (free JB2A) plays the closest one that is (resolveFile), else the step is skipped
 *     at        onToken / impact / aura: "source" | "targets" | "subject" | "bearer" | "region" (default by kind)
 *     from, to  projectile / melee:     "source" | "targets" | "subject" | "bearer"
 *     scale     size multiplier (1)                     opacity (1)        below  under tokens (false)
 *     delay     ms before it starts                     persist  stays until what it belongs to ends (effect,
 *                                                                area, condition) — on aura / onToken / area
 *     wait      "finish" (next step waits for this one) | ms | 0 (next starts with it)
 *     missFile  projectile / melee: play this on a miss instead (default: same file, missed)
 *     repeats   number of times (1)                    fade     ms fade in/out (250)
 *     sound     { file, volume (0..1, default 0.6), delay ms }
 *   }
 *
 * A play context says who and where:
 *   { source: Token, targets: Token[], subject: Token, bearer: Token, region: {x, y, radius, shape, direction}, moves,
 *     hit: Map<tokenId, boolean>, origin: uuid (persistent steps are tagged with it, to end them later) }
 */

export const MODULE_ID = "alivas-stage-of-triggers";

export const STEP_KINDS = [
  ["onToken", "fa-user", "On a creature", "A flash, cast or marker on creatures"],
  ["projectile", "fa-arrow-right-long", "Projectile", "Flies from one creature to another (bolts, arrows, rays)"],
  ["melee", "fa-hand-fist", "Melee swing", "A strike from one creature at another"],
  ["impact", "fa-burst", "Impact", "A burst on creatures or where something lands"],
  ["area", "fa-circle-dot", "Area", "Fills the area (a spell's template or region)"],
  ["aura", "fa-circle-radiation", "Aura", "Around a creature, moving with it"],
  ["teleport", "fa-person-through-window", "Teleport", "Vanish at the start, appear at the end of a move"],
  ["sound", "fa-volume-high", "Sound only", "Just a sound"]
];
export const KIND_LABEL = Object.fromEntries(STEP_KINDS.map(([id, , label]) => [id, label]));

const WHO = { source: "the user", targets: "the targets", subject: "the creature concerned", bearer: "the bearer", region: "the area" };
export const WHO_ENTRIES = Object.entries(WHO);

/** Step defaults by kind. */
export function newStep(kind="onToken") {
  const step = { kind, file: "" };
  if ( ["projectile", "melee"].includes(kind) ) Object.assign(step, { from: "source", to: "targets", wait: "finish" });
  else if ( kind === "area" ) step.at = "region";
  else if ( kind === "aura" ) Object.assign(step, { at: "bearer", persist: true, below: true });
  else if ( kind === "impact" ) step.at = "targets";
  else if ( kind === "onToken" ) step.at = "targets";
  return step;
}

/** A cue with at least its steps array, or null when empty. */
export function normalizeCue(cue) {
  if ( !cue ) return null;
  const steps = (Array.isArray(cue.steps) ? cue.steps : []).filter(s => s && (s.file || s.sound?.file || (s.kind === "teleport")));
  return steps.length ? { ...cue, steps } : null;
}

export function isPersistent(cue) {
  return !!cue?.steps?.some(s => s.persist);
}

/* -------------------------------------------- */
/*  Describe                                    */
/* -------------------------------------------- */

const lastSegment = path => String(path ?? "").split(/[./]/).filter(Boolean)
  .filter((seg, i) => !((i === 0) && /^(jb2a|psfx|modules)$/i.test(seg))).slice(-3).join(" ").replace(/[_-]/g, " ");

/** "Projectile (fire bolt orange) from the user to the targets, with a sound; then Impact …" */
export function describeCue(cue) {
  const c = normalizeCue(cue);
  if ( !c ) return "";
  return c.steps.map(s => {
    const what = s.file ? `${KIND_LABEL[s.kind] ?? s.kind} (${lastSegment(s.file)})` : (s.kind === "sound" || !s.file ? "Sound" : KIND_LABEL[s.kind]);
    let where = "";
    if ( ["projectile", "melee"].includes(s.kind) ) where = ` from ${WHO[s.from ?? "source"]} to ${WHO[s.to ?? "targets"]}`;
    else if ( s.kind !== "sound" && s.kind !== "teleport" ) where = ` on ${WHO[s.at ?? "targets"]}`;
    const extras = [s.persist ? "while it lasts" : "", (s.sound?.file && s.file) ? "with a sound" : ""].filter(Boolean);
    return `${what}${where}${extras.length ? `, ${extras.join(", ")}` : ""}`;
  }).join("; then ");
}

/* -------------------------------------------- */
/*  Play                                        */
/* -------------------------------------------- */

const volume = () => game.settings.get(MODULE_ID, "volume");

/** Is Sequencer there, and are animations on for this client? */
export function canPlay() {
  return !!globalThis.Sequencer && !!globalThis.Sequence && game.settings.get(MODULE_ID, "enabled");
}

/* -------------------------------------------- */
/*  Missing files                               */
/* -------------------------------------------- */

/** Resolved database paths, valid while the database keeps the same size (modules register theirs late). */
const resolved = new Map();
let resolvedFor = -1;

const isDatabasePath = path => !/[/\\]/.test(path) && !/\.(webm|webp|png|jpe?g|gif|mp4|ogg|mp3|wav|flac|m4a)$/i.test(path);
/** JB2A writes colours run together (bluepurple, yellowwhite): split those into colour words. */
const COLOURS = /red|orange|yellow|gold|green|teal|cyan|blue|purple|violet|pink|magenta|white|grey|gray|black|dark|light|bright|brown|rainbow/g;
const words = seg => String(seg).toLowerCase().split(/[_-]/).filter(Boolean)
  .flatMap(w => (w.replace(COLOURS, "") === "" ? w.match(COLOURS) : [w]));
/** Neighbouring hues, so a missing purple prefers pink or blue to orange. */
const NEAR = { red: ["orange", "pink", "dark"], orange: ["red", "yellow", "gold"], yellow: ["gold", "orange", "white"],
  gold: ["yellow", "orange"], green: ["teal", "yellow"], teal: ["blue", "green", "cyan"], cyan: ["teal", "blue"],
  blue: ["teal", "purple", "cyan"], purple: ["pink", "violet", "blue", "magenta"], violet: ["purple", "pink"],
  pink: ["purple", "magenta", "red"], magenta: ["pink", "purple"], white: ["grey", "gray", "yellow", "light"],
  grey: ["white", "black"], gray: ["white", "black"], black: ["dark", "grey", "gray"], dark: ["black"] };
const likeness = (want, have) => want.reduce((sum, m) => sum + (have.includes(m) ? 2
  : have.some(w => NEAR[m]?.includes(w) || ((m.length > 3) && (w.includes(m) || m.includes(w)))) ? 1 : 0), 0);

/**
 * The database path to play for a cue's file. Presets are written against JB2A Patreon; the free JB2A lacks most
 * colours and some variants. A path that isn't in the database is replaced by the closest one that is: trailing
 * colour / number segments are dropped until an existing branch is found, then the branch's entry at the original depth
 * closest in colour is taken (jb2a.impact.003.pinkpurple → jb2a.impact.003.purple, else .blue…). A missing name
 * (fumes.toxic) is not swapped for another animation: the step is skipped.
 * Keeping the depth keeps the structure: a projectile still gets a branch with its distance files.
 * File paths, and anything when the database isn't loaded yet, are returned unchanged.
 * @param {string} path
 * @returns {string|null}  null: nothing in that family exists
 */
export function resolveFile(path) {
  if ( !path || !isDatabasePath(path) ) return path || null;
  const entries = globalThis.Sequencer?.Database?.flattenedEntries;
  if ( !entries?.length ) return path;
  if ( resolvedFor !== entries.length ) { resolved.clear(); resolvedFor = entries.length; }
  if ( resolved.has(path) ) return resolved.get(path);
  const segs = path.split(".");
  const under = prefix => entries.filter(e => (e === prefix) || e.startsWith(`${prefix}.`));
  let result = under(path).length ? path : null;
  // Only colours and variant numbers are swapped, anywhere in the path (toll_the_dead.purple.skull_smoke →
  // toll_the_dead.green.skull_smoke); every other segment must stay: fumes.toxic → fumes.steam is another animation.
  const variant = seg => words(seg).every(w => /^\d+$/.test(w) || (w.replace(COLOURS, "") === ""));
  for ( let i = segs.length - 1; !result && (i >= 2); i-- ) {
    const missing = segs.slice(i).flatMap(words);
    const found = under(segs.slice(0, i).join("."));
    if ( !found.length ) continue;
    const candidates = [...new Set(found.map(e => e.split(".").slice(0, segs.length).join(".")))].filter(c => {
      const cs = c.split(".");
      return (cs.length === segs.length) && cs.every((seg, j) => (j < i) || (seg === segs[j]) || (variant(seg) && variant(segs[j])));
    });
    if ( !candidates.length ) continue;
    const score = c => likeness(missing, c.split(".").slice(i).flatMap(words));
    result = candidates.reduce((best, c) => (score(c) > score(best) ? c : best), candidates[0]);
  }
  resolved.set(path, result);
  if ( result !== path ) {
    let debug = false;
    try { debug = game.settings.get(MODULE_ID, "debug"); } catch(err) {}
    if ( debug ) console.log(`${MODULE_ID} | "${path}" is not installed — ${result ? `playing "${result}"` : "skipped"}`);
  }
  return result;
}

/** Would this cue show or play anything with the animations installed? (Not whether this client has them on.) */
export function cuePlayable(cue) {
  const c = normalizeCue(cue);
  if ( !c ) return false;
  return c.steps.some(s => (s.file && resolveFile(s.file)) || (s.sound?.file && resolveFile(s.sound.file)));
}

/** Tokens a step role resolves to. */
function tokensFor(role, ctx) {
  switch ( role ) {
    case "source": return [ctx.source].filter(Boolean);
    case "bearer": return [ctx.bearer ?? ctx.source].filter(Boolean);
    case "subject": return [ctx.subject ?? ctx.targets?.[0]].filter(Boolean);
    case "targets": return (ctx.targets?.length ? ctx.targets : [ctx.subject].filter(Boolean));
    default: return [];
  }
}

/** Tokens' placeable objects (Sequencer accepts documents too, but placeables give sizes). */
const obj = t => t?.object ?? t;

/**
 * Play a cue.
 * @param {object} cue
 * @param {object} ctx  see the header
 * @param {{local?: boolean}} [options]  local: only on this screen (previews)
 * @returns {Promise<boolean>} whether anything played
 */
export async function playCue(cue, ctx={}, { local=false }={}) {
  const c = normalizeCue(cue);
  if ( !c || !canPlay() ) return false;
  const seq = new Sequence({ moduleName: MODULE_ID, softFail: true });
  let added = 0;
  for ( const step of c.steps ) added += addStep(seq, step, ctx);
  if ( !added ) return false;
  await seq.play({ local });
  return true;
}

/** Add one step to a sequence. Returns how many sections were added. */
function addStep(seq, step, ctx) {
  let n = 0;
  const s = { ...step, file: resolveFile(step.file) ?? "", missFile: resolveFile(step.missFile) ?? "" };
  if ( step.sound?.file ) s.sound = { ...step.sound, file: resolveFile(step.sound.file) ?? "" };
  const sound = s.sound?.file ? s.sound : (s.kind === "sound" ? { file: s.file } : null);
  if ( sound?.file ) {
    seq.sound().file(sound.file).volume((Number(sound.volume ?? 0.6)) * volume()).delay(Number(sound.delay ?? 0) + Number(s.delay ?? 0));
    n++;
  }
  if ( !s.file || (s.kind === "sound") ) return n;
  const fade = Number(s.fade ?? 250);
  const base = (e, persist) => {
    e.file(s.file).opacity(Number(s.opacity ?? 1)).fadeIn(fade).fadeOut(fade).delay(Number(s.delay ?? 0));
    if ( s.below ) e.belowTokens(true);
    if ( Number(s.repeats) > 1 ) e.repeats(Number(s.repeats), 200);
    if ( persist && ctx.origin ) e.persist().origin(ctx.origin).name(`${MODULE_ID}.${ctx.origin}`);
    return e;
  };
  const waitFor = e => {
    if ( s.wait === "finish" ) e.waitUntilFinished(-200);
    else if ( Number(s.wait) > 0 ) e.waitUntilFinished(-Number(s.wait));
  };
  const persist = !!s.persist && !!ctx.origin;
  switch ( s.kind ) {
    case "projectile":
    case "melee": {
      const from = obj(tokensFor(s.from ?? "source", ctx)[0]);
      const tos = tokensFor(s.to ?? "targets", ctx).map(obj).filter(t => t && (t !== from));
      if ( !from ) return n;
      let last = null;
      for ( const to of tos ) {
        const hit = ctx.hit?.get?.(to.document?.id ?? to.id);
        const e = seq.effect();
        base(e, false);
        if ( (hit === false) && s.missFile ) e.file(s.missFile);
        e.atLocation(from).stretchTo(to, { randomOffset: hit === false ? 0.6 : 0 });
        if ( hit === false ) e.missed(true);
        if ( Number(s.scale ?? 1) !== 1 ) e.scale(Number(s.scale));
        last = e; n++;
      }
      if ( last ) waitFor(last);
      return n;
    }
    case "area": {
      const r = ctx.region;
      if ( !r ) return n;
      const e = seq.effect();
      base(e, persist);
      const grid = canvas.grid.size / canvas.scene.grid.distance;
      if ( (r.shape === "cone") || (r.shape === "line") || (r.shape === "ray") ) {
        e.atLocation({ x: r.x, y: r.y }).anchor({ x: 0, y: 0.5 }).rotate(-(r.direction ?? 0))
          .size({ width: (r.length ?? r.radius ?? 15) * grid, height: (r.width ?? r.length ?? 15) * grid * (r.shape === "cone" ? 1 : 1) });
      } else {
        const d = (r.radius ?? 10) * 2 * grid * Number(s.scale ?? 1);
        e.atLocation({ x: r.x, y: r.y }).size({ width: d, height: d });
      }
      waitFor(e); n++;
      return n;
    }
    case "aura": {
      for ( const t of tokensFor(s.at ?? "bearer", ctx).map(obj).filter(Boolean) ) {
        const e = seq.effect();
        base(e, persist);
        const radius = Number(ctx.radius ?? 0);
        if ( radius > 0 ) {
          const units = canvas.grid.size / canvas.scene.grid.distance;
          const d = (radius * 2 * units + (t.w ?? canvas.grid.size)) * Number(s.scale ?? 1);
          e.attachTo(t, { bindAlpha: false }).size({ width: d, height: d });
        } else e.attachTo(t, { bindAlpha: false }).scaleToObject(2 * Number(s.scale ?? 1));
        if ( !persist ) waitFor(e);
        n++;
      }
      return n;
    }
    case "teleport": {
      for ( const m of ctx.moves ?? [] ) {
        const size = (m.token?.width ?? 1) * canvas.grid.size;
        const centre = p => ({ x: p.x + (size / 2), y: p.y + (size / 2) });
        const out = seq.effect(); base(out, false);
        out.atLocation(centre(m.from)).size({ width: size * 2 * Number(s.scale ?? 1), height: size * 2 * Number(s.scale ?? 1) });
        const inn = seq.effect(); base(inn, false);
        inn.atLocation(centre(m.to)).size({ width: size * 2 * Number(s.scale ?? 1), height: size * 2 * Number(s.scale ?? 1) }).delay(250 + Number(s.delay ?? 0));
        n += 2;
      }
      return n;
    }
    default: { // onToken, impact
      const role = s.at ?? "targets";
      if ( role === "region" ) {
        if ( !ctx.region ) return n;
        const e = seq.effect(); base(e, persist);
        e.atLocation({ x: ctx.region.x, y: ctx.region.y }).scale(Number(s.scale ?? 1));
        waitFor(e);
        return n + 1;
      }
      let last = null;
      for ( const t of tokensFor(role, ctx).map(obj).filter(Boolean) ) {
        const e = seq.effect();
        base(e, persist);
        if ( persist ) e.attachTo(t, { bindAlpha: false });
        else e.atLocation(t);
        e.scaleToObject(Number(s.scale ?? (s.kind === "impact" ? 1.5 : 1.2)));
        last = e; n++;
      }
      if ( last && !persist ) waitFor(last);
      return n;
    }
  }
}

/** End the persistent animations started for an origin (an effect, a region, a condition). */
export async function endCue(origin) {
  if ( !globalThis.Sequencer || !origin ) return;
  await Sequencer.EffectManager.endEffects({ name: `${MODULE_ID}.${origin}` });
}
