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
 *     file      a Sequencer database path (jb2a.fire_bolt.orange) or a file path; empty = sound only
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
 * @returns {Promise<boolean>} whether anything played
 */
export async function playCue(cue, ctx={}) {
  const c = normalizeCue(cue);
  if ( !c || !canPlay() ) return false;
  const seq = new Sequence({ moduleName: MODULE_ID, softFail: true });
  let added = 0;
  for ( const step of c.steps ) added += addStep(seq, step, ctx);
  if ( !added ) return false;
  await seq.play();
  return true;
}

/** Add one step to a sequence. Returns how many sections were added. */
function addStep(seq, s, ctx) {
  let n = 0;
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
