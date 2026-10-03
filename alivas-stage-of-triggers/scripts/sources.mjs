/**
 * Alivas's Stage of Triggers — where cues come from, and when they play.
 *
 * Cue sources, most specific first:
 *   Item           flags.alivas-stage-of-triggers.cues = { [activityId | "*"]: { use, attack, hit, damage, area } }
 *                    use     right after the activity is used (on its targets, or the user)
 *                    attack  the attack roll — projectile / melee steps know which targets were hit or missed
 *                    hit     the targets an attack hit
 *                    damage  when damage (or healing) is rolled
 *                    area    when its area (template) is placed — persistent steps last as long as the area
 *   Effect         flags.alivas-stage-of-triggers.cue = { start, active, end }
 *                    start   when it's applied · active  shown while it lasts (persist) · end  when it ends
 *   Engine action  action.animation (any trigger or activity step of Alivas's Engine), or the "animate" action
 *   Presets        presets/box.json (Box items), then presets/items.json (general: spells, weapons, features…),
 *                  merged per moment (box.json wins where both define one); "baseItem": "longsword" also covers every
 *                  longsword (magic, enspelled, renamed) by its base weapon;
 *                  matched like the Box matches items (name + type, aliases too), when the item or effect has
 *                  none of its own: { name, type, activities: { "*" | activity name: {phase: cue} },
 *                  effects: { effect name: { start, active, end } }, actions: { key: cue } }
 *                  Action keys, most specific first (see presetAction):
 *                    "<effect name>|<event>|<action type>"   e.g. "Seared|turnStart|damage", "Vengeful Blade|onHit|damage"
 *                    "<effect name>|<action type>"           e.g. "Flaming Sphere|damage"
 *                    "<event>|<action type>"                 e.g. "areaTurnEnd|damage"
 *                    "<action type>"                         e.g. "teleport"
 *                  An activity step (onUse / onHit) counts as an effect named like its item, with that event.
 *   Conditions     world setting (statusCues) or presets/statuses.json: { statusId: { start, active, end } }
 *   Moves          world setting (moveCues): { teleport, push } for engine moves with no animation of their own
 */

import { MODULE_ID, playCue, endCue, normalizeCue, cuePlayable, isPersistent } from "./cues.mjs";

const setting = key => game.settings.get(MODULE_ID, key);
const engine = () => game.modules.get("alivas-engine-of-triggers")?.api;
const isLeadGM = () => engine()?.creatures?.isLeadGM?.() ?? (game.user === game.users.activeGM);

/* -------------------------------------------- */
/*  Presets                                     */
/* -------------------------------------------- */

const PRESETS = { items: new Map(), statuses: {} };
const keyOf = (name, type) => `${String(name ?? "").trim().toLowerCase()}|${type ?? ""}`;

export async function loadPresets() {
  PRESETS.items.clear();
  PRESETS.statuses = {};
  if ( !setting("presets") ) return;
  // box.json (the Box of Triggers' items) wins over items.json (general spells, weapons and features).
  for ( const file of ["box", "items", "statuses"] ) {
    try {
      const data = await foundry.utils.fetchJsonWithTimeout(`modules/${MODULE_ID}/presets/${file}.json`);
      if ( file === "statuses" ) Object.assign(PRESETS.statuses, data);
      else for ( const p of data ) {
        const keys = [p.name, ...(p.aliases ?? [])].filter(Boolean).map(n => keyOf(n, p.type));
        if ( p.baseItem ) keys.push(keyOf(`base:${p.baseItem}`, p.type ?? "weapon"));
        for ( const key of keys ) PRESETS.items.set(key, mergePreset(PRESETS.items.get(key), p));
      }
    } catch(err) {
      if ( !String(err).includes("404") ) console.warn(`${MODULE_ID} | presets/${file}.json`, err);
    }
  }
}

/**
 * Merge a later preset into an earlier one for the same item: the earlier (box.json) wins wherever it defines a moment;
 * the later (items.json) fills in the rest — activity phases, effects' start / active / end, action keys.
 */
function mergePreset(first, next) {
  if ( !first ) return next;
  const out = { ...first };
  for ( const part of ["activities", "effects"] ) {
    const a = first[part] ?? {};
    const merged = { ...a };
    for ( const [k, v] of Object.entries(next[part] ?? {}) ) merged[k] = { ...v, ...(a[k] ?? {}) };
    if ( Object.keys(merged).length ) out[part] = merged;
  }
  if ( first.actions || next.actions ) out.actions = { ...(next.actions ?? {}), ...(first.actions ?? {}) };
  return out;
}

/**
 * The preset for an item: by name and type; by name only; by name without a trailing "(…)"; then, for weapons, by base
 * weapon (a preset with "baseItem": "longsword" covers every longsword — magic, enspelled or renamed).
 */
export function presetFor(item) {
  if ( !item ) return null;
  const base = item.system?.type?.baseItem;
  return PRESETS.items.get(keyOf(item.name, item.type)) ?? PRESETS.items.get(keyOf(item.name, ""))
    ?? PRESETS.items.get(keyOf(item.name?.replace(/\s*\(.*\)\s*$/, ""), item.type))
    ?? (base ? PRESETS.items.get(keyOf(`base:${base}`, item.type)) : null) ?? null;
}

/* -------------------------------------------- */
/*  Lookups                                     */
/* -------------------------------------------- */

/** An item's cues for an activity (its own flags, else its preset). { cues, preset: boolean } */
export function itemCues(item, activity) {
  const own = item?.getFlag?.(MODULE_ID, "cues");
  const pick = map => map?.[activity?.id] ?? map?.[activity?.name] ?? map?.["*"] ?? null;
  if ( own && Object.keys(own).length ) return { cues: pick(own) ?? {}, preset: false };
  const preset = presetFor(item);
  return { cues: pick(preset?.activities) ?? {}, preset: !!preset };
}

/** An effect's cues (its own flag, else its item's preset, else the condition presets / setting for its statuses). */
export function effectCues(effect) {
  const own = effect?.getFlag?.(MODULE_ID, "cue");
  if ( own && Object.keys(own).length ) return own;
  const item = effectItem(effect);
  const preset = presetFor(item)?.effects?.[effect.name];
  if ( preset ) return preset;
  return null;
}

/** The item an effect belongs to or came from. */
/** An enchantment applied to an item (dnd5e): an enabled effect of type "enchantment" on an item. */
const isEnchantment = effect => (effect?.type === "enchantment") && (effect.parent?.documentName === "Item") && !effect.disabled;

function effectItem(effect) {
  // An applied enchantment (Sacred Weapon on a sword): the item whose activity enchanted it, not the sword.
  if ( isEnchantment(effect) ) {
    const activity = effect.system?.origin?.activity ? fromUuidSync(effect.system.origin.activity, { strict: false }) : null;
    if ( activity?.item ) return activity.item;
  }
  if ( effect?.parent?.documentName === "Item" ) return effect.parent;
  const origin = effect?.origin ? fromUuidSync(effect.origin, { strict: false }) : null;
  if ( origin?.documentName === "Item" ) return origin;
  if ( origin?.documentName === "ActiveEffect" ) return origin.parent?.documentName === "Item" ? origin.parent : null;
  return origin?.item ?? null;
}

/** Cues for a condition (status id): the world setting, else the preset. */
export function statusCues(id) {
  return setting("statusCues")?.[id] ?? PRESETS.statuses[id] ?? null;
}

/** Does any phase ({ start, active, end }) of an effect's cues play with the animations installed? */
const phasesPlayable = c => Object.values(c ?? {}).some(cuePlayable);

/**
 * Does anything of ours animate this activity or effect? (Then Automated Animations stays out of it.) Only cues that
 * would actually play count: when none of their animations or sounds are installed, Automated Animations keeps it.
 */
export function hasOwnCues({ item, activity, effect }) {
  if ( effect ) {
    if ( phasesPlayable(effectCues(effect)) || (effect.statuses?.size && [...effect.statuses].some(s => phasesPlayable(statusCues(s)))) ) return true;
    // An effect from an item we animate is ours too (Celestial Revelation's wings: the feature's preset owns them).
    const from = effectItem(effect);
    return from ? hasOwnCues({ item: from, activity: null }) : false;
  }
  const { cues } = itemCues(item, activity);
  if ( Object.values(cues ?? {}).some(cuePlayable) ) return true;
  // Any activity of the item animated by us → we own the whole item (no Automated Animations on its other activities,
  // e.g. a feature whose preset animates one activity and its effect). Effect-only presets leave the item to AA.
  const anyPhase = map => Object.values(map ?? {}).some(phases => Object.values(phases ?? {}).some(cuePlayable));
  const own = item?.getFlag?.(MODULE_ID, "cues");
  if ( anyPhase(own) || anyPhase(presetFor(item)?.activities) ) return true;
  // The activity applies an effect that has a "start" animation of ours: that animation is the activity's, so AA
  // stays out (Celestial Revelation's Heavenly Wings). An effect with only a loop leaves the cast to AA.
  const applied = (activity?.effects ?? []).map(p => p.effect ?? item?.effects?.get?.(p._id ?? p.id)).filter(Boolean);
  return applied.some(e => cuePlayable(effectCues(e)?.start));
}

/* -------------------------------------------- */
/*  Context helpers                             */
/* -------------------------------------------- */

/** A token for an actor or token-ish thing, on the viewed scene. */
export function tokenOf(x) {
  if ( !x ) return null;
  if ( x.documentName === "Token" ) return x;
  if ( x.document?.documentName === "Token" ) return x.document;
  const actor = x.documentName === "Actor" ? x : x.actor;
  const t = actor?.getActiveTokens?.(false, true)?.find(t => t.parent === canvas.scene) ?? actor?.token;
  return t?.parent === canvas.scene ? t : null;
}

const tokensOf = list => [...new Set((list ?? []).map(tokenOf).filter(Boolean))];

/** Region geometry for area steps. */
export function regionInfo(region) {
  if ( !region ) return null;
  const units = canvas.grid.size / canvas.scene.grid.distance;
  const shape = region.shapes?.[0];
  if ( shape?.type === "circle" ) return { x: shape.x, y: shape.y, radius: shape.radius / units, shape: "circle" };
  if ( (shape?.type === "cone") || (shape?.type === "line") || (shape?.type === "ray") ) {
    return { x: shape.x, y: shape.y, length: (shape.radius ?? shape.length ?? 0) / units, width: (shape.width ?? 0) / units,
      direction: -(shape.rotation ?? shape.direction ?? 0), shape: shape.type === "ray" ? "line" : shape.type };
  }
  const b = region.bounds ?? region.object?.bounds;
  if ( !b ) return null;
  return { x: b.x + (b.width / 2), y: b.y + (b.height / 2), radius: Math.max(b.width, b.height) / 2 / units, shape: "square" };
}

/* -------------------------------------------- */
/*  Activity hooks (dnd5e)                      */
/* -------------------------------------------- */

const AREA_TYPES = () => Object.keys(CONFIG.DND5E.areaTargetTypes ?? {});

function activityContext(activity, extra={}) {
  const source = tokenOf(activity.actor);
  const targets = tokensOf([...game.user.targets].map(t => t.document));
  return { source, bearer: source, targets, subject: targets[0] ?? null, ...extra };
}

async function playItemPhase(activity, phase, ctx) {
  const item = activity?.item;
  const { cues } = itemCues(item, activity);
  const cue = cues?.[phase];
  if ( !normalizeCue(cue) ) return false;
  return playCue(cue, ctx ?? activityContext(activity));
}

/** Attack hit map from the roll against each target's AC. */
function hitMap(roll, targets) {
  const map = new Map();
  for ( const t of targets ) {
    const ac = t.actor?.system?.attributes?.ac?.value;
    const hit = roll.isCritical || (!roll.isFumble && (Number.isFinite(ac) ? roll.total >= ac : roll.total >= (roll.options?.target ?? 0)));
    map.set(t.id, !!hit);
  }
  return map;
}

export function registerActivityHooks() {
  Hooks.on("dnd5e.postUseActivity", (activity) => {
    if ( !activity?.item ) return;
    playItemPhase(activity, "use");
  });
  Hooks.on("dnd5e.rollAttackV2", (rolls, data) => {
    const activity = data?.subject;
    if ( !activity?.item ) return;
    const ctx = activityContext(activity);
    ctx.hit = hitMap(rolls[0], ctx.targets);
    playItemPhase(activity, "attack", ctx).then(() => {
      const hits = ctx.targets.filter(t => ctx.hit.get(t.id));
      if ( hits.length ) playItemPhase(activity, "hit", { ...ctx, targets: hits, subject: hits[0] });
    });
  });
  Hooks.on("dnd5e.rollDamageV2", (rolls, data) => {
    const activity = data?.subject;
    if ( activity?.item ) playItemPhase(activity, "damage");
  });
  Hooks.on("dnd5e.rollHealing", (rolls, data) => {
    const activity = data?.subject;
    if ( activity?.item ) playItemPhase(activity, "damage");
  });
  Hooks.on("createRegion", (region, options, userId) => {
    if ( userId !== game.user.id ) return;
    const uuid = region.flags?.dnd5e?.activity ?? region.flags?.dnd5e?.origin;
    const activity = uuid ? fromUuidSync(uuid, { strict: false }) : null;
    if ( !activity?.item ) return;
    const { cues } = itemCues(activity.item, activity);
    const cue = cues?.area;
    if ( !normalizeCue(cue) ) return;
    const ctx = activityContext(activity, { region: regionInfo(region), origin: region.uuid });
    // Shapes fill in once the region is drawn.
    setTimeout(() => playCue(cue, { ...ctx, region: regionInfo(region) ?? ctx.region }), 50);
  });
  Hooks.on("deleteRegion", region => {
    if ( isLeadGM() ) endCue(region.uuid);
  });
}

/* -------------------------------------------- */
/*  Effects and conditions                      */
/* -------------------------------------------- */

function effectBearer(effect) {
  // An enchantment plays on whoever holds the enchanted item.
  const actor = effect.parent?.documentName === "Actor" ? effect.parent
    : isEnchantment(effect) && (effect.parent?.parent?.documentName === "Actor") ? effect.parent.parent : null;
  return actor ? tokenOf(actor) : null;
}

/** An effect's area radius (Alivas's Engine area flag), for aura steps. */
const areaRadius = effect => Number(effect.getFlag?.("alivas-engine-of-triggers", "area")?.radius) || 0;

async function effectStart(effect) {
  const bearer = effectBearer(effect);
  if ( !bearer ) return;
  const source = tokenOf(effect.getSourceActor?.()) ?? bearer;
  const ctx = { source, bearer, targets: [bearer], subject: bearer, radius: areaRadius(effect) };
  const cues = [effectCues(effect), ...[...(effect.statuses ?? [])].map(statusCues)].filter(Boolean);
  for ( const c of cues ) {
    if ( c.start ) await playCue(c.start, ctx);
    if ( c.active ) await playCue(c.active, { ...ctx, origin: effect.uuid });
  }
}

async function effectEnd(effect, { play=true, persist=true }={}) {
  if ( persist ) await endCue(effect.uuid);
  if ( !play ) return;
  const bearer = effectBearer(effect);
  if ( !bearer ) return;
  const cues = [effectCues(effect), ...[...(effect.statuses ?? [])].map(statusCues)].filter(Boolean);
  for ( const c of cues ) if ( c.end ) await playCue(c.end, { source: bearer, bearer, targets: [bearer], subject: bearer });
}

/** Effects that are actor-level and active (not item effects, not suppressed or disabled), or an enchantment applied to
 * an item a creature holds. */
const live = effect => ((effect.parent?.documentName === "Actor") || (isEnchantment(effect) && (effect.parent?.parent?.documentName === "Actor")))
  && effect.active !== false && !effect.disabled && !effect.isSuppressed;

export function registerEffectHooks() {
  Hooks.on("createActiveEffect", (effect, options, userId) => {
    if ( (userId !== game.user.id) || !live(effect) ) return;
    effectStart(effect);
  });
  Hooks.on("deleteActiveEffect", (effect, options, userId) => {
    // The lead GM ends persistent animations (Sequencer lets a GM end anyone's); the deleting user plays "end".
    if ( isLeadGM() ) endCue(effect.uuid);
    if ( userId === game.user.id ) effectEnd(effect, { persist: false });
  });
  // An item leaving a creature (traded, dropped, destroyed) takes its enchantments' loops with it.
  Hooks.on("deleteItem", item => {
    if ( !isLeadGM() ) return;
    for ( const effect of item.effects ?? [] ) if ( isEnchantment(effect) ) endCue(effect.uuid);
  });
  Hooks.on("updateActiveEffect", (effect, changes, options, userId) => {
    if ( userId !== game.user.id ) return;
    if ( !("disabled" in changes) && !foundry.utils.hasProperty(changes, "duration") ) return;
    if ( live(effect) ) { if ( changes.disabled === false ) effectStart(effect); }
    else effectEnd(effect, { play: changes.disabled === true });
  });
}

/* -------------------------------------------- */
/*  Engine actions and moves                    */
/* -------------------------------------------- */

export function registerEngineHooks() {
  Hooks.on("alivasTriggers.action", payload => {
    const { action, effect, bearer, context = {}, moves = [] } = payload;
    if ( action?.type === "animate" ) return;          // played by the action itself
    let cue = normalizeCue(action?.animation);
    if ( !cue ) {
      const item = effect?.parent?.documentName === "Item" ? effect.parent : effectItem(effect);
      cue = normalizeCue(presetAction(presetFor(item)?.actions, payload));
    }
    if ( !cue && moves.length ) cue = normalizeCue(setting("moveCues")?.[moves[0].kind === "teleport" ? "teleport" : "push"]);
    if ( !cue ) return;
    playCue(cue, actionContext(payload));
  });
}

/**
 * A preset's cue for an engine action, most specific key first: effect|event|type, effect|type, event|type, type.
 * @param {object} actions   preset.actions
 * @param {object} payload   the alivasTriggers.action payload
 */
export function presetAction(actions, { action, effect, event }={}) {
  if ( !actions || !action?.type ) return null;
  const name = effect?.name ?? "";
  for ( const key of [`${name}|${event}|${action.type}`, `${name}|${action.type}`, `${event}|${action.type}`, action.type] ) {
    if ( actions[key] ) return actions[key];
  }
  return null;
}

/** Play context for an engine action. */
export function actionContext({ effect, bearer, context = {}, moves = [] }) {
  const b = tokenOf(bearer);
  // The creatures concerned: the action's targets, else the other creature involved, else the bearer itself (a burn at
  // the start of its turn, a repeat save) — effects on a creature play on that creature.
  let targets = tokensOf(context.targets?.length ? context.targets : [context.subject].filter(Boolean));
  if ( !targets.length && b ) targets = [b];
  const region = context.region ? regionInfo(context.region) : null;
  // "source": whoever applied the effect (the caster of a smite's burn on its target); the bearer when it's its own.
  const source = tokenOf(effect?.getSourceActor?.()) ?? b;
  return { source, bearer: b, targets, subject: tokenOf(context.subject) ?? targets[0] ?? null, region, moves,
    radius: effect ? areaRadius(effect) : 0, origin: null };
}

/* -------------------------------------------- */
/*  Automated Animations: match guard and hand-off */
/* -------------------------------------------- */

const escapeRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Does a preset label appear as whole words in a name (allowing plural / past endings)? */
export function wholeWordMatch(name, label) {
  const words = String(label ?? "").toLowerCase().replace(/[’']/g, "").split(/[^a-z0-9]+/).filter(Boolean);
  if ( !words.length ) return false;
  const pattern = words.map((w, i) => escapeRx(w) + (i === words.length - 1 ? "(?:s|es|d|ed)?" : "")).join("[^a-z0-9]+");
  return new RegExp(`(^|[^a-z0-9])${pattern}($|[^a-z0-9])`).test(String(name ?? "").toLowerCase().replace(/[’']/g, ""));
}

export function registerAutomatedAnimationsGuard() {
  Hooks.on("AutomatedAnimations-WorkflowStart", (data, animationData) => {
    try {
      const effect = data.activeEffect ? data.item : null;
      // Ours: something here animates it — Automated Animations stays out.
      if ( setting("aaHandOff") && hasOwnCues({ item: effect ? null : data.item, activity: data.activity, effect }) ) {
        data.stopWorkflow = true;
        return;
      }
      if ( !setting("aaGuard") || !animationData || animationData.isCustomized || animationData.advanced?.exactMatch ) return;
      const label = animationData.label;
      if ( !label ) return;
      const names = [...(data.overrideNames ?? []), data.item?.name, ...(data.extraNames ?? []), data.ammoItem?.name,
        data.originalItem?.name].filter(Boolean);
      if ( !names.some(n => wholeWordMatch(n, label)) ) {
        data.stopWorkflow = true;
        if ( setting("debug") ) console.log(`${MODULE_ID} | Automated Animations: "${names.join(" / ")}" matched "${label}" inside a word — skipped`);
      }
    } catch(err) {
      console.error(`${MODULE_ID} | Automated Animations guard`, err);
    }
  });
}
