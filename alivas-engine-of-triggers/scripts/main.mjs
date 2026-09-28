/**
 * Alivas's Engine of Triggers — declarative effect triggers for dnd5e 6.x.
 *
 * An Active Effect carries triggers at `flags.alivas-engine-of-triggers.triggers`:
 *
 * {
 *   label:  "Vengeful Aura",              // shown in chat; defaults to the effect name
 *   event:  "attack" | "spell" | [...],   // what happens to the bearer (see EVENTS below)
 *   filter: FilterDescription,            // optional, dnd5e.Filter format, checked against the event's roll data
 *   action: { type: ..., ... },           // see ACTIONS below
 *   then:   "keep" | "remove" | "removeOnSuccess" | "removeOnFailure"   // default "keep"
 * }
 *
 * Events
 *   attack      bearer made an attack roll                     (dnd5e.rollAttackV2, rolling client)
 *   spell       bearer used a spell or a cast activity         (dnd5e.postUseActivity, using client)
 *   activity    bearer used any activity                       (dnd5e.postUseActivity, using client)
 *   turnStart   bearer's combat turn started                   (Combat#_onStartTurn, designated GM only)
 *   turnEnd     bearer's combat turn ended                     (Combat#_onEndTurn, designated GM only)
 *   damaged     bearer lost HP or temp HP, from any source     (updateActor, updating client)
 *   hit         bearer was hit by an attack roll               (dnd5e.rollAttackV2, attacker's client; filter data
 *                                                               is the ATTACKER's roll data)
 *   save        bearer rolled a saving throw                   (dnd5e.rollSavingThrow, rolling client)
 *   check       bearer rolled an ability, skill or tool check  (dnd5e.rollAbilityCheck / rollSkill / rollToolCheck)
 *   rest        bearer finished a short or long rest           (dnd5e.restCompleted; data: longRest, shortRest)
 *   applied     this effect was just put on the bearer          (createActiveEffect; only this effect's triggers)
 *   initiative  bearer rolled initiative                       (dnd5e.rollInitiative)
 *   moved       bearer's token moved                           (moveToken, moving client)
 *               filter data: moved, movedThisTurn (history since turn start + this move), ownTurn
 *   statusGained  bearer gained statuses                       (create/enable ActiveEffect, acting client)
 *               filter data: gainedStatuses (array) — e.g. { k: "gainedStatuses", o: "has", v: "dodging" }
 *   damaged filter data: amount · save filter data: ability, total · hit filter data: distance (ft), attackType
 *   Formulas in actions can use @spellLevel (the level the effect's spell was cast at).
 *   spell / activity filter data also has activityType ("save", "attack"…) and the activity's targets for selectors
 *   Every event's filter data also has `bearer` (the bearer's roll data), e.g. { k: "bearer.statuses.prone", o: "gte", v: 1 }
 *   roundStart / roundEnd             a combat round starts / ends — every creature in the combat (designated GM)
 *   sourceTurnStart / sourceTurnEnd   the creature that applied the effect starts / ends its turn (designated GM)
 *
 * Triggers only run while their effect is active.
 *
 * Actions
 *   rollActivity { item, activity }   roll a damage activity of the effect's source actor against the bearer;
 *                                     applied automatically or offered as an Apply button (setting)
 *   save { ability, dc, modifiers }   bearer saves vs a number or "source" (DC of the activity that applied the
 *                                     effect). A PC with an active player gets a roll button; others are auto-rolled.
 *                                     modifiers: advantage / disadvantage / bonus formula / DC change, each with an
 *                                     optional filter (see resolveSaveModifiers)
 *   save … damage { formula, type, onSuccess: "none"|"half" }
 *                                     damage on a failed save (half or none on a success); formula uses the source
 *                                     actor's roll data
 *   giveEffect { effect, to }         give an effect (id or name, from the item this effect belongs to / came from) to
 *                                     the creatures a SELECTOR picks — see creatures.mjs (e.g. all allies within 10 ft)
 *   removeStatus { statuses, to, choose }   end conditions on the creatures a SELECTOR picks (choose: one each)
 *   inspire { to }                    give Heroic Inspiration to the creatures a SELECTOR picks
 *   swapInitiative { to }             swap the bearer's initiative with a creature the SELECTOR picks
 *   damage { formula, damageType, to } roll damage against the bearer, or the creatures a SELECTOR picks (e.g. the
 *                                     attacker: { who: "subject" } on "hit")
 *   tempHp { formula, to }            temporary hit points (kept if the creature already has more)
 *   recoverSlots { budget, maxLevel } choose expended spell slots to recover, combined levels ≤ budget (formula);
 *                                     spends a use of the item it's on
 *   toggleLight { bright, dim, color } switch the bearer's token light on/off
 *   note { text }                     chat line only (optional extra text); use with then: "remove" for "ends if X happens"
 *   duplicates { count, threshold }   illusory duplicates (Mirror Image style): roll a d6 per remaining duplicate;
 *                                     any die >= threshold destroys one and that attack's damage is blocked.
 *                                     Remaining count lives on the effect (flag "remaining")
 *   restoreDuplicates { count }       duplicates reappear: remaining goes back to count (only if any were lost)
 *
 * Activity flags (flags.alivas-engine-of-triggers on the activity):
 *   onUse: [action, …]   actions run right after the activity is used, by the user — the same action formats as
 *                        triggers (giveEffect, removeStatus, inspire…); "targets" means the user's targets.
 *                        Example (Lesser Restoration): { type: "removeStatus", statuses: ["blinded", "deafened",
 *                        "paralyzed", "poisoned"], to: { who: "targets" }, choose: true }
 *   chooseEffects: { count }   the user picks which of the activity's effects to apply (count: formula, e.g.
 *                        "min(2, 1 + floor(@item.level / 4))"); an effect flagged minLevel needs that slot level
 *   pay: { cost, from: [identifier, …] }   pay `cost` uses from these items in order (e.g. Metamagic Adept's points
 *                        first, then Sorcery Points); refused if together they can't cover it
 *
 * Effect flag askFirst: "question" — auto-apply asks the user yes/no before applying that effect (conditional riders).
 * Effect flag (not a trigger): `ignoreDamageFrom: ["magic-missile", "Magic Missile"]` — while the effect is active,
 * damage from those items (identifier or name) is not applied.
 *
 * Then
 *   keep | remove | removeOnSuccess | removeOnFailure | removeWhenDepleted
 *
 * Also (settings, independent of triggers)
 *   Auto-apply effects: an activity's effects go on automatically — to targets an attack hits, to targets that fail
 *   a save rolled from the card (plus "applies on save" effects on a success), to the user for self-targeted
 *   activities, and for other utility/healing activities (Mage Armor, Aid, Bless…) to the user's targets, or the
 *   user when nothing is targeted. Uses dnd5e's own effect-application logic, so concentration links and stacking behave as if Apply
 *   had been clicked.
 *
 * Rules key "dc" (extends dnd5e's Rules changes)
 *   An effect change { key: "dc", type: "dnd5e.bonus", value, conditions } adds to the DC of save and check
 *   activities, like the native "attack" key adds to attack rolls. Conditions filter per activity, e.g.
 *   [{"k":"item.school","v":"evo"}] for evocation spells only. Negative values are penalties.
 */

import * as Reactions from "./reactions.mjs";
import * as Creatures from "./creatures.mjs";
import * as Workflow from "./workflow.mjs";
import * as Areas from "./areas.mjs";
import { registerSettingsMenu } from "./settings-app.mjs";
import { TriggerEditor, describeTrigger, describeReaction } from "./editor.mjs";

const MODULE_ID = "alivas-engine-of-triggers";
const SOCKET = `module.${MODULE_ID}`;

/** Attacks whose reactions are still being decided: "actorUuid|activityUuid" → Promise. Damage waits for them. */
const awaitingReaction = new Map();

/* -------------------------------------------- */
/*  Which window made this change?              */
/* -------------------------------------------- */

/*
 * Foundry tells every window which USER made a change, but the same user can be logged in from several windows. To act
 * exactly once, the window that made a change marks it: "pre" hooks run only in that window. Updates are recorded
 * locally; created documents get this window's connection id stamped on them.
 */
const localChanges = new Map();
const LOCAL_MS = 5000;
const markLocal = uuid => localChanges.set(uuid, Date.now());
const isLocal = uuid => (Date.now() - (localChanges.get(uuid) ?? 0)) < LOCAL_MS;
const createdHere = doc => doc?.flags?.[MODULE_ID]?.origin === game.socket.id;

Hooks.on("preUpdateToken", token => markLocal(token.uuid));
Hooks.on("preUpdateActiveEffect", effect => markLocal(effect.uuid));
Hooks.on("preUpdateCombat", combat => markLocal(combat.uuid));
Hooks.on("preCreateChatMessage", message => {
  if ( message._source.rolls?.length ) message.updateSource({ [`flags.${MODULE_ID}.origin`]: game.socket.id });
});
Hooks.on("preCreateActiveEffect", effect => {
  if ( effect._source.statuses?.length ) effect.updateSource({ [`flags.${MODULE_ID}.origin`]: game.socket.id });
});

/** Triggers currently resolving, keyed by effect uuid, so one action can't fire twice. */
const inFlight = new Set();

/** Attacks absorbed by a duplicate: "actorUuid|activityUuid" → timestamp. Their damage is blocked once. */
const absorbed = new Map();
const ABSORB_WINDOW = 5 * 60 * 1000;

const setting = key => game.settings.get(MODULE_ID, key);

/* -------------------------------------------- */
/*  Events                                      */
/* -------------------------------------------- */

Hooks.on("dnd5e.rollAttackV2", async (rolls, { subject }) => {
  fire("attack", subject?.actor, { activity: subject, rolls });

  // Hits: a critical, or not a fumble and total >= current AC.
  const roll = rolls?.[0];
  if ( !roll || !subject ) return;
  // A new attack replaces any earlier "absorbed by a duplicate" mark for this attacker and target.
  for ( const token of game.user.targets ) if ( token.actor ) absorbed.delete(absorbKey(token.actor, subject));
  const hits = Array.from(game.user.targets).filter(token => {
    const ac = token.actor?.system.attributes?.ac?.value;
    return token.actor && Number.isFinite(ac) && (roll.isCritical || (!roll.isFumble && (roll.total >= ac)));
  });
  for ( const token of game.user.targets ) {
    if ( token.actor && !hits.includes(token) ) {
      fire("missed", subject.actor, missContext(subject, rolls, token.actor));
      applyMastery(subject, token.actor, { hit: false, roll });
    }
  }
  const landed = [];
  for ( const token of hits ) {
    const target = token.actor;
    // Reactions first (Shield, Silvery Barbs…): they can turn the hit into a miss. Damage for this attack waits.
    if ( setting("reactions") ) {
      const key = absorbKey(target, subject);
      let release;
      awaitingReaction.set(key, new Promise(r => release = r));
      try {
        const result = await Reactions.attackHit({
          attacker: subject.actor, target, activity: subject, roll, ac: target.system.attributes.ac.value
        });
        if ( !result.hit ) {
          absorbed.set(key, { at: Date.now(), reason: "the attack missed after a reaction" });
          fire("missed", subject.actor, missContext(subject, rolls, target));
          continue;
        }
      } finally {
        awaitingReaction.delete(key);
        release();
      }
    }
    const distance = Creatures.distanceFt(Creatures.tokenFor(subject.actor), Creatures.tokenFor(target));
    await fire("hit", target, { activity: subject, rolls, attacker: subject.actor,
      data: { distance, attackType: subject.attack?.type?.value ?? "" } });
    if ( isAbsorbed(target, subject) ) continue;
    landed.push(target);
    await applyMastery(subject, target, { hit: true, roll });
    if ( setting("autoApplyEffects") && subject.effects?.length ) {
      await autoApply(subject, target, subject.effects, findUsageMessage(subject));
    }
  }
  await Workflow.attackLanded(subject, landed, roll);
});

/**
 * Context for "missed" (fired on the attacker). Filter data: spellLevel (null for non-spells), isSpell, hasDamage,
 * attackType, identifier. The missed creature is the event's target (selector "targets").
 */
function missContext(activity, rolls, target) {
  const item = activity.item;
  const isSpell = item?.type === "spell";
  return { activity, rolls, targets: [target], data: {
    spellLevel: isSpell ? item.system.level : null, isSpell, hasDamage: !!activity.damage?.parts?.length,
    attackType: activity.attack?.type?.value ?? "", identifier: item?.system?.identifier ?? ""
  } };
}

/**
 * Damage rolled by an activity: fired on its actor. Filter data: duplicateDice (two or more dice of one term show the
 * same number), critical, isSpell, spellLevel, identifier, attackType. Targets: the user's current targets.
 */
Hooks.on("dnd5e.rollDamageV2", (rolls, { subject }={}) => {
  const actor = subject?.actor;
  if ( !actor || !rolls?.length ) return;
  const item = subject.item;
  const isSpell = item?.type === "spell";
  const duplicateDice = rolls.some(r => r.dice.some(d => {
    const faces = d.results.filter(x => x.active !== false).map(x => x.result);
    return new Set(faces).size < faces.length;
  }));
  const targets = Array.from(game.user.targets ?? [], tk => tk.actor).filter(Boolean);
  fire("damageRolled", actor, { activity: subject, rolls, targets, subject: targets[0] ?? null, data: {
    duplicateDice, critical: !!rolls[0]?.isCritical, isSpell, spellLevel: isSpell ? item.system.level : null,
    identifier: item?.system?.identifier ?? "", attackType: subject.attack?.type?.value ?? ""
  } });
});

/* -------------------------------------------- */
/*  Attached areas and collisions               */
/* -------------------------------------------- */

/**
 * Effect flag `area: { radius, color }`: while the effect is on a creature, an automated area (an emanation of radius
 * ft) is attached to its token and moves with it; the effect's area triggers run for it (see areas.mjs). Lead GM.
 */
async function syncEffectArea(effect, token) {
  const spec = effect.getFlag(MODULE_ID, "area");
  // Only effects that apply to a creature: on the actor, or transferred from its item (not an item's "applies to
  // targets" effect such as a spell's).
  if ( !(effect.parent instanceof Actor) && !effect.transfer ) return;
  const actor = effect.parent instanceof Actor ? effect.parent : (effect.parent?.actor ?? null);
  token ??= Creatures.tokenFor(actor);
  if ( !spec || !token?.parent || !effect.active ) return;
  const scene = token.parent;
  const attachedTo = r => r.attachment?.token?.id ?? r.attachment?.token;
  if ( scene.regions.some(r => (r.getFlag(MODULE_ID, "area") === effect.uuid) && (attachedTo(r) === token.id)) ) return;
  const radius = (Number(spec.radius) || 5) * scene.grid.size / scene.grid.distance;
  await scene.createEmbeddedDocuments("Region", [{
    name: spec.name ?? effect.name, color: spec.color ?? "#ff7a1a",
    shapes: [{ type: "emanation", radius, base: { type: "token", x: token._source.x, y: token._source.y,
      width: token.width, height: token.height, shape: token._source.shape ?? CONST.TOKEN_SHAPES.RECTANGLE_1 } }],
    attachment: { token: token.id }, visibility: CONST.REGION_VISIBILITY.ALWAYS, highlightMode: "coverage",
    behaviors: [Areas.areaBehaviorData(effect, { level: effect.flags?.dnd5e?.spellLevel ?? null })],
    flags: { [MODULE_ID]: { area: effect.uuid } }
  }]);
}
async function removeEffectAreas(match) {
  for ( const scene of game.scenes ) {
    const ids = scene.regions.filter(r => { const owner = r.getFlag(MODULE_ID, "area"); return owner && match(owner, r); }).map(r => r.id);
    if ( ids.length ) await scene.deleteEmbeddedDocuments("Region", ids);
  }
}
Hooks.on("createActiveEffect", effect => {
  if ( Creatures.isLeadGM() && effect.getFlag(MODULE_ID, "area") ) syncEffectArea(effect);
});
Hooks.on("updateActiveEffect", (effect, changed) => {
  if ( !Creatures.isLeadGM() || !effect.getFlag(MODULE_ID, "area") || !("disabled" in changed) ) return;
  if ( effect.active ) syncEffectArea(effect);
  else removeEffectAreas(owner => owner === effect.uuid);
});
Hooks.on("deleteActiveEffect", effect => {
  if ( Creatures.isLeadGM() && effect.getFlag(MODULE_ID, "area") ) removeEffectAreas(owner => owner === effect.uuid);
});
Hooks.on("createToken", token => {
  if ( !Creatures.isLeadGM() || !token.actor ) return;
  for ( const effect of token.actor.allApplicableEffects() ) {
    if ( effect.active && effect.getFlag(MODULE_ID, "area") ) syncEffectArea(effect, token);
  }
});
Hooks.on("deleteToken", token => {
  if ( Creatures.isLeadGM() ) removeEffectAreas((owner, region) => (region.attachment?.token?.id ?? region.attachment?.token) === token.id);
});

/** An activity that places a template gets an automated area on it (its area triggers, or the save workflow's). */
Hooks.on("dnd5e.createMeasuredTemplate", (activity, regionData) => {
  if ( !Areas.wantsArea(activity) ) return;
  const usage = findUsageMessage(activity)?.id ?? "";
  for ( const data of regionData ) {
    const level = data.flags?.dnd5e?.spellLevel ?? null;
    data.behaviors = [...(data.behaviors ?? []), Areas.areaBehaviorData(activity, { level, usage })];
  }
});

/**
 * Effect flag `stopOnCollision` with a "collided" trigger (Flaming Sphere's ram): when the bearer's token moves into
 * another creature's space and a collided trigger applies (e.g. only on its source's turn), it stops just before that
 * creature, the trigger fires with the creature as its subject, and in combat the token can't move again this turn.
 */
Hooks.on("preMoveToken", (token, movement, operation) => {
  if ( operation?.[MODULE_ID]?.ram ) return;
  const actor = token.actor;
  if ( !actor ) return;
  const effects = Array.from(actor.allApplicableEffects()).filter(e => e.active && e.getFlag(MODULE_ID, "stopOnCollision"));
  if ( !effects.length ) return;
  const combat = combatOf(effects[0].getSourceActor?.() ?? actor, token.parent) ?? combatOf(actor, token.parent);
  const turnKey = combat ? `${combat.id}:${combat.round}:${combat.turn}` : null;
  if ( turnKey && (token.getFlag(MODULE_ID, "stoppedTurn") === turnKey) ) {
    ui.notifications.info(`${token.name} has stopped for this turn.`);
    return false;
  }
  const hit = firstCollision(token, movement) ?? (movement.constrained ? blockedBy(token, movement) : null);
  if ( !hit ) return;
  const applies = effects.some(e => (e.getFlag(MODULE_ID, "triggers") ?? []).some(tr => [tr.event].flat().includes("collided")
    && passesFilter(tr, "collided", { subject: hit.actor, data: {} }, actor, e)));
  if ( !applies ) return;
  (async () => {
    await new Promise(r => setTimeout(r, 50));   // let the rejected move settle first
    try {
      if ( hit.stop && ((hit.stop.x !== token._source.x) || (hit.stop.y !== token._source.y)) ) {
        await token.update({ x: hit.stop.x, y: hit.stop.y }, { [MODULE_ID]: { ram: true } });
      }
    } catch(err) { console.warn(`${MODULE_ID} | stopping ${token.name}`, err); }
    try { if ( turnKey ) await token.setFlag(MODULE_ID, "stoppedTurn", turnKey); } catch(err) { /* not permitted */ }
    await fire("collided", actor, { subject: hit.actor, targets: [hit.actor], data: {} });
  })();
  // Foundry already stopped the move at the creature: let it happen. Otherwise stop it ourselves (above).
  return hit.stop ? false : undefined;
});

/**
 * Foundry cut the move short (creatures block movement): the creature in the next space along the last step, if any.
 * @returns {{actor: Actor5e, stop: null}|null}
 */
function blockedBy(token, movement) {
  const scene = token.parent;
  const size = scene.grid.size;
  const points = [{ x: token._source.x, y: token._source.y }, ...(movement.passed?.waypoints ?? []), ...(movement.pending?.waypoints ?? [])];
  const end = points.at(-1);
  const prev = points.length > 1 ? points.at(-2) : null;
  const target = movement.destination ?? end;
  let dx = Math.sign((prev ? end.x - prev.x : 0)), dy = Math.sign((prev ? end.y - prev.y : 0));
  if ( !dx && !dy ) return null;
  const nx = target.x + (dx * size), ny = target.y + (dy * size);
  const w = token.width * size, h = token.height * size;
  const other = scene.tokens.find(o => (o.id !== token.id) && Areas.isCreature(o.actor) && !o.hidden
    && (nx < o._source.x + (o.width * size) - 2) && (nx + w > o._source.x + 2)
    && (ny < o._source.y + (o.height * size) - 2) && (ny + h > o._source.y + 2));
  return other ? { actor: other.actor, stop: null } : null;
}

/**
 * The first creature whose space the move enters (not those it already overlaps), and the last free top-left
 * position before it.
 * @returns {{actor: Actor5e, stop: {x:number, y:number}}|null}
 */
function firstCollision(token, movement) {
  const scene = token.parent;
  const size = scene.grid.size;
  const w = token.width * size, h = token.height * size;
  const others = scene.tokens.filter(o => (o.id !== token.id) && Areas.isCreature(o.actor) && !o.hidden);
  const overlaps = (x, y, o) => {
    const ow = o.width * size, oh = o.height * size;
    return (x < o._source.x + ow - 2) && (x + w > o._source.x + 2) && (y < o._source.y + oh - 2) && (y + h > o._source.y + 2);
  };
  const start = { x: token._source.x, y: token._source.y };
  const already = new Set(others.filter(o => overlaps(start.x, start.y, o)).map(o => o.id));
  const points = [start, ...(movement.passed?.waypoints ?? []), ...(movement.pending?.waypoints ?? [])].map(p => ({ x: p.x, y: p.y }));
  let last = start;
  for ( let i = 1; i < points.length; i++ ) {
    const a = points[i - 1], b = points[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (size / 4)));
    for ( let s = 1; s <= steps; s++ ) {
      const x = a.x + ((b.x - a.x) * s / steps), y = a.y + ((b.y - a.y) * s / steps);
      const hit = others.find(o => !already.has(o.id) && overlaps(x, y, o));
      if ( hit ) {
        let stop = { x: Math.round(last.x / size) * size, y: Math.round(last.y / size) * size };
        if ( others.some(o => !already.has(o.id) && overlaps(stop.x, stop.y, o)) ) stop = { x: a.x, y: a.y };
        return { actor: hit.actor, stop };
      }
      last = { x, y };
    }
  }
  return null;
}

/**
 * Event "interval": a trigger with `every` (seconds of game time) fires each time that much time has passed since the
 * effect began (Mummy Rot: every 24 hours). Lead GM, on world time changes.
 */
Hooks.on("createActiveEffect", effect => {
  if ( !Creatures.isLeadGM() || effect.getFlag(MODULE_ID, "intervalFrom") !== undefined ) return;
  if ( (effect.getFlag(MODULE_ID, "triggers") ?? []).some(tr => [tr.event].flat().includes("interval")) ) {
    effect.setFlag(MODULE_ID, "intervalFrom", game.time.worldTime);
  }
});
Hooks.on("updateWorldTime", async (worldTime, delta) => {
  if ( !Creatures.isLeadGM() ) return;
  const actors = [...game.actors, ...game.scenes.contents.flatMap(s => s.tokens.filter(tk => !tk.actorLink && tk.actor).map(tk => tk.actor))];
  for ( const actor of actors ) {
    for ( const effect of Array.from(actor.allApplicableEffects()) ) {
      const triggers = (effect.getFlag(MODULE_ID, "triggers") ?? []).filter(tr => [tr.event].flat().includes("interval") && (Number(tr.every) > 0));
      if ( !triggers.length || !effect.active ) continue;
      const start = effect.getFlag(MODULE_ID, "intervalFrom") ?? effect.duration?.startTime ?? (worldTime - (delta ?? 0));
      const every = Math.min(...triggers.map(tr => Number(tr.every)));
      const due = Math.floor((worldTime - start) / every);
      const done = effect.getFlag(MODULE_ID, "intervalsDone") ?? 0;
      for ( let n = done; n < due; n++ ) await fire("interval", actor, { onlyEffect: effect, data: { intervals: n + 1 } });
      if ( due > done ) await effect.setFlag(MODULE_ID, "intervalsDone", due);
    }
  }
});

/**
 * Effect rule `attackedWith: { mode: "advantage"|"disadvantage", once }` (Dodge; Stunning Strike's slowed target):
 * attack rolls against the bearer have that mode; with `once`, the effect ends after the next attack against it.
 */
Hooks.on("dnd5e.preRollAttackV2", config => {
  const attacker = config.subject?.actor;
  const apply = rule => {
    if ( rule?.mode === "advantage" ) config.advantage = true;
    if ( rule?.mode === "disadvantage" ) config.disadvantage = true;
  };
  for ( const token of game.user.targets ?? [] ) {
    for ( const effect of token.actor?.appliedEffects ?? [] ) {
      const rule = effect.getFlag(MODULE_ID, "attackedWith");
      if ( rule && (!rule.by || (rule.by === attacker?.uuid)) ) apply(rule);
    }
  }
  // attacksWith: the bearer's own attacks (Steady Aim, hidden, sapped).
  for ( const effect of attacker?.appliedEffects ?? [] ) apply(effect.getFlag(MODULE_ID, "attacksWith"));
});
Hooks.on("dnd5e.rollAttackV2", (rolls, { subject }={}) => {
  const attacker = subject?.actor;
  for ( const token of game.user.targets ?? [] ) {
    for ( const effect of token.actor?.appliedEffects ?? [] ) {
      const rule = effect.getFlag(MODULE_ID, "attackedWith");
      if ( rule?.once && (!rule.by || (rule.by === attacker?.uuid)) ) deleteEffectAs(effect);
    }
  }
  for ( const effect of attacker?.appliedEffects ?? [] ) if ( effect.getFlag(MODULE_ID, "attacksWith")?.once ) deleteEffectAs(effect);
});

/**
 * Effect rule `healingExtraDie` (Triage Expert's Bedside Manner): the bearer's healing rolls roll one extra die and drop
 * the lowest.
 */
Hooks.on("dnd5e.preRollDamageV2", config => {
  const actor = config.subject?.actor;
  if ( !actor ) return;
  for ( const roll of config.rolls ?? [] ) {
    if ( !(roll.options?.type in CONFIG.DND5E.healingTypes) ) continue;
    // Resolve references first (@scale.monk.die → 1d8) so the die itself can be changed.
    const data = roll.data ?? config.subject?.getRollData?.() ?? actor.getRollData();
    roll.parts = (roll.parts ?? []).map(p => Workflow.healingDieFormula(actor,
      CONFIG.Dice.BasicRoll.replaceFormulaData(String(p), data, { missing: 0 })));
  }
});

/* -------------------------------------------- */
/*  Weapon masteries                            */
/* -------------------------------------------- */

/**
 * The mastery an attack uses, if its attacker can use it: the weapon's mastery when the attacker has chosen that weapon
 * (dnd5e's weapon mastery list), or an activity's own `mastery` flag (e.g. a Psychic Blade's free Vex).
 */
function masteryOf(activity) {
  const own = activity?.flags?.[MODULE_ID]?.mastery;
  if ( own ) return own;
  const item = activity?.item;
  const actor = activity?.actor;
  const id = item?.system?.mastery;
  if ( !id || !actor ) return null;
  const known = actor.system.traits?.weaponProf?.mastery?.value;
  const base = item.system.type?.baseItem;
  return (known?.has?.(base) || known?.includes?.(base)) ? id : null;
}

/** Apply a weapon mastery after an attack (setting wfMastery): hit → vex, sap, slow, topple; miss → graze. */
async function applyMastery(activity, target, { hit, roll }) {
  if ( !setting("wfMastery") ) return;
  const mastery = masteryOf(activity);
  const attacker = activity?.actor;
  if ( !mastery || !attacker || !target ) return;
  const label = `${activity.item.name} (${mastery[0].toUpperCase()}${mastery.slice(1)})`;
  const origin = activity.item.uuid;
  const give = (name, flags, changes=[], expiry="sourceStart") => Creatures.giveEffect({ name: `${name} (${attacker.name})`,
    img: activity.item.img, origin, system: { changes }, duration: { value: 1, units: "rounds", expiry },
    flags: { [MODULE_ID]: flags } }, [target]);
  const note = text => ChatMessage.implementation.create({ speaker: ChatMessage.implementation.getSpeaker({ actor: attacker }),
    content: `<p><strong>${label}</strong>: ${text}</p>` });
  const mod = Number(activity.getRollData?.()?.mod ?? 0);
  if ( hit ) switch ( mastery ) {
    case "vex":
      await give("Vexed", { attackedWith: { mode: "advantage", once: true, by: attacker.uuid } }, [], "sourceEnd");
      return note(`${attacker.name}'s next attack against ${target.name} has Advantage.`);
    case "sap":
      await give("Sapped", { attacksWith: { mode: "disadvantage", once: true } });
      return note(`${target.name}'s next attack has Disadvantage.`);
    case "slow":
      await give("Slowed", {}, [{ key: "system.attributes.movement.walk", type: "add", value: "-10", phase: "initial" }]);
      return note(`${target.name}'s Speed is reduced by 10 feet.`);
    case "topple": {
      const dc = 8 + mod + Number(attacker.system.attributes?.prof ?? 0);
      const { success } = await Workflow.rollSaveOutcome(target, { ability: "con", dc }, label);
      if ( !success ) await Creatures.giveEffect({ name: "Prone", img: CONFIG.statusEffects.find(s => s.id === "prone")?.img, statuses: ["prone"], origin }, [target]);
      return note(`${target.name} ${success ? "keeps its footing" : "is knocked <strong>Prone</strong>"} (Con save DC ${dc}).`);
    }
  }
  if ( !hit && (mastery === "graze") && (mod > 0) ) {
    const type = activity.damage?.parts?.[0]?.types?.first?.() ?? [...(activity.damage?.parts?.[0]?.types ?? [])][0] ?? "";
    await applyDamageAs(target, [{ value: mod, type, properties: [] }], activity, { pipeline: true });
    return note(`the miss still deals ${mod} damage to ${target.name}.`);
  }
}

/** Delete an effect here, or through the lead GM if this user can't. */
function deleteEffectAs(effect) {
  if ( effect.isOwner ) return effect.delete();
  game.socket.emit(SOCKET, { type: "deleteEffect", uuid: effect.uuid });
}

/** An effect with "applied" triggers was just put on a creature (in the window that created it). */
Hooks.on("preCreateActiveEffect", effect => {
  const triggers = effect.getFlag(MODULE_ID, "triggers");
  if ( Array.isArray(triggers) && triggers.some(t => [t.event].flat().includes("applied")) ) {
    effect.updateSource({ [`flags.${MODULE_ID}.origin`]: game.socket.id });
  }
});
Hooks.on("createActiveEffect", effect => {
  if ( !createdHere(effect) || !(effect.parent instanceof Actor) ) return;
  const triggers = effect.getFlag(MODULE_ID, "triggers");
  if ( !Array.isArray(triggers) || !triggers.some(t => [t.event].flat().includes("applied")) ) return;
  fire("applied", effect.parent, { onlyEffect: effect });
});

Hooks.on("dnd5e.restCompleted", (actor, result) => {
  const longRest = !!(result?.longRest ?? result?.type === "long");
  fire("rest", actor, { data: { longRest, shortRest: !longRest } });
});
Hooks.on("dnd5e.rollInitiative", actor => fire("initiative", actor, {}));

/** Activities that pay from several pools in order (flag "pay"). */
function payPools(activity) {
  const pay = activity?.flags?.[MODULE_ID]?.pay;
  const actor = activity?.actor;
  if ( !pay?.cost || !actor ) return null;
  const pools = (pay.from ?? []).map(id => actor.items.find(i => i.system.identifier === id)).filter(i => i?.system.uses?.max);
  return { cost: Number(pay.cost) || 0, pools, available: pools.reduce((s, i) => s + (i.system.uses.value ?? 0), 0) };
}
Hooks.on("dnd5e.preActivityConsumption", activity => {
  const plan = payPools(activity);
  if ( !plan ) return;
  if ( plan.available < plan.cost ) {
    ui.notifications.warn(`${activity.item.name} costs ${plan.cost}, but only ${plan.available} ${plan.available === 1 ? "is" : "are"} left (${plan.pools.map(i => i.name).join(" + ") || "no pool found"}).`);
    return false;
  }
});
Hooks.on("dnd5e.activityConsumption", (activity, usageConfig, messageConfig, updates) => {
  const plan = payPools(activity);
  if ( !plan ) return;
  let left = plan.cost;
  for ( const pool of plan.pools ) {
    if ( left <= 0 ) break;
    const take = Math.min(left, pool.system.uses.value ?? 0);
    if ( !take ) continue;
    left -= take;
    const existing = updates.item.find(x => x._id === pool.id);
    const spent = (existing?.["system.uses.spent"] ?? pool.system.uses.spent ?? 0) + take;
    if ( existing ) existing["system.uses.spent"] = spent;
    else updates.item.push({ _id: pool.id, "system.uses.spent": spent });
  }
});

/** Ability, skill and tool checks: the "check" event, and the d20Succeeded reaction window when the check had a DC. */
for ( const hook of ["dnd5e.rollAbilityCheck", "dnd5e.rollSkill", "dnd5e.rollToolCheck"] ) {
  Hooks.on(hook, (rolls, { ability, skill, tool, subject }) => {
    const roll = rolls?.[0];
    fire("check", subject, { rolls, data: { ability, skill, tool, total: roll?.total } });
    const dc = roll?.options?.target;
    if ( !setting("reactions") || !roll || !Number.isFinite(dc) ) return;
    if ( roll.total < dc ) {
      const proficient = skill ? ((subject.system.skills?.[skill]?.value ?? 0) >= 1) : tool ? ((subject.system.tools?.[tool]?.value ?? 0) >= 1) : false;
      const what = skill ? `${CONFIG.DND5E.skills[skill]?.label ?? skill} check` : tool ? "tool check" : "check";
      Reactions.checkFailed({ actor: subject, roll, dc, label: `${/^[aeiou]/i.test(what) ? "an" : "a"} ${what}`, data: { skill, tool, proficient } });
      return;
    }
    const what = skill ? `${CONFIG.DND5E.skills[skill]?.label ?? skill} check`
      : tool ? "tool check" : `${CONFIG.DND5E.abilities[ability]?.label ?? ""} check`;
    Reactions.saveSucceeded({ actor: subject, roll, dc, kind: "check", label: `${/^[aeiou]/i.test(what) ? "an" : "a"} ${what}` });
  });
}

Hooks.on("dnd5e.rollSavingThrow", (rolls, { ability, subject }) => {
  fire("save", subject, { rolls, ability, data: { ability, total: rolls?.[0]?.total } });
  // A concentration roll is a Con save, but it must not answer a repeat save a trigger is waiting for.
});

/** A failed concentration roll ends concentration, however it was rolled. A success can be contested by reactions. */
Hooks.on("dnd5e.rollConcentrationV2", async (rolls, { subject }) => {
  if ( setting("autoConcentration") === "off" ) return;
  const roll = rolls?.[0];
  const target = roll?.options?.target;
  if ( !roll || !Number.isFinite(target) || !subject?.isOwner ) return;
  let success = roll.isSuccess ?? (roll.total >= target);
  if ( success && setting("reactions") ) {
    success = (await Reactions.saveSucceeded({ actor: subject, roll, dc: target, label: "a Concentration save" })).success;
  }
  if ( success ) return;
  const names = Array.from(subject.concentration?.effects ?? []).map(e => e.name);
  const ended = await subject.endConcentration();
  if ( ended?.length ) await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor: subject }),
    content: `<p>${subject.name} fails the Concentration save (${roll.total} vs DC ${target}) — `
      + `<strong>concentration broken</strong>${names.length ? `: ${names.join(", ")}` : ""}.</p>`
  });
});

/**
 * Bearer's token moved. Foundry clears movement history at the start of each combat turn, so history + this move
 * is the distance moved this turn. Runs on the moving user's client.
 */
Hooks.on("moveToken", (token, movement, operation, user) => {
  if ( (user?.id !== game.userId) || !isLocal(token.uuid) ) return;
  const combat = game.combats.find(c => c.started && c.combatants.some(cb => cb.tokenId === token.id));
  const ownTurn = !!combat && (combat.combatant?.tokenId === token.id);
  const moved = movement.passed?.distance ?? 0;
  const movedThisTurn = (movement.history?.distance ?? 0) + moved;
  fire("moved", token.actor, { data: { moved, movedThisTurn, ownTurn } });
  if ( setting("reactions") ) Reactions.leavesReach(token, movement);
});

/**
 * Bearer gained one or more statuses: an effect carrying statuses was created, or switched back on.
 */
function onStatusEffect(effect, userId) {
  if ( (userId !== game.userId) || effect.disabled || !effect.statuses?.size ) return;
  const actor = (effect.target instanceof Actor) ? effect.target : (effect.parent instanceof Actor ? effect.parent : null);
  fire("statusGained", actor, { data: { gainedStatuses: Array.from(effect.statuses) } });
}
Hooks.on("createActiveEffect", (effect, options, userId) => {
  if ( createdHere(effect) ) onStatusEffect(effect, userId);
});
Hooks.on("updateActiveEffect", (effect, changed, options, userId) => {
  if ( (changed.disabled === false) && isLocal(effect.uuid) ) onStatusEffect(effect, userId);
});

/**
 * Activity flag `summonEffects: [effectId, …]`: after a summon, copies of those effects of the item (non-transfer) go on
 * each summoned creature, from the summoner's item and stamped with the cast level (auras such as Flaming Sphere).
 */
Hooks.on("dnd5e.postSummon", async (activity, profile, tokens) => {
  const ids = activity?.flags?.[MODULE_ID]?.summonEffects;
  if ( !Array.isArray(ids) || !ids.length || !tokens?.length ) return;
  const item = activity.item;
  const real = item.actor?.items.get(item.id) ?? item;
  const level = item.system?.level ?? real.system?.level ?? 0;
  for ( const id of ids ) {
    const source = real.effects.get(id) ?? item.effects?.get(id);
    if ( !source ) continue;
    const data = source.toObject();
    data.origin = real.uuid;
    foundry.utils.setProperty(data, "flags.dnd5e.spellLevel", level);
    const actors = tokens.map(t => t.actor ?? t.document?.actor).filter(Boolean);
    await Creatures.giveEffect(data, actors);
  }
});

/** Stored spells (storeSpell): a Cast activity flagged removeAfterUse goes away once its spell has been cast. */
Hooks.on("dnd5e.postUseActivity", async activity => {
  const cachedFor = activity?.item?.flags?.dnd5e?.cachedFor;
  if ( !cachedFor || !activity.actor?.isOwner ) return;
  const cast = fromUuidSync(cachedFor);
  if ( !cast?.flags?.[MODULE_ID]?.removeAfterUse ) return;
  const holder = cast.item;
  await holder.update({ [`system.activities.-=${cast.id}`]: null });
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor: activity.actor }),
    content: `<p><strong>${holder.name}</strong>: the stored ${activity.item.name} is spent.</p>`
  });
});

Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => {
  if ( activity?.uuid ) repeatChains.delete(activity.uuid);
  const targets = Array.from(game.user.targets ?? [], t => t.actor).filter(Boolean);
  const context = { activity, targets, data: { activityType: activity?.type } };
  runOnUse(activity, targets);
  fire("activity", activity?.actor, context);
  if ( (activity?.item?.type === "spell") || (activity?.type === "cast") ) fire("spell", activity?.actor, context);

  // Activities that aren't attacks or saves (utility, healing…) with effects: self-targeted ones go on the user; others
  // (Mage Armor, Aid, Bless…) go on the creatures the user targeted, or on the user if nothing was targeted.
  if ( setting("autoApplyEffects") && activity?.effects?.length && activity.actor
    && ["utility", "heal"].includes(activity.type) ) {
    const usage = results?.message ?? findUsageMessage(activity);
    const affects = activity.target?.affects?.type;
    let recipients = [];
    if ( isSelfTargeted(activity) ) recipients = [activity.actor];
    else if ( affects !== "enemy" ) recipients = targets.length ? targets : [activity.actor];
    if ( recipients.length ) chooseProfiles(activity, usageConfig).then(profiles => {
      if ( profiles.length ) for ( const actor of recipients ) autoApply(activity, actor, profiles, usage);
    });
  }
});

/** A saving throw rolled from a save activity's card: apply that activity's effects according to the result. */
Hooks.on("createChatMessage", (message, options, userId) => {
  if ( (userId !== game.userId) || !createdHere(message) || !setting("autoApplyEffects") ) return;
  const origin = message.system?.origin;   // dnd5e resolves this to the usage message document
  const usage = (typeof origin === "string") ? game.messages.get(origin) : (origin ?? null);
  const activity = usage?.getAssociatedActivity?.();
  if ( activity?.type !== "save" || !activity.effects?.length ) return;
  const roll = message.rolls?.[0];
  const target = roll?.options?.target;
  const actor = ChatMessage.implementation.getSpeakerActor(message.speaker);
  if ( !roll || !Number.isFinite(target) || !actor ) return;
  (async () => {
    let success = roll.isSuccess ?? (roll.total >= target);
    if ( success && setting("reactions") ) {
      success = (await Reactions.saveSucceeded({ actor, roll, dc: target, label: `a save against ${activity.item.name}` })).success;
    }
    const profiles = activity.effects.filter(p => !success || p.onSave);
    if ( profiles.length ) await autoApply(activity, actor, profiles, usage);
  })();
});

/**
 * Bearer lost hit points (including temporary HP) from any source: chat damage buttons, triggers, or a manual
 * edit on the sheet or token bar. Mirrors dnd5e's own pattern: record before the update, compare after it on the
 * client that made the change.
 */
Hooks.on("preUpdateActor", (actor, changed, options) => {
  markLocal(actor.uuid);
  const hp = foundry.utils.getProperty(changed, "system.attributes.hp");
  if ( !hp || (!("value" in hp) && !("temp" in hp)) ) return;
  const { value, temp } = actor.system.attributes.hp;
  foundry.utils.setProperty(options, `${MODULE_ID}.hp`, { value, temp: temp ?? 0 });
});

Hooks.on("updateActor", (actor, changed, options, userId) => {
  const before = options[MODULE_ID]?.hp;
  if ( !before || (userId !== game.userId) || !isLocal(actor.uuid) ) return;
  const { value, temp } = actor.system.attributes.hp;
  const lost = (before.value + before.temp) - (value + (temp ?? 0));
  if ( lost > 0 ) fire("damaged", actor, { amount: lost, data: { amount: lost } });
});

/**
 * Every damage application passes through here (see setup): wait for any open reaction on the attack that caused it,
 * block damage from an attack that was negated (duplicate took the hit, or a reaction turned it into a miss), then
 * open the damageIncoming reaction window.
 * @returns {Promise<{damages: object[]|number, options: object}|null>}  null = apply nothing
 */
/**
 * Effect flag `saveDamage: { spellLevel: 0, onSave: "half" }` (Potent Cantrip): the bearer's save spells of that level
 * deal that much on a successful save instead of none. Only raises "none"; never lowers a spell's own rule.
 */
function applySaveDamageRule(activity) {
  const item = activity.item;
  const actor = activity.actor;
  if ( (item?.type !== "spell") || !actor?.appliedEffects || !activity.damage?.parts?.length ) return;
  if ( activity.damage.onSave !== "none" ) return;
  for ( const effect of actor.appliedEffects ) {
    const rule = effect.getFlag?.(MODULE_ID, "saveDamage");
    if ( !rule?.onSave ) continue;
    if ( (rule.spellLevel !== undefined) && (rule.spellLevel !== item.system.level) ) continue;
    activity.damage.onSave = rule.onSave;
    return;
  }
}

/**
 * Activity flag `targetFilter` (dnd5e filter on the target's roll data plus damaged / bloodied): with exactly one target,
 * the single activity of the item whose filter it passes.
 */
function activityForTarget(item) {
  const candidates = item.system?.activities?.filter?.(a => a.flags?.[MODULE_ID]?.targetFilter) ?? [];
  if ( !candidates.length || (game.user.targets?.size !== 1) ) return null;
  const target = game.user.targets.first()?.actor;
  const hp = target?.system.attributes?.hp;
  if ( !target ) return null;
  const data = { ...target.getRollData(), damaged: !!hp && (hp.value < hp.max), bloodied: !!hp && (hp.value <= hp.max / 2) };
  const fits = candidates.filter(a => dnd5e.Filter.performCheck(data, a.flags[MODULE_ID].targetFilter));
  return fits.length === 1 ? fits[0] : null;
}

/**
 * Effect flag `dropSave: { ability, dc, unlessTypes, unlessCritical, hp }` (Undead Fortitude): when damage reduces the
 * bearer to 0 HP, it saves (dc: a formula, @damage = the damage taken) and on a success is left at `hp` instead —
 * unless the damage included one of unlessTypes or came from a critical hit.
 */
/** The damage an application dealt after resistances etc. (not capped by the HP left), as dnd5e computes it. */
function damageTaken(actor, damages, options, fallback) {
  try {
    if ( !Array.isArray(damages) ) return Number(damages) || fallback;
    const calc = actor.calculateDamage(foundry.utils.deepClone(damages), { ...options });
    const total = (calc ?? []).reduce((s, d) => s + Math.max(0, Number(d.value) || 0), 0);
    return total || fallback;
  } catch(err) { return fallback; }
}

async function dropSave(actor, damages, options, lost) {
  const effect = actor.appliedEffects?.find(e => e.getFlag(MODULE_ID, "dropSave"));
  const spec = effect?.getFlag(MODULE_ID, "dropSave");
  if ( !spec ) return;
  const types = new Set((Array.isArray(damages) ? damages : []).filter(d => (Number(d.value) || 0) > 0).map(d => d.type));
  if ( (spec.unlessTypes ?? []).some(t => types.has(t)) ) return;
  const message = options.originatingMessage ?? ((options.origin instanceof ChatMessage) ? options.origin : null);
  if ( spec.unlessCritical && message?.rolls?.some(r => r.isCritical || r.options?.isCritical) ) return;
  let dc = 10;
  try {
    dc = Math.floor(new Roll(CONFIG.Dice.BasicRoll.replaceFormulaData(String(spec.dc ?? "5 + @damage"), { ...actor.getRollData(), damage: lost }, { missing: 0 }))
      .evaluateSync({ strict: false }).total);
  } catch(err) { /* keep 10 */ }
  const ability = spec.ability ?? "con";
  const total = await Workflow.rollSaveFor(actor, { ability, dc }, effect.name);
  const saved = (total !== null) && (total >= dc);
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<p><strong>${effect.name}</strong>: ${actor.name} ${saved ? `holds on at ${spec.hp ?? 1} HP` : "falls"} (${CONFIG.DND5E.abilities[ability]?.label} save ${total ?? "—"} vs DC ${dc}).</p>`
  });
  if ( !saved ) return;
  await actor.update({ "system.attributes.hp.value": spec.hp ?? 1 });
  for ( const status of ["dead", "unconscious"] ) if ( actor.statuses?.has(status) ) await actor.toggleStatusEffect(status, { active: false });
}

/** Attack-roll bonuses from the actor's ownRollsOnly effects, by attack type: { msak: ["1"], rsak: ["1"] }. */
function ownRollBonuses(actor) {
  const out = {};
  for ( const effect of actor?.appliedEffects ?? [] ) {
    if ( !effect.getFlag(MODULE_ID, "ownRollsOnly") ) continue;
    for ( const change of effect.system?.changes ?? effect.changes ?? [] ) {
      const m = /^system\.(?:rolls\.attack\.(\w+)\.bonus|bonuses\.(\w+)\.attack)$/.exec(change.key);
      if ( m ) (out[m[1] ?? m[2]] ??= []).push(String(change.value).replace(/^\+/, ""));
    }
  }
  return out;
}

const hpTotal = actor => (actor.system.attributes?.hp?.value ?? 0) + (actor.system.attributes?.hp?.temp ?? 0);

/** The activity a damage application came from: its chat card, or an engine-applied roll that names it. */
function damageSource(options) {
  const uuid = options?.[MODULE_ID]?.activityUuid;
  if ( uuid ) return fromUuidSync(uuid);
  const message = options.originatingMessage ?? ((options.origin instanceof ChatMessage) ? options.origin : null);
  return message?.getAssociatedActivity?.() ?? null;
}

async function beforeDamage(actor, damages, options) {
  // Effect flag noHealing (Mummy Rot's curse): the bearer can't regain hit points.
  const curse = actor.appliedEffects?.find(e => e.getFlag(MODULE_ID, "noHealing"));
  if ( curse && Array.isArray(damages) ) {
    const kept = damages.filter(d => !((d.type in CONFIG.DND5E.healingTypes) || ((Number(d.value) || 0) < 0)));
    if ( kept.length < damages.length ) {
      await ChatMessage.implementation.create({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
        content: `<p><strong>${curse.name}</strong>: ${actor.name} can't regain hit points.</p>` });
      if ( !kept.length ) return null;
      damages = kept;
    }
  }
  const message = options.originatingMessage ?? ((options.origin instanceof ChatMessage) ? options.origin : null);
  const activity = message?.getAssociatedActivity?.();
  // An active effect can ignore damage from particular items (Shield: Magic Missile), matched by identifier or name.
  const sourceItem = activity?.item ?? message?.getAssociatedItem?.();
  if ( sourceItem ) {
    const refs = [sourceItem.system?.identifier, sourceItem.name].filter(Boolean);
    const blocker = actor.appliedEffects?.find(e => (e.getFlag(MODULE_ID, "ignoreDamageFrom") ?? []).some(r => refs.includes(r)));
    if ( blocker ) {
      await ChatMessage.implementation.create({
        speaker: ChatMessage.implementation.getSpeaker({ actor }),
        content: `<p><strong>${blocker.name}</strong>: ${actor.name} takes no damage from ${sourceItem.name}.</p>`
      });
      return null;
    }
  }
  if ( activity ) {
    const key = absorbKey(actor, activity);
    const waiting = awaitingReaction.get(key);
    if ( waiting ) {
      ui.notifications.info(`${actor.name}: waiting for reactions before applying this damage…`);
      await waiting;
    }
    if ( isAbsorbed(actor, activity) ) {
      const reason = absorbed.get(key)?.reason ?? "a duplicate took that hit";
      absorbed.delete(key);
      const amount = Array.isArray(damages) ? damages.reduce((s, d) => s + (Number(d.value) || 0), 0) : damages;
      await ChatMessage.implementation.create({
        speaker: ChatMessage.implementation.getSpeaker({ actor }),
        content: `<p>${reason[0].toUpperCase()}${reason.slice(1)} — <strong>${actor.name} takes no damage</strong> (${amount} blocked).</p>`
      });
      return null;
    }
  }
  const held = activity ? Reactions.consumeDamageMods(actor, activity, damages) : null;
  if ( held ) {
    const before = damages.reduce((s, d) => s + (Number(d.value) || 0), 0);
    damages = held.damages;
    const after = damages.reduce((s, d) => s + (Number(d.value) || 0), 0);
    await ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content: `<p><strong>${held.labels.join(", ")}</strong>: ${actor.name} takes ${after} instead of ${before}.</p>`
    });
  }
  if ( setting("reactions") && Array.isArray(damages) && !options[MODULE_ID]?.reacted ) {
    damages = await Reactions.damageIncoming(actor, damages, { fromAttack: activity?.type === "attack" });
  }
  return { damages, options: { ...options, [MODULE_ID]: { ...(options[MODULE_ID] ?? {}), reacted: true } } };
}

/**
 * Foundry v14 exposes turn changes only through Combat#_onStartTurn / #_onEndTurn, which run on one
 * designated GM client. Extend them so each turn change is handled exactly once.
 */
Hooks.once("setup", () => {
  // Concentration: dnd5e posts a prompt when a concentrating creature takes damage. Roll it straight away instead
  // (setting "autoConcentration"), except for a PC whose player is connected in "auto" mode.
  const actorProto = CONFIG.Actor.documentClass.prototype;
  const challenge = actorProto.challengeConcentration;
  actorProto.challengeConcentration = async function(options={}) {
    // dnd5e calls this in every window of the user who changed HP; only the window that made the change acts.
    if ( !isLocal(this.uuid) ) return null;
    const mode = setting("autoConcentration");
    if ( (mode === "off") || !this.concentration?.effects?.size ) return challenge.call(this, options);
    if ( (mode === "auto") && activePlayerOwner(this) ) return challenge.call(this, options);
    const config = { target: options.dc ?? 10 };
    if ( options.ability in CONFIG.DND5E.abilities ) config.ability = options.ability;
    return this.rollConcentration(config, { configure: false }, {});
  };

  // Several activities with a targetFilter (Toll the Dead): with one target, use the one that fits it — no chooser.
  const itemProto = CONFIG.Item.documentClass.prototype;
  const itemUse = itemProto.use;
  itemProto.use = async function(config={}, dialog={}, message={}) {
    const picked = activityForTarget(this);
    if ( picked ) return picked.use(config, dialog, message);
    return itemUse.call(this, config, dialog, message);
  };

  // Effect rule ownRollsOnly (Keywand of the Stars): the effect's attack-roll bonuses are the bearer's own — a summon
  // matching the summoner's spell attack doesn't get them.
  const summonProto = CONFIG.DND5E.activityTypes.summon?.documentClass?.prototype;
  if ( summonProto?.getChanges ) {
    const getChanges = summonProto.getChanges;
    summonProto.getChanges = async function(actor, profile, options) {
      const excluded = ownRollBonuses(this.actor);
      if ( foundry.utils.isEmpty(excluded) ) return getChanges.call(this, actor, profile, options);
      const base = this.getRollData;
      this.getRollData = (...args) => {
        const data = foundry.utils.deepClone(base.apply(this, args));   // roll data can be shared between calls
        for ( const [type, parts] of Object.entries(excluded) ) {
          const path = `rolls.attack.${type}.bonus`;
          foundry.utils.setProperty(data, path, `${foundry.utils.getProperty(data, path) || 0} - (${parts.join(" + ")})`);
        }
        return data;
      };
      try { return await getChanges.call(this, actor, profile, options); } finally { delete this.getRollData; }
    };
  }

  // Damage: pause for reactions, block negated attacks (see beforeDamage).
  const applyDamage = actorProto.applyDamage;
  actorProto.applyDamage = async function(damages, options={}) {
    const before = hpTotal(this);
    let result;
    if ( options[MODULE_ID]?.reacted ) result = await applyDamage.call(this, damages, options);
    else {
      const next = await beforeDamage(this, damages, options);
      if ( !next ) return this;
      result = await applyDamage.call(this, next.damages, next.options);
    }
    const lost = before - hpTotal(this);
    const activity = damageSource(options);
    if ( (lost > 0) && (this.system.attributes?.hp?.value === 0) ) await dropSave(this, damages, options, damageTaken(this, damages, options, lost));
    if ( (lost > 0) && activity?.actor && (activity.actor !== this) ) {
      const item = activity.item;
      fire("dealt", activity.actor, { activity, targets: [this], data: {
        amount: lost, identifier: item?.system?.identifier ?? "", isSpell: item?.type === "spell",
        spellLevel: item?.type === "spell" ? item.system.level : null
      } });
    }
    return result;
  };

  // Spells: before a spell is cast, creatures that can react to it (Counterspell) get to decide.
  const patchedUse = new Set();
  for ( const config of Object.values(CONFIG.DND5E.activityTypes) ) {
    let proto = config.documentClass?.prototype;
    while ( proto && !Object.hasOwn(proto, "use") ) proto = Object.getPrototypeOf(proto);
    if ( !proto || patchedUse.has(proto) ) continue;
    patchedUse.add(proto);
    const use = proto.use;
    proto.use = async function(usage={}, dialog={}, message={}) {
      if ( setting("reactions") && (this.item?.type === "spell") && !usage?.[MODULE_ID]?.reacted ) {
        if ( await Reactions.spellCast(this) ) return;
      }
      return use.call(this, usage, dialog, message);
    };
  }

  // d20 tests with advantage/disadvantage: before the roll is posted, creatures that can react (Restore Balance)
  // get to decide. Nobody has seen the dice yet.
  const D20 = CONFIG.Dice.D20Roll;
  const buildPost = D20.buildPost;
  D20.buildPost = async function(rolls, config, message) {
    if ( setting("reactions") ) {
      try {
        await Reactions.d20Rolling(rolls, config, message);
      } catch(err) {
        console.error(`${MODULE_ID} | d20Rolling failed`, err);
      }
    }
    return buildPost.call(this, rolls, config, message);
  };

  // Weapon attack abilities: effects may add options (Bladework: INT) or require some (Channeled Attack: STR/DEX).
  // dnd5e then picks the best allowed one, shows it on the sheet, and offers the choice in the roll dialog.
  const attackProto = CONFIG.DND5E.activityTypes.attack?.documentClass?.prototype;
  let owner = attackProto;
  while ( owner && !Object.getOwnPropertyDescriptor(owner, "availableAbilities") ) owner = Object.getPrototypeOf(owner);
  const available = owner && Object.getOwnPropertyDescriptor(owner, "availableAbilities");
  if ( available?.get ) Object.defineProperty(attackProto, "availableAbilities", {
    configurable: true,
    get() { return adjustAttackAbilities(this, available.get.call(this)); }
  });

  // Rules key "dc": save and check DCs pick up matching Rules → Bonus changes (see dcRuleBonus).
  const savePrep = CONFIG.DND5E.activityTypes.save?.documentClass?.prototype;
  if ( savePrep?.prepareFinalData ) {
    const prepare = savePrep.prepareFinalData;
    savePrep.prepareFinalData = function(rollData) {
      rollData ??= this.getRollData({ deterministic: true });
      prepare.call(this, rollData);
      applySaveDamageRule(this);
      const bonus = dcRuleBonus(this, rollData);
      if ( !bonus || !this.save.dc.value ) return;
      this.save.dc.value += bonus;
      const ability = this.save.dc.calculation ? this.ability : null;
      this.labels.save = game.i18n.format("DND5E.SaveDC", {
        dc: this.save.dc.value, ability: CONFIG.DND5E.abilities[ability]?.label ?? ""
      });
    };
  }
  const checkPrep = CONFIG.DND5E.activityTypes.check?.documentClass?.prototype;
  if ( checkPrep?.prepareFinalData ) {
    const prepare = checkPrep.prepareFinalData;
    checkPrep.prepareFinalData = function(rollData) {
      rollData ??= this.getRollData({ deterministic: true });
      prepare.call(this, rollData);
      const bonus = dcRuleBonus(this, rollData);
      if ( bonus && this.check.dc.value ) this.check.dc.value += bonus;
    };
  }

  const proto = CONFIG.Combat.documentClass.prototype;
  const onStart = proto._onStartTurn;
  const onEnd = proto._onEndTurn;
  const onStartRound = proto._onStartRound;
  const onEndRound = proto._onEndRound;
  const onUpdate = proto._onUpdate;
  // Remember who made each combat update: turn workflows run in every window of the designated GM user.
  proto._onUpdate = function(changed, options, userId) {
    this._sbaLastUserId = userId;
    return onUpdate.call(this, changed, options, userId);
  };
  /** Run turn logic in the window that advanced the turn, or (if another user did) in the designated GM's window. */
  const mine = combat => isLocal(combat.uuid) || (combat._sbaLastUserId && (combat._sbaLastUserId !== game.userId));
  proto._onStartTurn = async function(combatant, context) {
    await onStart.call(this, combatant, context);
    if ( !mine(this) ) return;
    await Reactions.resetReaction(combatant);
    await fire("turnStart", combatant?.actor, { combat: this, combatant });
    await fireForCombat(this, "sourceTurnStart", { combatant, sourceActor: combatant?.actor });
  };
  proto._onEndTurn = async function(combatant, context) {
    await onEnd.call(this, combatant, context);
    if ( !mine(this) ) return;
    await fire("turnEnd", combatant?.actor, { combat: this, combatant });
    await fireForCombat(this, "sourceTurnEnd", { combatant, sourceActor: combatant?.actor });
  };
  proto._onStartRound = async function(context) {
    await onStartRound.call(this, context);
    if ( !mine(this) ) return;
    await fireForCombat(this, "roundStart", { round: context?.round });
  };
  proto._onEndRound = async function(context) {
    await onEndRound.call(this, context);
    if ( !mine(this) ) return;
    await fireForCombat(this, "roundEnd", { round: context?.round });
  };
});

/**
 * Effect flags that change which abilities a weapon attack may use (only attacks without a fixed ability):
 *   attackAbilities: { add: ["int"], proficient: true }   also allow these (Bladework: INT with proficient weapons)
 *   attackAbilitiesOnly: ["str", "dex"]                  only these (Channeled Attack needs a STR/DEX attack)
 * @param {Activity} activity
 * @param {Set<string>} base  dnd5e's own options (STR, DEX, or both for Finesse)
 * @returns {Set<string>}
 */
function adjustAttackAbilities(activity, base) {
  const actor = activity.actor;
  if ( !actor || (activity.attack?.type?.classification !== "weapon") || (activity.item?.type !== "weapon") ) return base;
  const effects = actor.appliedEffects ?? [];
  if ( !effects.some(e => e.flags?.[MODULE_ID]?.attackAbilities || e.flags?.[MODULE_ID]?.attackAbilitiesOnly) ) return base;
  const proficient = (activity.item.system.prof?.multiplier ?? (activity.item.system.proficient ? 1 : 0)) >= 1;
  const set = new Set(base);
  for ( const e of effects ) {
    const opt = e.flags?.[MODULE_ID]?.attackAbilities;
    if ( !opt || (opt.proficient && !proficient) ) continue;
    for ( const a of opt.add ?? [] ) set.add(a);
  }
  for ( const e of effects ) {
    const only = e.flags?.[MODULE_ID]?.attackAbilitiesOnly;
    if ( !Array.isArray(only) ) continue;
    const kept = [...set].filter(a => only.includes(a));
    set.clear();
    for ( const a of (kept.length ? kept : [...base].filter(a => only.includes(a))) ) set.add(a);
    if ( !set.size ) for ( const a of base ) set.add(a);
  }
  return set;
}

/**
 * Total of the actor's and item's Rules → Bonus changes with key "dc" whose conditions pass for this activity.
 * Conditions see the activity's roll data, so `item.school`, `item.level`, `activity.type` etc. work as filters.
 * @param {Activity} activity
 * @param {object} rollData
 * @returns {number}
 */
function dcRuleBonus(activity, rollData) {
  const rules = [
    ...(activity.actor?.appliedRules?.get("dc:bonus") ?? []),
    ...(activity.item?.appliedRules?.get("dc:bonus") ?? [])
  ];
  let total = 0;
  for ( const rule of rules ) {
    const data = rule.effect?.getRuleConditionData?.(rollData) ?? rollData;
    if ( rule.effect?.system?.conditions?.check?.(data) === false ) continue;
    if ( rule.conditions?.check?.(data) === false ) continue;
    total += dnd5e.utils.simplifyBonus(rule.value, rollData);
  }
  return total;
}

/**
 * Fire an event on every creature in a combat (each actor once).
 */
async function fireForCombat(combat, event, context={}) {
  const seen = new Set();
  for ( const combatant of combat.combatants ) {
    const actor = combatant.actor;
    if ( !actor || seen.has(actor.uuid) ) continue;
    seen.add(actor.uuid);
    await fire(event, actor, { combat, ...context });
  }
}

/* -------------------------------------------- */
/*  Engine                                      */
/* -------------------------------------------- */

/**
 * Run every matching trigger on the bearer's active effects.
 * @param {string} event
 * @param {Actor5e} bearer
 * @param {object} context
 */
async function fire(event, bearer, context) {
  if ( !bearer?.isOwner ) return;
  for ( const effect of Array.from(bearer.allApplicableEffects()) ) {
    if ( !effect.active ) continue;
    if ( context?.onlyEffect && (effect !== context.onlyEffect) ) continue;
    const triggers = effect.getFlag(MODULE_ID, "triggers");
    if ( !Array.isArray(triggers) ) continue;
    // Source-turn events only concern effects that creature applied.
    if ( context?.sourceActor && (effect.getSourceActor?.()?.uuid !== context.sourceActor.uuid) ) continue;
    await runTriggerList(triggers, effect, bearer, event, context);
  }
}

/**
 * Run the triggers of one owner (an effect, or an area's stand-in) for an event: filter, action, then "remove".
 * @param {object} [options]
 * @param {string} [options.key]         In-flight guard key (default: the effect) — one run at a time per key.
 * @param {Function} [options.onRemove]  What "remove" does (default: delete the effect).
 * @returns {Promise<boolean>} whether the owner was removed
 */
/** Yes/no on a creature's controller's client. */
async function confirmFor(actor, title, question) {
  const user = Creatures.controllerOf(actor);
  if ( !user ) return false;
  const payload = { title: `${title} — ${actor.name}`, prompt: `<p>${question}</p>`,
    options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] };
  const answer = user.id === game.user.id ? await Creatures.HANDLERS.pickOption(payload) : await Creatures.runAs(user, "pickOption", payload);
  return answer === "yes";
}

async function runTriggerList(triggers, effect, bearer, event, context={}, { key, onRemove }={}) {
  key ??= effect.uuid;
  for ( const trigger of triggers ) {
    const events = Array.isArray(trigger.event) ? trigger.event : [trigger.event];
    if ( !events.includes(event) ) continue;
    if ( !passesFilter(trigger, event, context, bearer, effect) ) continue;
    // needsUses: the effect's item must have a use left (Uncanny Metabolism, once per Long Rest).
    const item = effect.parent?.documentName === "Item" ? effect.parent : null;
    if ( trigger.needsUses && item?.system.uses?.max && !(item.system.uses.value > 0) ) continue;
    if ( inFlight.has(key) ) continue;
    inFlight.add(key);
    let removed = false;
    try {
      // ask: the bearer's controller confirms first ("Use Uncanny Metabolism?").
      if ( trigger.ask && !(await confirmFor(bearer, trigger.label ?? effect.name, trigger.ask)) ) continue;
      const result = await runAction(trigger, effect, bearer, event, context) ?? {};
      if ( resolveThen(trigger.then, result) === "remove" ) {
        await (onRemove ? onRemove() : effect.delete());
        removed = true;
      }
    } catch(err) {
      console.error(`${MODULE_ID} | Trigger "${trigger.label ?? effect.name}" failed`, err);
      ui.notifications.error(`${MODULE_ID}: trigger "${trigger.label ?? effect.name}" failed — see console.`);
    } finally {
      inFlight.delete(key);
    }
    if ( removed ) return true;
  }
  return false;
}

/**
 * Decide what happens to the effect after its action.
 * @param {string} [then]
 * @param {{success?: boolean, depleted?: boolean}} result
 * @returns {"remove"|null}
 */
function resolveThen(then, result) {
  switch ( then ) {
    case "remove": return "remove";
    case "removeOnSuccess": return result.success === true ? "remove" : null;
    case "removeOnFailure": return result.success === false ? "remove" : null;
    case "removeWhenDepleted": return result.depleted ? "remove" : null;
    default: return null;
  }
}

/**
 * Check a trigger's optional filter against the event's roll data.
 * @returns {boolean}
 */
/** The creature that summoned this one (dnd5e records the summoning item), if any. */
function summonerOf(actor) {
  const origin = actor?.flags?.dnd5e?.summon?.origin;
  return origin ? (fromUuidSync(origin)?.actor ?? null) : null;
}

/** The running combat this creature takes part in (by actor or token), if any. */
function combatOf(actor, scene) {
  if ( !actor ) return null;
  const tokenId = actor.token?.id;
  const found = game.combats.filter(c => c.started && c.combatants.some(cb => (cb.actor?.uuid === actor.uuid)
    || (tokenId && (cb.tokenId === tokenId)) || (!actor.isToken && (cb.actorId === actor.id))));
  scene ??= Creatures.tokenFor(actor)?.parent ?? canvas?.scene;
  return found.find(c => c.scene && (c.scene === scene)) ?? found.find(c => !c.scene) ?? found[0] ?? null;
}

function passesFilter(trigger, event, context, bearer, effect) {
  if ( !trigger.filter || foundry.utils.isEmpty(trigger.filter) ) return true;
  const source = effect?.getSourceActor?.() ?? null;
  const combat = combatOf(source ?? bearer);
  const data = {
    ...(context.activity?.getRollData?.() ?? {}), ...(context.data ?? {}), event, bearer: bearer?.getRollData?.() ?? {},
    sourceTurn: !combat || (!!source && (combat.combatant?.actor?.uuid === source.uuid)),
    subjectIsSource: !!context.subject && !!source && (context.subject.uuid === source.uuid),
    subjectIsSummoner: !!context.subject && (summonerOf(bearer)?.uuid === context.subject.uuid)
  };
  return dnd5e.Filter.performCheck(data, trigger.filter);
}

/* -------------------------------------------- */
/*  Auto-apply effects                          */
/* -------------------------------------------- */

/**
 * Does an activity affect only its user? Either its target is "self", or its range is "self" with no target type and
 * no area template (a cone "from self" is not self-targeted).
 * @param {Activity} activity
 * @returns {boolean}
 */
function isSelfTargeted(activity) {
  const affects = activity.target?.affects?.type;
  if ( affects === "self" ) return true;
  return !affects && (activity.range?.units === "self") && !activity.target?.template?.type;
}

/**
 * The most recent usage card for an activity.
 * @param {Activity} activity
 * @returns {ChatMessage5e|null}
 */
function findUsageMessage(activity) {
  const messages = game.messages.contents;
  for ( let i = messages.length - 1, n = 0; (i >= 0) && (n < 50); i--, n++ ) {
    const m = messages[i];
    if ( (m.type === "usage") && (m.getAssociatedActivity?.()?.uuid === activity.uuid) ) return m;
  }
  return null;
}

/**
 * Apply an activity's effect profiles to an actor, the way the chat card's Apply button does. If this user can't
 * modify the actor (a player hitting a monster), the active GM does it.
 * @param {Activity} activity
 * @param {Actor5e} actor
 * @param {object[]} profiles        Activity effect profiles ({ _id, onSave, ... }).
 * @param {ChatMessage5e} [usage]    The activity's usage card.
 */
/**
 * The effects of an activity to apply: all of them, or — with activity flag chooseEffects — the ones the user picks
 * (only those whose flag minLevel the cast level meets).
 */
async function chooseProfiles(activity, usageConfig={}) {
  const spec = activity.flags?.[MODULE_ID]?.chooseEffects;
  const profiles = activity.effects ?? [];
  if ( !spec ) return profiles;
  // The level it was cast at: the slot used, else the base level plus any scaling.
  const level = activity.actor?.system.spells?.[usageConfig.spell?.slot]?.level
    ?? ((activity.item?.system?.level ?? 0) + (Number(usageConfig.scaling) || 0));
  const allowed = profiles.filter(p => (p.effect?.getFlag(MODULE_ID, "minLevel") ?? 0) <= level);
  if ( allowed.length <= 1 ) return allowed;
  const data = { ...(activity.getRollData?.() ?? {}) };
  data.item = { ...(data.item ?? {}), level };
  let count = 1;
  try {
    count = Math.max(1, Math.floor(new Roll(CONFIG.Dice.BasicRoll.replaceFormulaData(String(spec.count ?? 1), data, { missing: 0 }))
      .evaluateSync({ strict: false }).total) || 1);
  } catch(err) { /* keep 1 */ }
  const picked = await Creatures.HANDLERS.pickMany({
    title: `${activity.item.name} — choose`, count,
    prompt: `<p>Which benefit${count > 1 ? "s" : ""} of <strong>${activity.item.name}</strong> (level ${level})?</p>`,
    options: allowed.map(p => ({ value: p._id, label: p.effect?.name ?? p._id }))
  });
  return allowed.filter(p => picked.includes(p._id));
}

async function autoApply(activity, actor, profiles, usage) {
  if ( !usage ) return;
  // Effect flag onlyIf: a filter on the target's data (e.g. [{k: "statuses.poisoned", o: "gt", v: 0}]).
  profiles = profiles.filter(p => {
    const only = p.effect?.getFlag?.(MODULE_ID, "onlyIf");
    return !only?.length || dnd5e.Filter.performCheck(actor.getRollData(), only);
  });
  // Conditional riders: ask before applying an effect flagged askFirst.
  const kept = [];
  for ( const p of profiles ) {
    const question = p.effect?.getFlag?.(MODULE_ID, "askFirst");
    if ( !question ) { kept.push(p); continue; }
    const yes = await foundry.applications.api.DialogV2.confirm({
      window: { title: `${p.effect.name} — ${actor.name}` }, content: `<p>${question}</p>`, rejectClose: false
    });
    if ( yes ) kept.push(p);
  }
  profiles = kept;
  if ( !profiles.length ) return;
  const ids = profiles.map(p => p._id);
  if ( !actor.isOwner ) {
    if ( !game.users.activeGM ) return ui.notifications.warn(`${MODULE_ID}: no GM connected to apply effects to ${actor.name}.`);
    game.socket.emit(SOCKET, { type: "applyEffects", usageId: usage.id, actorUuid: actor.uuid, effectIds: ids });
    return;
  }
  return applyEffects(usage, actor, ids);
}

async function applyEffects(usage, actor, effectIds) {
  const activity = usage.getAssociatedActivity?.();
  const item = activity?.item;
  if ( !item ) return;
  const prepare = dnd5e.applications.components.EffectApplicationElement.prototype._prepareEffectData;
  for ( const id of effectIds ) {
    const effect = item.effects.get(id);
    if ( !effect ) continue;
    try {
      const { action, data } = await prepare.call({ chatMessage: usage }, effect, actor);
      if ( action === "create" ) await actor.createEmbeddedDocuments("ActiveEffect", [data]);
      else await actor.updateEmbeddedDocuments("ActiveEffect", [data]);
    } catch(err) {
      console.error(`${MODULE_ID} | Could not apply ${effect.name} to ${actor.name}`, err);
    }
  }
}

/**
 * Apply damage the engine rolled, on this client or (for a creature it can't modify) the lead GM's. Skips the reaction
 * pause; still counts as the activity's damage for "dealt".
 * @param {object[]} damages  { value, type, properties: string[] }
 */
async function applyDamageAs(actor, damages, activity, { messageId, pipeline=false }={}) {
  if ( !actor.isOwner ) {
    game.socket.emit(SOCKET, { type: "applyDamage", actorUuid: actor.uuid, damages, activityUuid: activity?.uuid, messageId, pipeline });
    return;
  }
  await actor.applyDamage(damages.map(d => ({ ...d, properties: new Set(d.properties) })), damageOptions(activity?.uuid, messageId, pipeline));
}

/**
 * applyDamage options: from a damage card (or pipeline), the whole pipeline runs (reactions, damage rules, "dealt");
 * otherwise (a missed cantrip's half damage) the reaction pause and "negated attack" check are skipped.
 */
function damageOptions(activityUuid, messageId, pipeline=false) {
  const message = messageId ? game.messages.get(messageId) : null;
  if ( message ) return { isDelta: true, originatingMessage: message };
  if ( pipeline ) return { isDelta: true };
  return { isDelta: true, [MODULE_ID]: { reacted: true, activityUuid } };
}

Hooks.once("ready", () => {
  game.socket.on(SOCKET, async data => {
    if ( (data?.type === "updateItem") && Creatures.isLeadGM() ) {
      await fromUuidSync(data.uuid)?.update(data.update);
      return;
    }
    if ( (data?.type === "deleteEffect") && Creatures.isLeadGM() ) {
      await fromUuidSync(data.uuid)?.delete();
      return;
    }
    if ( (data?.type === "applyDamage") && Creatures.isLeadGM() ) {
      const actor = fromUuidSync(data.actorUuid);
      if ( actor ) await actor.applyDamage(data.damages.map(d => ({ ...d, properties: new Set(d.properties) })),
        damageOptions(data.activityUuid, data.messageId, data.pipeline));
      return;
    }
    if ( (data?.type !== "applyEffects") || !Creatures.isLeadGM() ) return;
    const usage = game.messages.get(data.usageId);
    const actor = fromUuidSync(data.actorUuid);
    if ( usage && actor ) await applyEffects(usage, actor, data.effectIds);
  });
});

/* -------------------------------------------- */
/*  Duplicates bookkeeping                      */
/* -------------------------------------------- */

const absorbKey = (actor, activity) => `${actor.uuid}|${activity.uuid}`;

function isAbsorbed(actor, activity) {
  const key = absorbKey(actor, activity);
  const entry = absorbed.get(key);
  const at = (typeof entry === "object") ? entry?.at : entry;
  if ( !at ) return false;
  if ( Date.now() - at > ABSORB_WINDOW ) {
    absorbed.delete(key);
    return false;
  }
  return true;
}

/* -------------------------------------------- */
/*  Players                                     */
/* -------------------------------------------- */

/**
 * An active, non-GM user who owns this actor, if any.
 * @param {Actor5e} actor
 * @returns {User|undefined}
 */
function activePlayerOwner(actor) {
  return game.users.find(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
}

/* -------------------------------------------- */
/*  Actions                                     */
/* -------------------------------------------- */

const EVENT_TEXT = {
  attack: "made an attack", spell: "cast a spell", activity: "acted",
  turnStart: "starts its turn", turnEnd: "ends its turn", damaged: "takes damage",
  roundStart: "— a new round begins", roundEnd: "— the round ends",
  sourceTurnStart: "— its source starts its turn", sourceTurnEnd: "— its source ends its turn",
  hit: "is hit by an attack", save: "makes a saving throw", check: "makes an ability check",
  rest: "finishes a rest", initiative: "rolls initiative", onUse: "uses it", collided: "moves into a creature's space", damageRolled: "rolls damage",
  areaCreated: "— its area appears", areaEnter: "— a creature enters its area", areaLeave: "— a creature leaves its area",
  areaTurnStart: "— a creature starts its turn in its area", areaTurnEnd: "— a creature ends its turn in its area",
  interval: "— time passes", missed: "misses with an attack", dealt: "deals damage", applied: "gains it", moved: "moves", statusGained: "gains a condition"
};

/**
 * Post a one-line chat note for a trigger firing.
 */
function announce(trigger, effect, bearer, event, detail="") {
  const label = trigger.label ?? effect.name;
  return ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor: bearer }),
    content: event === "onUse" ? `<p><strong>${label}</strong>: ${detail}</p>`
      : `<p><strong>${label}</strong> triggers: ${bearer.name} ${EVENT_TEXT[event] ?? event}.${detail ? ` ${detail}` : ""}</p>`
  });
}

/**
 * Resolve the activity that applied an effect, if its origin points at one.
 * @param {ActiveEffect5e} effect
 * @returns {Promise<Activity|null>}
 */
async function originActivity(effect) {
  if ( !effect.origin ) return null;
  const doc = await fromUuid(effect.origin);
  if ( doc?.system?.activities ) return doc.system.activities.find(a => a.save?.dc?.value) ?? null;
  return doc ?? null;
}

/**
 * Target descriptors for the bearer, so damage cards list the right creature.
 */
function bearerTargets(bearer) {
  const token = bearer.token?.object ?? bearer.getActiveTokens?.()[0];
  const TargetsField = dnd5e.dataModels.chatMessage.fields.TargetsField;
  return token ? TargetsField.getDescriptors([token]) : [];
}

/**
 * Roll damage from a formula against the bearer. The formula uses the effect's source actor's roll data (falling back
 * to the bearer's). Posts a dnd5e damage card targeting the bearer; applies it unless "Trigger damage" is "button".
 * @param {ActiveEffect5e} effect
 * @param {Actor5e} bearer
 * @param {{formula: string, type: string}} spec
 * @param {object} options
 * @param {string} options.flavor
 * @param {boolean} [options.half]  Apply half (rounded down), e.g. on a successful save.
 */
async function dealDamage(effect, bearer, spec, { flavor, half=false }={}) {
  if ( !spec?.formula ) return;
  const source = effect.getSourceActor?.();
  const type = spec.type ?? "";
  const rollData = { ...(source?.getRollData?.() ?? bearer.getRollData()), spellLevel: effect.flags?.dnd5e?.spellLevel ?? 0 };
  const formula = CONFIG.Dice.BasicRoll.replaceFormulaData(String(spec.formula), rollData, { missing: 0 })
    .replace(/\(([\d\s+\-*/.]+)\)d/g, (m, expr) => { try { return `${Math.floor(Roll.safeEval(expr))}d`; } catch(err) { return m; } });
  const roll = new CONFIG.Dice.DamageRoll(formula, rollData, {
    type, properties: []
  });
  await roll.evaluate();
  const typeLabel = CONFIG.DND5E.damageTypes[type]?.label ?? CONFIG.DND5E.healingTypes[type]?.label ?? "";
  await ChatMessage.implementation.create({
    type: "damage", rolls: [roll],
    speaker: ChatMessage.implementation.getSpeaker({ actor: source ?? bearer }),
    flavor: `${flavor} — ${typeLabel ? `${typeLabel} ` : ""}damage to ${bearer.name}${half ? " (half)" : ""}`,
    system: { targets: bearerTargets(bearer) }
  });
  if ( setting("triggerDamage") !== "auto" ) return;
  const value = Math.max(0, half ? Math.floor(roll.total / 2) : roll.total);
  const sign = 1;   // dnd5e treats healing types as healing itself (positive values)
  await applyDamageAs(bearer, [{ value: value * sign, type, properties: [] }], null, { pipeline: true });
}

/**
 * Damage attached to a save: full on a failure; half or none on a success.
 * @param {{formula, type, onSuccess: "none"|"half"}} spec
 */
function saveDamage(effect, bearer, spec, success, label) {
  if ( !spec?.formula ) return;
  if ( spec.evasion ) {                      // Evasion: none on a success, half on a failure
    if ( success ) return;
    return dealDamage(effect, bearer, spec, { flavor: `${label} (Evasion)`, half: true });
  }
  if ( success && (spec.onSuccess !== "half") ) return;
  return dealDamage(effect, bearer, spec, { flavor: label, half: success });
}

/** Chat line for a save result, saying whether the effect ends. */
function saveResultText(actor, label, success, ends, detail="") {
  return `<p>${actor.name} ${success ? "succeeds" : "fails"}${detail}${ends ? ` — <strong>${label}</strong> ends` : ""}.</p>`;
}

/** What a trigger's selector can refer to. */
function selectorContext(effect, bearer, context={}, trigger={}) {
  const label = trigger.label ?? effect?.name ?? "";
  return {
    bearer, source: effect?.getSourceActor?.() ?? null, subject: context.subject ?? context.attacker ?? null,
    targets: context.targets ?? [], title: label ? `${label} — choose` : undefined
  };
}

/**
 * Run an activity's onUse actions (activity flag "onUse"), on the client that used it. The actions get a stand-in
 * "effect" so the shared action code (labels, item lookups) works: the activity's item.
 */
async function runOnUse(activity, targets) {
  const list = activity?.flags?.[MODULE_ID]?.onUse;
  const actor = activity?.actor;
  if ( !Array.isArray(list) || !list.length || !actor?.isOwner ) return;
  const item = actor.items.get(activity.item.id) ?? activity.item;
  const standIn = {
    name: item.name, parent: item, origin: item.uuid, uuid: `${activity.uuid}.onUse`,
    getSourceActor: () => actor, getFlag: () => undefined,
    flags: { dnd5e: { spellLevel: activity.item?.system?.level ?? 0 } }
  };
  for ( const action of list ) {
    const handler = ACTIONS[action?.type];
    if ( !handler ) continue;
    try {
      await handler({ label: item.name, action }, standIn, actor, "onUse", { activity, targets });
    } catch(err) {
      console.error(`${MODULE_ID} | onUse action "${action.type}" of ${item.name} failed`, err);
    }
  }
}

/** The school of a specialist wizard (subclass identifier → school id), or null. */
const SPECIALIST_SCHOOLS = { abjurer: "abj", conjurer: "con", diviner: "div", enchanter: "enc", evoker: "evo",
  illusionist: "ill", necromancer: "nec", transmuter: "trs" };
function specialistSchool(actor) {
  const sub = actor.items.find(i => (i.type === "subclass") && (i.system.classIdentifier === "wizard"));
  return SPECIALIST_SCHOOLS[sub?.system.identifier] ?? null;
}

/** Repeat chains per activity (repeatActivity): { used, at }. Reset when the activity is used again. */
const repeatChains = new Map();

const ACTIONS = {
  /**
   * Illusory duplicates. Roll a d6 per remaining duplicate; if any die meets the threshold, one duplicate takes the
   * hit and is destroyed, and that attack's damage against the bearer is blocked.
   */
  async duplicates(trigger, effect, bearer, event, context={}) {
    const count = trigger.action.count ?? 1;
    const threshold = trigger.action.threshold ?? 3;
    const remaining = effect.getFlag(MODULE_ID, "remaining") ?? count;
    if ( remaining <= 0 ) return {};
    const label = trigger.label ?? effect.name;
    const speaker = ChatMessage.implementation.getSpeaker({ actor: bearer });

    const roll = await new Roll(`${remaining}d6`).evaluate();
    await roll.toMessage({
      speaker, flavor: `${label}: ${bearer.name} is hit — ${remaining} duplicate${remaining > 1 ? "s" : ""}, `
        + `${threshold}+ on any die and a duplicate is hit instead`
    });
    const hitDuplicate = roll.dice[0].results.some(r => r.result >= threshold);
    const left = hitDuplicate ? remaining - 1 : remaining;
    if ( hitDuplicate && context.activity ) absorbed.set(absorbKey(bearer, context.activity), { at: Date.now(), reason: "a duplicate took that hit" });
    const text = hitDuplicate
      ? `A duplicate is hit and destroyed — <strong>${bearer.name} takes no damage or effects from this attack</strong> `
        + `(its damage will be blocked). ` + (left ? `${left} duplicate${left > 1 ? "s" : ""} left.` : `No duplicates left.`)
      : `The attack hits ${bearer.name}.`;
    await ChatMessage.implementation.create({ speaker, content: `<p><strong>${label}</strong>: ${text}</p>` });
    const depleted = hitDuplicate && !left;
    if ( hitDuplicate && (trigger.then !== "removeWhenDepleted" || left) ) await effect.update({
      [`flags.${MODULE_ID}.remaining`]: left,
      name: depleted ? `${label} (no duplicates)` : label
    });
    return { success: hitDuplicate, depleted };
  },

  /**
   * Duplicates reappear: restore the remaining count to the full count, if any were lost.
   */
  async restoreDuplicates(trigger, effect, bearer, event) {
    const count = trigger.action.count ?? 1;
    const remaining = effect.getFlag(MODULE_ID, "remaining") ?? count;
    if ( remaining >= count ) return {};
    const label = trigger.label ?? effect.name;
    await effect.update({ [`flags.${MODULE_ID}.remaining`]: count, name: label });
    await ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor: bearer }),
      content: `<p><strong>${label}</strong>: ${bearer.name} ${trigger.reason ?? EVENT_TEXT[event] ?? event} — the duplicate${count > 1 ? "s" : ""} reappear${count > 1 ? "" : "s"}.</p>`
    });
    return { success: true };
  },

  /**
   * Give an effect to creatures picked by a SELECTOR (creatures.mjs): { effect, to }. The effect (id or name) is
   * looked up on the item this trigger's effect belongs to or came from. "choose" asks the bearer's controller.
   */
  async giveEffect(trigger, effect, bearer, event, context={}) {
    const { effect: ref, to = { who: "bearer" } } = trigger.action;
    const parentItem = effect.parent?.documentName === "Item" ? effect.parent : null;
    // dnd5e records the ACTIVITY that applied an effect as its origin; its item holds the effects.
    const originDoc = effect.origin ? await fromUuid(effect.origin).catch(() => null) : null;
    const originItem = originDoc?.documentName === "Item" ? originDoc : (originDoc?.item ?? null);
    const items = [parentItem, originItem].filter(Boolean);
    const give = items.map(i => i.effects.get(ref) ?? i.effects.getName(ref)).find(Boolean)
      ?? bearer.effects.getName(ref);
    if ( !give ) throw new Error(`No effect "${ref}" on ${items.map(i => i.name).join(" / ") || "the effect's item"}`);
    const label = trigger.label ?? effect.name;
    const recipients = await Creatures.selectCreatures(bearer, to, {
      ...selectorContext(effect, bearer, context, trigger),
      title: `${label} — choose a creature`, prompt: `<p>Who gets <strong>${give.name}</strong>? (${Creatures.describeSelector(to, { you: bearer.name })})</p>`
    });
    if ( !recipients.length ) return {};
    const data = give.toObject();
    data.origin ??= (originItem ?? parentItem)?.uuid ?? effect.origin;
    await Creatures.giveEffect(data, recipients);
    await announce(trigger, effect, bearer, event, `${recipients.map(a => a.name).join(", ")} ${recipients.length > 1 ? "get" : "gets"} <strong>${give.name}</strong>.`);
    return {};
  },

  /** End conditions: { statuses, to, choose }. */
  async removeStatus(trigger, effect, bearer, event, context={}) {
    const { statuses = [], to = { who: "bearer" }, choose = false } = trigger.action;
    const recipients = await Creatures.selectCreatures(bearer, to, selectorContext(effect, bearer, context, trigger));
    const ended = await Creatures.removeStatuses(bearer, recipients, statuses, { choose });
    if ( ended.length ) await announce(trigger, effect, bearer, event, `Ends: ${ended.join(", ")}.`);
    return {};
  },

  /** Temporary hit points: { formula, to }. */
  async tempHp(trigger, effect, bearer, event, context={}) {
    const recipients = trigger.action.to
      ? await Creatures.selectCreatures(bearer, trigger.action.to, selectorContext(effect, bearer, context, trigger)) : [bearer];
    const source = effect.getSourceActor?.();
    const data = { ...(source?.getRollData?.() ?? bearer.getRollData()), spellLevel: effect.flags?.dnd5e?.spellLevel ?? 0,
      ...(context.data ?? {}) };
    const roll = await new Roll(String(trigger.action.formula), data).evaluate();
    await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor: bearer }), flavor: `${trigger.label ?? effect.name}: temporary hit points` });
    for ( const actor of recipients ) {
      const current = actor.system.attributes?.hp?.temp ?? 0;
      if ( roll.total <= current ) continue;
      if ( actor.isOwner ) await actor.update({ "system.attributes.hp.temp": roll.total });
      else game.socket.emit(SOCKET, { type: "updateActor", actorUuid: actor.uuid, update: { "system.attributes.hp.temp": roll.total } });
    }
    return {};
  },

  /** Recover spell slots: { budget, maxLevel }. Spends one use of the item the effect is on. */
  async recoverSlots(trigger, effect, bearer, event) {
    // From a trigger, the item's own uses gate and pay for it; from an activity (onUse), the activity already paid.
    const item = (effect.parent?.documentName === "Item") && (event !== "onUse") ? effect.parent : null;
    if ( item?.system.uses?.max && !(item.system.uses.value > 0) ) return {};
    const data = bearer.getRollData();
    const budget = Math.floor(new Roll(CONFIG.Dice.BasicRoll.replaceFormulaData(String(trigger.action.budget ?? 1), data, { missing: 0 }))
      .evaluateSync({ strict: false }).total) || 0;
    const maxLevel = trigger.action.maxLevel ?? 5;
    const slots = Object.entries(bearer.system.spells ?? {}).filter(([key]) => /^spell\d$/.test(key)).map(([key, s]) => ({
      key, level: Number(key.slice(5)), missing: Math.max(0, (s.max ?? 0) - (s.value ?? 0))
    })).filter(s => s.missing && (s.level <= maxLevel) && (s.level <= budget));
    if ( !budget || !slots.length ) return {};
    const user = Creatures.controllerOf(bearer);
    const label = trigger.label ?? item?.name ?? effect.name;
    const chosen = user ? await Creatures.runAs(user, "recoverSlots", {
      title: `${label} — ${bearer.name}`, budget, slots, maxSlots: trigger.action.maxSlots,
      prompt: `<p><strong>${label}</strong>: recover expended spell slots?</p>`
    }) : null;
    if ( !chosen ) return {};
    let total = 0;
    let count = 0;
    const update = {};
    for ( const s of slots ) {
      const n = Math.min(s.missing, chosen[s.key] ?? 0);
      if ( !n ) continue;
      total += n * s.level;
      count += n;
      update[`system.spells.${s.key}.value`] = (bearer.system.spells[s.key].value ?? 0) + n;
    }
    if ( !total || (total > budget) || (trigger.action.maxSlots && (count > trigger.action.maxSlots)) ) return {};
    await bearer.update(update);
    if ( item?.system.uses?.max ) await item.update({ "system.uses.spent": (item.system.uses.spent ?? 0) + 1 });
    await announce(trigger, effect, bearer, event, `Recovers ${Object.entries(update).map(([k, v]) => `level ${k.match(/spell(\d)/)[1]}`).join(", ")} (${total} of ${budget} levels).`);
    return {};
  },

  /** Token light on/off: { bright, dim, color }. */
  async toggleLight(trigger, effect, bearer, event) {
    const on = await Creatures.toggleLight(bearer, trigger.action);
    if ( on !== null ) await announce(trigger, effect, bearer, event, on ? "The light is on." : "The light is off.");
    return {};
  },

  /** Heroic Inspiration: { to }. */
  async inspire(trigger, effect, bearer, event, context={}) {
    const recipients = (await Creatures.selectCreatures(bearer, trigger.action.to ?? { who: "bearer" },
      selectorContext(effect, bearer, context, trigger))).filter(a => a.system.attributes?.inspiration !== undefined);
    if ( !recipients.length ) return {};
    await Creatures.setInspiration(recipients);
    await announce(trigger, effect, bearer, event, `${recipients.map(a => a.name).join(", ")} ${recipients.length > 1 ? "gain" : "gains"} Heroic Inspiration.`);
    return {};
  },

  /** Swap initiative with a creature the selector picks: { to }. */
  async swapInitiative(trigger, effect, bearer, event, context={}) {
    const [other] = await Creatures.selectCreatures(bearer, trigger.action.to ?? { who: "choose", pool: "combat", side: "ally", self: false },
      selectorContext(effect, bearer, context, trigger));
    if ( !other ) return {};
    if ( await Creatures.swapInitiative(bearer, other) ) {
      await announce(trigger, effect, bearer, event, `${bearer.name} and ${other.name} swap initiative.`);
    }
    return {};
  },

  /**
   * Roll damage from a formula against the bearer: { formula, damageType }.
   */
  async damage(trigger, effect, bearer, event, context={}) {
    const label = trigger.label ?? effect.name;
    const spec = { formula: trigger.action.formula, type: trigger.action.damageType };
    if ( trigger.action.to ) {
      const recipients = await Creatures.selectCreatures(bearer, trigger.action.to, selectorContext(effect, bearer, context, trigger));
      for ( const r of recipients ) await dealDamage(effect, r, spec, { flavor: `${label} (${bearer.name} ${EVENT_TEXT[event] ?? event})` });
      return {};
    }
    await dealDamage(effect, bearer, spec, { flavor: `${label} (${bearer.name} ${EVENT_TEXT[event] ?? event})` });
    return {};
  },

  /**
   * Roll the triggering activity's own damage (a missed cantrip, say) and deal it × multiplier to the event's targets,
   * or to action.to. Damage only — no effects. Applied automatically unless "Trigger damage" is "button".
   */
  async activityDamage(trigger, effect, bearer, event, context={}) {
    const activity = context.activity;
    if ( !activity?.damage?.parts?.length ) return {};
    const recipients = trigger.action.to
      ? await Creatures.selectCreatures(bearer, trigger.action.to, selectorContext(effect, bearer, context, trigger))
      : (context.targets ?? []);
    if ( !recipients.length ) return {};
    const multiplier = Number(trigger.action.multiplier ?? 1);
    const label = trigger.label ?? effect.name;
    const part = multiplier === 0.5 ? " (half)" : (multiplier === 1 ? "" : ` (×${multiplier})`);
    const rolls = await activity.rollDamage({}, { configure: false }, { data: {
      flavor: `${label}: ${activity.item.name}${part} — ${recipients.map(r => r.name).join(", ")}`,
      system: { targets: recipients.flatMap(bearerTargets) }
    } });
    if ( !rolls?.length || (setting("triggerDamage") !== "auto") ) return {};
    const damages = dnd5e.dice.aggregateDamageRolls(rolls, { respectProperties: true }).map(roll => ({
      value: Math.floor(Math.max(0, roll.total) * multiplier),
      type: roll.options.type, properties: Array.from(roll.options.properties ?? [])
    }));
    for ( const actor of recipients ) await applyDamageAs(actor, damages, activity);
    return {};
  },

  /**
   * Make the triggering activity's attack again against a new creature (Chromatic Orb's leap): pick it with `to` (default:
   * an enemy within 30 ft of the last target), roll the attack, and on a hit roll damage — which can trigger it again.
   * `max` (formula, @spellLevel = cast level) caps how many times one casting repeats.
   */
  async repeatActivity(trigger, effect, bearer, event, context={}) {
    const activity = context.activity;
    if ( !activity?.rollAttack ) return {};
    const data = { ...(bearer.getRollData?.() ?? {}), spellLevel: activity.item?.system?.level ?? 0 };
    let max = 1;
    try {
      max = Math.floor(new Roll(CONFIG.Dice.BasicRoll.replaceFormulaData(String(trigger.action.max ?? 1), data, { missing: 0 }))
        .evaluateSync({ strict: false }).total) || 0;
    } catch(err) { /* keep 1 */ }
    const chain = repeatChains.get(activity.uuid);
    const used = (chain && (Date.now() - chain.at < 300000)) ? chain.used : 0;
    if ( used >= max ) return {};
    const selector = trigger.action.to ?? { who: "choose", side: "enemy", range: 30, from: "subject", notSubject: true };
    const [next] = await Creatures.selectCreatures(bearer, selector, {
      ...selectorContext(effect, bearer, context, trigger),
      prompt: `<p><strong>${trigger.label ?? effect.name}</strong>: choose the next target (${used + 1} of ${max}).</p>`
    });
    if ( !next ) return {};
    repeatChains.set(activity.uuid, { used: used + 1, at: Date.now() });
    const token = Creatures.tokenFor(next)?.object;
    if ( !token ) return {};
    token.setTarget(true, { releaseOthers: true });
    const rolls = await activity.rollAttack({}, { configure: false });
    const roll = rolls?.[0];
    const ac = next.system.attributes?.ac?.value;
    if ( roll && (roll.isCritical || (!roll.isFumble && (roll.total >= ac))) && !Workflow.rollsDamageOnHit(activity) ) {
      await activity.rollDamage({ isCritical: !!roll.isCritical }, { configure: false });
    }
    return {};
  },

  /**
   * Store one of the bearer's spells in the item: pick a spell (`schools`: school ids, or "specialist" = the bearer's
   * wizard specialty) and a slot to spend; the item gains a Cast activity at that level with a fixed attack bonus and
   * DC (`attack`, `dc`), gone once cast. Storing again replaces the stored spell.
   */
  async storeSpell(trigger, effect, bearer, event, context={}) {
    const a = trigger.action;
    const item = effect.parent?.documentName === "Item" ? effect.parent : context.activity?.item;
    if ( !item ) return {};
    const holder = bearer.items.get(item.id) ?? item;
    const schools = new Set((a.schools ?? []).flatMap(s => s === "specialist" ? [specialistSchool(bearer)] : [s]).filter(Boolean));
    const spells = bearer.items.filter(i => (i.type === "spell") && (i.system.level >= 1) && !i.flags?.dnd5e?.cachedFor
      && (!schools.size || schools.has(i.system.school)));
    if ( !spells.length ) {
      ui.notifications.warn(`${holder.name}: no spell of the right school to store.`);
      return {};
    }
    const slots = Object.entries(bearer.system.spells ?? {}).filter(([key, s]) => /^spell\d$/.test(key) && (s.value > 0))
      .map(([key, s]) => ({ key, level: Number(key.slice(5)), value: s.value }));
    const user = Creatures.controllerOf(bearer);
    const choice = user ? await Creatures.runAs(user, "pickSpellSlot", {
      title: `${holder.name} — store a spell`,
      spells: spells.map(s => ({ uuid: s.uuid, name: s.name, level: s.system.level })).sort((x, y) => x.level - y.level || x.name.localeCompare(y.name)),
      slots
    }) : null;
    const spell = choice && bearer.items.find(i => i.uuid === choice.uuid);
    const slot = choice && slots.find(s => s.key === choice.slot);
    if ( !spell || !slot || (slot.level < spell.system.level) ) return {};
    await bearer.update({ [`system.spells.${slot.key}.value`]: slot.value - 1 });
    const stored = holder.system.activities.filter(x => x.flags?.[MODULE_ID]?.removeAfterUse).map(x => x.id);
    const id = foundry.utils.randomID();
    await holder.update({
      ...Object.fromEntries(stored.map(sid => [`system.activities.-=${sid}`, null])),
      [`system.activities.${id}`]: {
        _id: id, type: "cast", name: `Cast stored ${spell.name} (level ${slot.level})`,
        activation: { type: "action", override: false },
        consumption: { targets: [], spellSlot: false, scaling: { allowed: false } },
        spell: { uuid: spell.uuid, level: slot.level, properties: [], spellbook: false,
          challenge: { attack: a.attack !== undefined ? String(a.attack) : "", save: a.dc !== undefined ? String(a.dc) : "",
            override: (a.attack !== undefined) || (a.dc !== undefined) } },
        flags: { [MODULE_ID]: { removeAfterUse: true } }
      }
    });
    await announce(trigger, effect, bearer, event, `${spell.name} is stored at level ${slot.level} (level ${slot.level} slot spent).`);
    return {};
  },

  /**
   * Use an activity of the item this effect is on against creatures (default: the event's subject) — a monster's aura
   * or an item's triggered feature, with its own DC, damage and effects. Save activities go through the save workflow
   * (saves rolled, damage and effects applied). `activity`: its id or name (default: the item's first save activity).
   */
  async useActivity(trigger, effect, bearer, event, context={}) {
    const item = effect.parent?.documentName === "Item" ? effect.parent : null;
    const ref = trigger.action.activity;
    // An activity's own area passes the (upcast) activity and its usage card; otherwise find it on the item.
    const activity = (!ref && context.fromArea && context.activity) ? context.activity
      : (item?.system.activities?.get?.(ref) ?? item?.system.activities?.getName?.(ref) ?? item?.system.activities?.find?.(a => a.type === "save") ?? item?.system.activities?.contents?.[0]);
    if ( !activity ) throw new Error(`${effect.name}: no activity "${ref ?? "save"}" on ${item?.name ?? "its item"}`);
    // consume: an ordinary use by the bearer (its costs, rolls and self effects as usual) — Uncanny Metabolism.
    if ( trigger.action.consume ) {
      await activity.use({}, { configure: false }, {});
      return {};
    }
    const recipients = trigger.action.to
      ? await Creatures.selectCreatures(bearer, trigger.action.to, selectorContext(effect, bearer, context, trigger))
      : (context.targets?.length ? context.targets : (context.subject ? [context.subject] : []));
    if ( !recipients.length ) return {};
    const usage = (context.fromArea && context.usage) ? context.usage
      : (await activity.use({ consume: false, create: { measuredTemplate: false }, subsequentActions: false,
        concentration: { begin: false }, [MODULE_ID]: { noWorkflow: true } }, { configure: false }, { create: true }))?.message ?? null;
    if ( activity.type === "save" ) await Workflow.resolveSave(activity, recipients, { usage, label: trigger.label ?? item.name });
    else if ( setting("autoApplyEffects") && activity.effects?.length && usage ) {
      for ( const actor of recipients ) await autoApply(activity, actor, activity.effects, usage);
    }
    return {};
  },

  /**
   * Reduce creatures' Hit Point maximum (Life Drain) by `amount` (formula; @amount = the event's amount, e.g. the damage
   * dealt), to the event's targets or action.to. Ends when they finish a Long Rest.
   */
  async drainMaxHp(trigger, effect, bearer, event, context={}) {
    const recipients = trigger.action.to
      ? await Creatures.selectCreatures(bearer, trigger.action.to, selectorContext(effect, bearer, context, trigger))
      : (context.targets ?? []);
    const data = { ...(bearer.getRollData?.() ?? {}), ...(context.data ?? {}) };
    let amount = 0;
    try {
      amount = Math.floor(new Roll(CONFIG.Dice.BasicRoll.replaceFormulaData(String(trigger.action.amount ?? "@amount"), data, { missing: 0 }))
        .evaluateSync({ strict: false }).total);
    } catch(err) { amount = 0; }
    if ( !(amount > 0) || !recipients.length ) return {};
    const label = trigger.label ?? effect.name;
    for ( const actor of recipients ) {
      await Creatures.giveEffect({
        name: `${label} (−${amount} max HP)`, img: effect.img ?? "icons/svg/degen.svg", origin: effect.origin ?? null,
        system: { changes: [{ key: "system.attributes.hp.tempmax", type: "add", value: String(-amount), phase: "initial" }] },
        flags: { [MODULE_ID]: trigger.action.until === "never" ? {}
          : { triggers: [{ label, event: "rest", filter: [{ k: "longRest", v: true }], action: { type: "note" }, then: "remove" }] } }
      }, [actor], { replace: false });
    }
    await announce(trigger, effect, bearer, event, `${recipients.map(r => r.name).join(", ")}: Hit Point maximum −${amount}${trigger.action.until === "never" ? "" : " until a Long Rest"}.`);
    return {};
  },

  /**
   * Creatures (default: the event's targets) spend one of their Hit Point Dice (the largest left) and regain that many
   * Hit Points — the die only, no Constitution (Blood and Bone). The healer's healingExtraDie counts.
   */
  async spendHitDie(trigger, effect, bearer, event, context={}) {
    const recipients = trigger.action.to
      ? await Creatures.selectCreatures(bearer, trigger.action.to, selectorContext(effect, bearer, context, trigger))
      : (context.targets ?? []);
    const healer = effect.getSourceActor?.() ?? bearer;
    for ( const actor of recipients ) {
      const cls = Object.values(actor.classes ?? {}).filter(c => (c.system.hd?.value ?? 0) > 0)
        .sort((a, b) => Number(b.system.hd.denomination.slice(1)) - Number(a.system.hd.denomination.slice(1)))[0];
      if ( !cls ) {
        await announce(trigger, effect, bearer, event, `${actor.name} has no Hit Point Dice left.`);
        continue;
      }
      const die = cls.system.hd.denomination;
      const formula = Workflow.healingDieFormula(healer, `1${die}`);
      const roll = await new Roll(formula).evaluate();
      await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor: healer }),
        flavor: `${trigger.label ?? effect.name}: ${actor.name} spends a Hit Point Die (${die})` });
      if ( cls.isOwner ) await cls.update({ "system.hd.spent": (cls.system.hd.spent ?? 0) + 1 });
      else game.socket.emit(SOCKET, { type: "updateItem", uuid: cls.uuid, update: { "system.hd.spent": (cls.system.hd.spent ?? 0) + 1 } });
      await applyDamageAs(actor, [{ value: roll.total, type: "healing", properties: [] }], null, { pipeline: true });
    }
    return {};
  },

  /**
   * Announce only. Pair with `then: "remove"` for effects that end when something happens.
   */
  async note(trigger, effect, bearer, event) {
    const ends = trigger.then === "remove" ? `<strong>${trigger.label ?? effect.name}</strong> ends.` : "";
    await announce(trigger, effect, bearer, event, [trigger.action.text, ends].filter(Boolean).join(" "));
    return {};
  },

  /**
   * Roll a damage activity of the effect's source actor against the bearer. Applied automatically, or left on the
   * card for the GM to apply (setting "triggerDamage").
   */
  async rollActivity(trigger, effect, bearer, event) {
    const { item: itemRef, activity: activityRef } = trigger.action;
    const source = effect.getSourceActor?.();
    if ( !source ) throw new Error(`No source actor for effect ${effect.uuid} (origin ${effect.origin})`);
    const item = source.items.find(i => (i.system.identifier === itemRef) || (i.name === itemRef));
    if ( !item ) throw new Error(`${source.name} has no item "${itemRef}"`);
    const activity = item.system.activities.get(activityRef) ?? item.system.activities.getName(activityRef);
    if ( !activity ) throw new Error(`${item.name} has no activity "${activityRef}"`);

    const auto = setting("triggerDamage") === "auto";
    await announce(trigger, effect, bearer, event, auto ? "" : "Apply the damage from the card below.");
    if ( !activity.damage?.parts?.length ) return {};
    const rolls = await activity.rollDamage({}, { configure: false }, { data: { system: { targets: bearerTargets(bearer) } } });
    if ( !rolls?.length || !auto ) return {};
    const damages = dnd5e.dice.aggregateDamageRolls(rolls, { respectProperties: true }).map(roll => ({
      value: Math.max(0, roll.total),
      type: roll.options.type,
      properties: new Set(roll.options.properties ?? [])
    }));
    await bearer.applyDamage(damages, { isDelta: true });
    return {};
  },

  /**
   * A saving throw: the bearer, or the creatures `to` selects (an area's targets…). Rolled by each creature's
   * controller (Workflow.rollSaveOutcome: a player's popup or automatic, reactions included); damage per result
   * (Evasion counts), `failStatus` on a failure. Returns { success } for the bearer's own save.
   */
  async save(trigger, effect, bearer, event, context={}) {
    const a = trigger.action;
    if ( !(a.ability in CONFIG.DND5E.abilities) ) throw new Error(`Unknown ability "${a.ability}"`);
    const dc = Number(await resolveDC(a.dc, effect));
    if ( !Number.isFinite(dc) ) throw new Error(`No usable DC for ${effect.name} (dc: ${a.dc})`);
    const recipients = a.to ? await Creatures.selectCreatures(bearer, a.to, selectorContext(effect, bearer, context, trigger)) : [bearer];
    if ( !recipients.length ) return {};
    const label = trigger.label ?? effect.name;
    const abilityLabel = CONFIG.DND5E.abilities[a.ability].label;
    const who = a.to ? `${recipients.map(r => r.name).join(", ")}: ` : "";
    await announce(trigger, effect, bearer, event, `${who}${abilityLabel} save, DC ${dc}.`);
    let outcome = {};
    for ( const actor of recipients ) {
      const mods = resolveSaveModifiers(a.modifiers, effect, actor, event, context);
      const spec = { ability: a.ability, dc: dc + mods.dc, disadvantage: mods.disadvantage, bonus: mods.bonus,
        advantage: mods.advantage || Workflow.hasSaveAdvantage(actor, a.failStatus ? [a.failStatus] : []) };
      const { total, success } = await Workflow.rollSaveOutcome(actor, spec, label);
      if ( total === null ) continue;
      const ends = !a.to && (resolveThen(trigger.then, { success }) === "remove");
      if ( success || ends ) await ChatMessage.implementation.create({
        speaker: ChatMessage.implementation.getSpeaker({ actor }), content: saveResultText(actor, label, success, ends)
      });
      await saveDamage(effect, actor, Workflow.withEvasion(a.damage, actor, a.ability), success, label);
      if ( !success && a.failStatus ) await giveStatus(actor, a.failStatus, a.failUntil ?? "turnStart", effect, label);
      outcome = { success };
    }
    // "End it on a success/failure" concerns the bearer's own save.
    return a.to ? {} : outcome;
  }
};

/**
 * A save action's DC: a number, "source" (the DC of the activity that applied the effect) or "sourceSpell" (the spell
 * save DC of the effect's source — for summons and auras).
 */
async function resolveDC(dc, effect) {
  if ( dc === "source" ) return (await originActivity(effect))?.save?.dc?.value;
  if ( dc === "sourceSpell" ) return effect.getSourceActor?.()?.system.attributes?.spell?.dc;
  // A formula on the source's data, e.g. "8 + @prof + @abilities.cha.mod".
  if ( (typeof dc === "string") && /[@+\-]/.test(dc) ) {
    const data = (effect.getSourceActor?.() ?? effect.parent?.actor)?.getRollData?.() ?? {};
    try { return Math.floor(new Roll(CONFIG.Dice.BasicRoll.replaceFormulaData(dc, data, { missing: 0 })).evaluateSync({ strict: false }).total); }
    catch(err) { return NaN; }
  }
  return dc;
}

/** Put a condition on a creature until the start or end of its next turn. */
async function giveStatus(actor, statusId, until, effect, label) {
  const status = CONFIG.statusEffects.find(s => s.id === statusId);
  if ( !status ) return;
  await Creatures.giveEffect({
    name: `${game.i18n.localize(status.name)} (${label})`, img: status.img, statuses: [statusId], origin: effect.origin ?? null,
    // until: the start or end of its next turn, or of the source's (sourceStart / sourceEnd).
    duration: { value: 1, units: "rounds", expiry: ["turnEnd", "sourceStart", "sourceEnd"].includes(until) ? until : "turnStart" }
  }, [actor]);
}

// A player rolls a save on their own client (auras, "save" with `to`).
Creatures.HANDLERS.rollSave = async function({ actorUuid, spec }) {
  const actor = fromUuidSync(actorUuid);
  if ( !actor?.isOwner ) return null;
  const rolls = await rollSave(actor, spec);
  return rolls?.[0] ? { total: rolls[0].total } : null;
};

/* -------------------------------------------- */
/*  Save modifiers                              */
/* -------------------------------------------- */

/**
 * Resolve a save action's modifiers into roll options.
 *
 * `modifiers` is a list; each entry may set any of:
 *   advantage: true · disadvantage: true
 *   bonus: "formula"   added to the roll (negative for a penalty), e.g. "2", "-1d4", "@prof", "@source.abilities.int.mod"
 *   dc: "formula"      added to the DC (negative lowers it)
 *   filter: FilterDescription   only applies when it matches: the bearer's roll data, plus `source` (the effect's
 *                               source actor's roll data), `event`, and the event's own data
 *   label: "text"      shown in chat (default: a description of the modifier)
 * A single object is accepted in place of a list.
 */
function resolveSaveModifiers(modifiers, effect, bearer, event, context) {
  const list = Array.isArray(modifiers) ? modifiers : (modifiers ? [modifiers] : []);
  const source = effect.getSourceActor?.();
  const data = { ...bearer.getRollData(), source: source?.getRollData?.() ?? {}, event, ...(context?.data ?? {}) };
  const out = { advantage: false, disadvantage: false, bonus: [], dc: 0, text: [] };
  const simplify = formula => CONFIG.Dice.BasicRoll.replaceFormulaData(String(formula), data, { missing: 0 });
  for ( const mod of list ) {
    if ( mod.filter && !dnd5e.Filter.performCheck(data, mod.filter) ) continue;
    const parts = [];
    if ( mod.advantage ) { out.advantage = true; parts.push("advantage"); }
    if ( mod.disadvantage ) { out.disadvantage = true; parts.push("disadvantage"); }
    if ( mod.bonus ) {
      const f = simplify(mod.bonus);
      out.bonus.push(f);
      parts.push(`${/^\s*-/.test(f) ? "" : "+"}${f.trim()}`);
    }
    if ( mod.dc ) {
      const value = Number(new Roll(simplify(mod.dc)).evaluateSync({ strict: false }).total) || 0;
      out.dc += value;
      parts.push(`DC ${value >= 0 ? "+" : ""}${value}`);
    }
    if ( parts.length ) out.text.push(mod.label ?? parts.join(" "));
  }
  return out;
}

/**
 * Roll a saving throw with resolved modifiers.
 * @param {Actor5e} actor
 * @param {{ability, dc, advantage, disadvantage, bonus: string[]}} spec
 */
function rollSave(actor, spec) {
  const config = { ability: spec.ability, target: spec.dc };
  if ( spec.advantage ) config.advantage = true;
  if ( spec.disadvantage ) config.disadvantage = true;
  if ( spec.bonus?.length ) {
    const labelled = Object.fromEntries(spec.bonus.map((f, i) => [`triggerBonus${i}`, f]));
    config.rolls = [CONFIG.Dice.BasicRoll.constructParts(labelled, {})];
  }
  return actor.rollSavingThrow(config, { configure: false }, {});
}

/**
 * Dispatch a trigger's action.
 */
async function runAction(trigger, effect, bearer, event, context) {
  const handler = ACTIONS[trigger.action?.type];
  if ( !handler ) throw new Error(`Unknown action type "${trigger.action?.type}"`);
  return handler(trigger, effect, bearer, event, context);
}

/* -------------------------------------------- */
/*  Setup                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  Areas.registerAreaBehavior();
  game.settings.register(MODULE_ID, "autoApplyEffects", {
    name: "Auto-apply effects",
    hint: "Apply an activity's effects automatically: to targets an attack hits, to targets that fail a save rolled "
      + "from its card, to yourself for self-targeted spells and features, and for buffs like Mage Armor or Bless to the "
      + "creatures you targeted (or yourself if you targeted no one). The chat card's Apply button still works.",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "triggerDamage", {
    name: "Apply rolled damage",
    hint: "Damage rolled by a trigger (e.g. an aura detonating, ongoing damage) is applied automatically, or left on "
      + "the damage card for the GM to apply.",
    scope: "world", config: true, type: String, default: "auto",
    choices: { auto: "Apply automatically", button: "Offer an Apply button" }
  });
  game.settings.register(MODULE_ID, "autoConcentration", {
    name: "Concentration saves",
    hint: "When a concentrating creature takes damage. Off: dnd5e's prompt and Break button. Automatic: NPCs (and PCs "
      + "whose player is offline) roll immediately, connected players get dnd5e's prompt; any failed roll ends "
      + "concentration. Everyone: roll immediately for all creatures.",
    scope: "world", config: true, type: String, default: "auto",
    choices: { off: "Off (dnd5e default)", auto: "Automatic (players roll their own)", all: "Roll for everyone" }
  });
  game.settings.register(MODULE_ID, "reactions", {
    name: "Reaction popups",
    hint: "When something happens that a creature could react to (an attack hits, a save succeeds, damage is about to "
      + "land, a spell is being cast), whoever controls a creature with an eligible reaction gets a popup to use it "
      + "or skip. The moment waits for the answer.",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "reactionTimeout", {
    name: "Reaction popup timeout (seconds)",
    hint: "Unanswered reaction popups skip automatically after this long. 0 = wait indefinitely.",
    scope: "world", config: true, type: Number, default: 30, range: { min: 0, max: 300, step: 5 }
  });
  game.settings.register(MODULE_ID, "opportunityAttacks", {
    name: "Opportunity Attack popups",
    hint: "In combat, when a creature moves out of a hostile creature's reach, offer that creature an Opportunity Attack.",
    scope: "world", config: true, type: Boolean, default: true
  });
  const saveModes = { off: "Off — dnd5e chat card", auto: "Automatic — saves rolled, damage and effects applied" };
  game.settings.register(MODULE_ID, "wfSavePC", {
    name: "Save spells and abilities — used by players",
    hint: "When a player's creature (their character or summon) uses something that forces a save (Fireball, Toll the "
      + "Dead…): the creatures in its area — or the targets — roll, damage is rolled once and applied per result, and "
      + "effects go on those who failed.",
    scope: "world", config: true, type: String, default: "auto", choices: saveModes
  });
  game.settings.register(MODULE_ID, "wfSaveNPC", {
    name: "Save spells and abilities — used by NPCs",
    hint: "The same, when an NPC uses it.",
    scope: "world", config: true, type: String, default: "auto", choices: saveModes
  });
  const attackModes = { off: "Off — dnd5e chat card", attack: "Roll the attack when used",
    full: "Roll the attack, then damage on a hit and apply it" };
  game.settings.register(MODULE_ID, "wfAttackPC", {
    name: "Attacks — used by players",
    hint: "When a player's creature attacks with targets selected.",
    scope: "world", config: true, type: String, default: "full", choices: attackModes
  });
  game.settings.register(MODULE_ID, "wfAttackNPC", {
    name: "Attacks — used by NPCs",
    hint: "When an NPC attacks with targets selected.",
    scope: "world", config: true, type: String, default: "full", choices: attackModes
  });
  game.settings.register(MODULE_ID, "wfMastery", {
    name: "Weapon masteries — applied automatically",
    hint: "Vex, Sap, Slow, Topple and Graze take effect on their own when a creature attacks with a weapon whose mastery it has (dnd5e's weapon mastery choices).",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "wfHeal", {
    name: "Healing — applied automatically",
    hint: "When a creature uses a healing feature or spell (Cure Wounds, Hand of Healing, Second Wind…), roll it and apply it to its targets, or to the user if no one is targeted.",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "wfTargetPC", {
    name: "Player characters' saves",
    hint: "When a player character has to save against something automated: its player gets a popup (Roll / Advantage "
      + "/ Disadvantage, rolled automatically after the reaction timeout), or it's rolled for them. NPCs are always "
      + "rolled by the GM's client.",
    scope: "world", config: true, type: String, default: "prompt",
    choices: { prompt: "Their player rolls (popup)", auto: "Rolled automatically" }
  });
  game.settings.register(MODULE_ID, "wfRemoveTemplates", {
    name: "Remove areas of instantaneous spells",
    hint: "After an automated save spell resolves, remove its area (Fireball's sphere). Areas of spells with a duration stay.",
    scope: "world", config: true, type: Boolean, default: true
  });
  registerSettingsMenu();
});

Hooks.once("ready", () => {
  Workflow.initWorkflow({ autoApply, rollSave, applyDamageAs, setting, findUsageMessage,
    saveSucceeded: args => Reactions.saveSucceeded(args) });
  Areas.initAreas({ runTriggerList, findUsageMessage, setting, saveMode: actor => Workflow.modeFor("Save", actor) });
  game.modules.get(MODULE_ID).api = {
    ACTIONS, fire, autoApply, findUsageMessage,
    openEditor: doc => TriggerEditor.open(doc), describeTrigger, describeReaction,
    creatures: Creatures, workflow: Workflow, areas: Areas
  };
  console.log(`${MODULE_ID} | Ready`);
});
