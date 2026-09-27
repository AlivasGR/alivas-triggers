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
 *   initiative  bearer rolled initiative                       (dnd5e.rollInitiative)
 *   moved       bearer's token moved                           (moveToken, moving client)
 *               filter data: moved, movedThisTurn (history since turn start + this move), ownTurn
 *   statusGained  bearer gained statuses                       (create/enable ActiveEffect, acting client)
 *               filter data: gainedStatuses (array) — e.g. { k: "gainedStatuses", o: "has", v: "dodging" }
 *   damaged filter data: amount · save filter data: ability, total
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
 *   damage { formula, damageType }    roll damage against the bearer (e.g. ongoing damage at the start of its turn)
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
 *   pay: { cost, from: [identifier, …] }   pay `cost` uses from these items in order (e.g. Metamagic Adept's points
 *                        first, then Sorcery Points); refused if together they can't cover it
 *
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
          continue;
        }
      } finally {
        awaitingReaction.delete(key);
        release();
      }
    }
    await fire("hit", target, { activity: subject, rolls, attacker: subject.actor });
    if ( isAbsorbed(target, subject) ) continue;
    if ( setting("autoApplyEffects") && subject.effects?.length ) {
      await autoApply(subject, target, subject.effects, findUsageMessage(subject));
    }
  }
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
    if ( !setting("reactions") || !roll || !Number.isFinite(dc) || (roll.total < dc) ) return;
    const what = skill ? `${CONFIG.DND5E.skills[skill]?.label ?? skill} check`
      : tool ? "tool check" : `${CONFIG.DND5E.abilities[ability]?.label ?? ""} check`;
    Reactions.saveSucceeded({ actor: subject, roll, dc, kind: "check", label: `${/^[aeiou]/i.test(what) ? "an" : "a"} ${what}` });
  });
}

Hooks.on("dnd5e.rollSavingThrow", (rolls, { ability, subject }) => {
  fire("save", subject, { rolls, ability, data: { ability, total: rolls?.[0]?.total } });
  // A concentration roll is a Con save, but it must not answer a repeat save a trigger is waiting for.
  if ( !rolls?.[0]?.options?.isConcentration ) resolvePendingSaves(subject, ability, rolls?.[0]);
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

Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => {
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
    for ( const actor of recipients ) autoApply(activity, actor, activity.effects, usage);
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
async function beforeDamage(actor, damages, options) {
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
    damages = await Reactions.damageIncoming(actor, damages);
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

  // Damage: pause for reactions, block negated attacks (see beforeDamage).
  const applyDamage = actorProto.applyDamage;
  actorProto.applyDamage = async function(damages, options={}) {
    if ( options[MODULE_ID]?.reacted ) return applyDamage.call(this, damages, options);
    const next = await beforeDamage(this, damages, options);
    if ( !next ) return this;
    return applyDamage.call(this, next.damages, next.options);
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

  // Rules key "dc": save and check DCs pick up matching Rules → Bonus changes (see dcRuleBonus).
  const savePrep = CONFIG.DND5E.activityTypes.save?.documentClass?.prototype;
  if ( savePrep?.prepareFinalData ) {
    const prepare = savePrep.prepareFinalData;
    savePrep.prepareFinalData = function(rollData) {
      rollData ??= this.getRollData({ deterministic: true });
      prepare.call(this, rollData);
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
    const triggers = effect.getFlag(MODULE_ID, "triggers");
    if ( !Array.isArray(triggers) ) continue;
    // Source-turn events only concern effects that creature applied.
    if ( context?.sourceActor && (effect.getSourceActor?.()?.uuid !== context.sourceActor.uuid) ) continue;
    for ( const trigger of triggers ) {
      const events = Array.isArray(trigger.event) ? trigger.event : [trigger.event];
      if ( !events.includes(event) ) continue;
      if ( !passesFilter(trigger, event, context, bearer) ) continue;
      if ( inFlight.has(effect.uuid) ) continue;
      inFlight.add(effect.uuid);
      let removed = false;
      try {
        const result = await runAction(trigger, effect, bearer, event, context) ?? {};
        if ( resolveThen(trigger.then, result) === "remove" ) {
          await effect.delete();
          removed = true;
        }
      } catch(err) {
        console.error(`${MODULE_ID} | Trigger "${trigger.label ?? effect.name}" failed`, err);
        ui.notifications.error(`${MODULE_ID}: trigger "${trigger.label ?? effect.name}" failed — see console.`);
      } finally {
        inFlight.delete(effect.uuid);
      }
      if ( removed ) break;
    }
  }
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
function passesFilter(trigger, event, context, bearer) {
  if ( !trigger.filter || foundry.utils.isEmpty(trigger.filter) ) return true;
  const data = {
    ...(context.activity?.getRollData?.() ?? {}), ...(context.data ?? {}), event, bearer: bearer?.getRollData?.() ?? {}
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
async function autoApply(activity, actor, profiles, usage) {
  if ( !usage ) return;
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

Hooks.once("ready", () => {
  game.socket.on(SOCKET, async data => {
    if ( (data?.type !== "applyEffects") || (game.users.activeGM !== game.user) ) return;
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
/*  Player-rolled saves                         */
/* -------------------------------------------- */

/**
 * An active, non-GM user who owns this actor, if any.
 * @param {Actor5e} actor
 * @returns {User|undefined}
 */
function activePlayerOwner(actor) {
  return game.users.find(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
}

/**
 * A saving throw was rolled: resolve any save a trigger asked this actor's player for.
 */
async function resolvePendingSaves(actor, ability, roll) {
  if ( !actor?.isOwner || !roll ) return;
  for ( const effect of Array.from(actor.allApplicableEffects()) ) {
    const pending = effect.getFlag(MODULE_ID, "pendingSave");
    if ( !pending || (pending.ability !== ability) ) continue;
    await effect.unsetFlag(MODULE_ID, "pendingSave");
    let success = roll.total >= pending.dc;
    if ( success && setting("reactions") ) {
      success = (await Reactions.saveSucceeded({ actor, roll, dc: pending.dc, label: `the save against ${pending.label}` })).success;
    }
    const ends = resolveThen(pending.then, { success }) === "remove";
    await ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content: saveResultText(actor, pending.label, success, ends, ` (${roll.total} vs DC ${pending.dc})`)
    });
    await saveDamage(effect, actor, pending.damage, success, pending.label);
    if ( ends ) await effect.delete();
  }
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
  rest: "finishes a rest", initiative: "rolls initiative", moved: "moves", statusGained: "gains a condition"
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
  const roll = new CONFIG.Dice.DamageRoll(String(spec.formula), source?.getRollData?.() ?? bearer.getRollData(), {
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
  const sign = type in CONFIG.DND5E.healingTypes ? -1 : 1;
  await bearer.applyDamage([{ value: value * sign, type, properties: new Set() }], { isDelta: true });
}

/**
 * Damage attached to a save: full on a failure; half or none on a success.
 * @param {{formula, type, onSuccess: "none"|"half"}} spec
 */
function saveDamage(effect, bearer, spec, success, label) {
  if ( !spec?.formula ) return;
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
    bearer, source: effect?.getSourceActor?.() ?? null, subject: context.attacker ?? null,
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
    getSourceActor: () => actor, getFlag: () => undefined
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
  async damage(trigger, effect, bearer, event) {
    const label = trigger.label ?? effect.name;
    const spec = { formula: trigger.action.formula, type: trigger.action.damageType };
    await dealDamage(effect, bearer, spec, { flavor: `${label} (${bearer.name} ${EVENT_TEXT[event] ?? event})` });
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
      value: Math.max(0, roll.total) * ((roll.options.type in CONFIG.DND5E.healingTypes) ? -1 : 1),
      type: roll.options.type,
      properties: new Set(roll.options.properties ?? [])
    }));
    await bearer.applyDamage(damages, { isDelta: true });
    return {};
  },

  /**
   * The bearer saves. A PC whose player is connected gets a save button in chat and the result is resolved when they
   * roll it (setting "playerSaves"); everyone else is rolled here. Returns { success } when rolled here.
   */
  async save(trigger, effect, bearer, event, context={}) {
    const { ability } = trigger.action;
    let dc = trigger.action.dc;
    if ( dc === "source" ) dc = (await originActivity(effect))?.save?.dc?.value;
    dc = Number(dc);
    if ( !(ability in CONFIG.DND5E.abilities) ) throw new Error(`Unknown ability "${ability}"`);
    if ( !Number.isFinite(dc) ) throw new Error(`No usable DC for ${effect.name} (dc: ${trigger.action.dc})`);
    const label = trigger.label ?? effect.name;
    const abilityLabel = CONFIG.DND5E.abilities[ability].label;

    const mods = resolveSaveModifiers(trigger.action.modifiers, effect, bearer, event, context);
    dc += mods.dc;
    const spec = { ability, dc, advantage: mods.advantage, disadvantage: mods.disadvantage, bonus: mods.bonus };
    const modText = mods.text.length ? ` (${mods.text.join(", ")})` : "";

    const player = setting("playerSaves") ? activePlayerOwner(bearer) : null;
    if ( player ) {
      await effect.setFlag(MODULE_ID, "pendingSave", { ...spec, then: trigger.then, label, damage: trigger.action.damage ?? null });
      await announce(trigger, effect, bearer, event, `${player.name}, roll the save: `
        + `<button type="button" data-sba-save="${effect.uuid}">${abilityLabel} save, DC ${dc}${modText}</button>`);
      return {};
    }

    await announce(trigger, effect, bearer, event, `${abilityLabel} save, DC ${dc}${modText}.`);
    const rolls = await rollSave(bearer, spec);
    const roll = rolls?.[0];
    if ( !roll ) return {};
    let success = roll.isSuccess ?? (roll.total >= dc);
    if ( success && setting("reactions") ) {
      success = (await Reactions.saveSucceeded({ actor: bearer, roll, dc, label: `the save against ${label}` })).success;
    }
    const ends = resolveThen(trigger.then, { success }) === "remove";
    if ( success || ends ) await ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor: bearer }),
      content: saveResultText(bearer, label, success, ends)
    });
    await saveDamage(effect, bearer, trigger.action.damage, success, label);
    return { success };
  }
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

/** The module's own "roll the save" button for players (carries advantage and bonuses, unlike [[/save]]). */
Hooks.on("renderChatMessageHTML", (message, html) => {
  for ( const button of html.querySelectorAll?.("button[data-sba-save]") ?? [] ) {
    const effect = fromUuidSync(button.dataset.sbaSave);
    const actor = effect?.parent instanceof Actor ? effect.parent : effect?.parent?.actor;
    const pending = effect?.getFlag(MODULE_ID, "pendingSave");
    if ( !actor?.isOwner || !pending ) {
      button.disabled = true;
      continue;
    }
    button.addEventListener("click", async event => {
      event.preventDefault();
      button.disabled = true;
      await rollSave(actor, pending);
    });
  }
});

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
  game.settings.register(MODULE_ID, "autoApplyEffects", {
    name: "Auto-apply effects",
    hint: "Apply an activity's effects automatically: to targets an attack hits, to targets that fail a save rolled "
      + "from its card, to yourself for self-targeted spells and features, and for buffs like Mage Armor or Bless to the "
      + "creatures you targeted (or yourself if you targeted no one). The chat card's Apply button still works.",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "triggerDamage", {
    name: "Trigger damage",
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
  game.settings.register(MODULE_ID, "playerSaves", {
    name: "Players roll their own repeat saves",
    hint: "When a trigger asks a player character for a saving throw and its player is connected, post a save button "
      + "for the player instead of rolling it automatically.",
    scope: "world", config: true, type: Boolean, default: true
  });
});

Hooks.once("ready", () => {
  game.modules.get(MODULE_ID).api = {
    ACTIONS, fire, autoApply, findUsageMessage,
    openEditor: doc => TriggerEditor.open(doc), describeTrigger, describeReaction,
    creatures: Creatures
  };
  console.log(`${MODULE_ID} | Ready`);
});
