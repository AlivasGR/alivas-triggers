/**
 * Alivas's Engine of Triggers — the editor.
 *
 * One window edits either
 *   - an Active Effect's triggers  (flags.alivas-engine-of-triggers.triggers), or
 *   - an Item's reactions          (flags.alivas-engine-of-triggers.reactions).
 * It opens from the ⚡ entry in a sheet's header menu. Effect sheets also show the triggers as sentences on their
 * Details tab, with an Edit button; item sheets do the same on the Activities tab when the item has reactions or a
 * reaction activity.
 *
 * The editor works on friendly "models" (events, condition rows, modifier rows…) and converts them to and from the
 * engine's formats, so everything it saves is exactly what main.mjs / reactions.mjs read. Anything it can't show as a
 * form (e.g. OR conditions written by hand) is kept untouched and shown as "custom"; the Advanced view edits raw data.
 */

import { describeSelector } from "./creatures.mjs";

const MODULE_ID = "alivas-engine-of-triggers";
const { ApplicationV2 } = foundry.applications.api;

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

const esc = value => foundry.utils.escapeHTML(String(value ?? ""));
const clone = foundry.utils.deepClone;
const options = (entries, selected) => entries.map(([value, label]) =>
  `<option value="${esc(value)}"${String(value) === String(selected ?? "") ? " selected" : ""}>${esc(label)}</option>`).join("");

const abilityEntries = () => Object.entries(CONFIG.DND5E.abilities).map(([id, a]) => [id, a.label]);
const abilityLabel = id => CONFIG.DND5E.abilities[id]?.label ?? id?.toUpperCase?.() ?? "";
const abilityAbbr = id => (CONFIG.DND5E.abilities[id]?.abbreviation ?? id ?? "").toUpperCase();
const damageEntries = () => [
  ...Object.entries(CONFIG.DND5E.damageTypes).map(([id, d]) => [id, d.label]),
  ...Object.entries(CONFIG.DND5E.healingTypes).map(([id, d]) => [id, d.label])
];
const damageLabel = id => (CONFIG.DND5E.damageTypes[id] ?? CONFIG.DND5E.healingTypes[id])?.label ?? id ?? "";
const statusEntries = () => CONFIG.statusEffects.filter(s => s.id && s.name)
  .map(s => [s.id, game.i18n.localize(s.name)]).sort((a, b) => a[1].localeCompare(b[1]));
const statusLabel = id => {
  const s = CONFIG.statusEffects.find(e => e.id === id);
  return s ? game.i18n.localize(s.name) : id;
};
const schoolEntries = () => Object.entries(CONFIG.DND5E.spellSchools).map(([id, s]) => [id, s.label]);
const creatureTypeEntries = () => Object.entries(CONFIG.DND5E.creatureTypes).map(([id, c]) => [id, game.i18n.localize(c.label ?? id)]);
const classEntries = () => {
  const ids = new Set(game.items?.filter(i => i.type === "class").map(i => i.system.identifier) ?? []);
  for ( const a of game.actors ?? [] ) for ( const i of a.items ) if ( i.type === "class" ) ids.add(i.system.identifier);
  for ( const id of ["artificer", "bard", "cleric", "druid", "paladin", "ranger", "sorcerer", "warlock", "wizard"] ) ids.add(id);
  return [...ids].filter(Boolean).sort().map(id => [id, id.charAt(0).toUpperCase() + id.slice(1)]);
};

function formulaOk(formula) {
  if ( (formula === undefined) || (formula === null) || (String(formula).trim() === "") ) return false;
  try {
    return Roll.validate(String(formula).replace(/@[\w.-]+/g, "1"));
  } catch(err) {
    return false;
  }
}

/* -------------------------------------------- */
/*  Vocabulary: trigger events and actions      */
/* -------------------------------------------- */

const EVENT_GROUPS = [
  { label: "On the bearer's turn", events: [
    ["turnStart", "Its turn starts", "at the start of the bearer's turn"],
    ["turnEnd", "Its turn ends", "at the end of the bearer's turn"]
  ] },
  { label: "When the bearer…", events: [
    ["attack", "Makes an attack", "when the bearer attacks"],
    ["missed", "Misses with an attack", "when the bearer misses with an attack"],
    ["dealt", "Deals damage", "when the bearer deals damage"],
    ["damageRolled", "Rolls damage", "when the bearer rolls damage"],
    ["spell", "Casts a spell", "when the bearer casts a spell"],
    ["activity", "Uses anything", "when the bearer uses an action or feature"],
    ["save", "Makes a save", "when the bearer makes a saving throw"],
    ["check", "Makes a check", "when the bearer makes an ability check"],
    ["moved", "Moves", "when the bearer moves"],
    ["collided", "Moves into a creature", "when the bearer moves into a creature's space"],
    ["rest", "Finishes a rest", "when the bearer finishes a rest"],
    ["initiative", "Rolls initiative", "when the bearer rolls initiative"],
    ["interval", "Time passes", "every so often (game time)"]
  ] },
  { label: "When something happens to the bearer", events: [
    ["hit", "Is hit by an attack", "when the bearer is hit by an attack"],
    ["damaged", "Takes damage", "when the bearer takes damage"],
    ["statusGained", "Gains a condition", "when the bearer gains a condition"],
    ["applied", "Is applied", "when this effect is applied"]
  ] },
  { label: "Its area…", area: true, events: [
    ["areaCreated", "Appears", "when its area appears"],
    ["areaEnter", "A creature enters", "when a creature enters its area"],
    ["areaLeave", "A creature leaves", "when a creature leaves its area"],
    ["areaTurnStart", "A creature starts its turn in it", "when a creature starts its turn in its area"],
    ["areaTurnEnd", "A creature ends its turn in it", "when a creature ends its turn in its area"]
  ] },
  { label: "Rounds and the source", events: [
    ["roundStart", "A round starts", "at the start of each round"],
    ["roundEnd", "A round ends", "at the end of each round"],
    ["sourceTurnStart", "Source's turn starts", "at the start of the source's turn"],
    ["sourceTurnEnd", "Source's turn ends", "at the end of the source's turn"]
  ] }
];
const AREA_EVENT_IDS = EVENT_GROUPS.filter(g => g.area).flatMap(g => g.events.map(([id]) => id));
const EVENT_PHRASE = Object.fromEntries(EVENT_GROUPS.flatMap(g => g.events.map(([id, , phrase]) => [id, phrase])));

const TRIGGER_ACTIONS = [
  ["save", "fa-dice-d20", "Saving throw", "The bearer rolls a save"],
  ["damage", "fa-burst", "Damage", "Roll damage against the bearer"],
  ["useActivity", "fa-hand-sparkles", "Use its own ability", "Use an activity of this item on the creature (an aura's save, a triggered feature)"],
  ["spendHitDie", "fa-dice-d6", "Spend a Hit Die", "Creatures spend a Hit Point Die and heal that much (Blood and Bone)"],
  ["drainMaxHp", "fa-heart-crack", "Reduce max HP", "Lower Hit Point maximum by the damage dealt, until a Long Rest (Life Drain)"],
  ["repeatActivity", "fa-share", "Attack a new target", "Make the same attack against another creature (Chromatic Orb's leap)"],
  ["activityDamage", "fa-burst", "Its own damage again", "Roll the triggering attack or spell's damage × a multiplier (Potent Cantrip)"],
  ["giveEffect", "fa-hand-holding-medical", "Give an effect", "Put an effect on chosen or nearby creatures"],
  ["removeStatus", "fa-hand-sparkles", "End conditions", "Remove conditions from chosen creatures"],
  ["tempHp", "fa-shield-heart", "Temporary HP", "Give temporary hit points"],
  ["storeSpell", "fa-box-archive", "Store a spell", "Spend a slot to store one of your spells in this item (Ring of Spell Storing, Keywand)"],
  ["recoverSlots", "fa-rotate", "Recover spell slots", "Choose expended slots to get back (Arcane Recovery)"],
  ["toggleLight", "fa-lightbulb", "Light on / off", "Switch the bearer's token light"],
  ["random", "fa-dice", "Roll on a table", "Roll a die; the matching row's effect is given (Wild Surge)"],
  ["teleport", "fa-person-through-window", "Teleport", "Move a creature to a spot its player picks within range (Misty Step)"],
  ["push", "fa-arrows-left-right", "Push or pull", "Move creatures straight away from (or toward) the bearer (Thunderous Smite)"],
  ["sense", "fa-eye", "Sense nearby", "Privately tell the bearer's player what's nearby (Divine Sense, Detect Magic)"],
  ["inspire", "fa-star", "Heroic Inspiration", "Give Heroic Inspiration to chosen creatures"],
  ["swapInitiative", "fa-right-left", "Swap initiative", "Swap initiative with a chosen creature"],
  ["rollActivity", "fa-wand-sparkles", "Source's activity", "Roll a damage activity of whoever applied this"],
  ["note", "fa-comment", "Just a message", "Post a chat line — pair with “End the effect”"],
  ["duplicates", "fa-clone", "Duplicates", "Mirror Image-style: a duplicate may take the hit"],
  ["restoreDuplicates", "fa-rotate", "Restore duplicates", "Lost duplicates come back"]
];

function thenEntries(actionType) {
  const entries = [["keep", "Keep the effect"], ["remove", "End the effect"]];
  if ( actionType === "save" ) entries.push(["removeOnSuccess", "End it on a successful save"],
    ["removeOnFailure", "End it on a failed save"]);
  if ( actionType === "duplicates" ) entries.push(["removeWhenDepleted", "End it when no duplicates are left"]);
  return entries;
}

const DEFAULT_ACTIONS = {
  save: { type: "save", ability: "con", dc: "source" },
  damage: { type: "damage", formula: "1d6", damageType: "fire" },
  activityDamage: { type: "activityDamage", multiplier: 0.5 },
  useActivity: { type: "useActivity", activity: "" },
  drainMaxHp: { type: "drainMaxHp", amount: "@amount" },
  spendHitDie: { type: "spendHitDie", to: { who: "targets" } },
  repeatActivity: { type: "repeatActivity", max: "1", to: { who: "choose", side: "enemy", range: 30, from: "subject", notSubject: true } },
  storeSpell: { type: "storeSpell", schools: ["specialist"], attack: 9, dc: 17 },
  giveEffect: { type: "giveEffect", effect: "", to: { who: "all", range: 10, side: "ally" } },
  removeStatus: { type: "removeStatus", statuses: [], to: { who: "targets" }, choose: true },
  tempHp: { type: "tempHp", formula: "1d10 + 5" },
  recoverSlots: { type: "recoverSlots", budget: "ceil(@details.level / 2)", maxLevel: 5 },
  toggleLight: { type: "toggleLight", bright: 20, dim: 40, color: "#ffb86b" },
  random: { type: "random", formula: "1d8", results: [{ roll: "1", effect: "" }] },
  teleport: { type: "teleport", range: 30, sight: true },
  push: { type: "push", distance: 10 },
  sense: { type: "sense", range: 60, creatures: [{ k: "details.type.value", o: "in", v: ["celestial", "fiend", "undead"] }] },
  inspire: { type: "inspire", to: { who: "choose", side: "ally", count: "@prof", self: false } },
  swapInitiative: { type: "swapInitiative", to: { who: "choose", pool: "combat", side: "ally", self: false, able: true } },
  rollActivity: { type: "rollActivity", item: "", activity: "" },
  note: { type: "note" },
  duplicates: { type: "duplicates", count: 3, threshold: 3 },
  restoreDuplicates: { type: "restoreDuplicates", count: 3 }
};

const FORMULA_HINT = "Formulas can use the source's data, e.g. <code>@abilities.wis.mod</code>, <code>@prof</code>, "
  + "<code>@spellLevel</code> (the level the effect's spell was cast at).";

const SELECTOR_WHO = {
  trigger: [["choose", "Creatures the bearer chooses"], ["all", "Every creature that matches"], ["bearer", "The bearer"], ["source", "The source"], ["subject", "The other creature (e.g. the attacker)"], ["targets", "The triggering spell's targets"]],
  reaction: [["choose", "A creature you choose"], ["all", "Every creature that matches"], ["self", "Yourself"], ["subject", "The triggering creature"]]
};
const SIDES = [["any", "Anyone"], ["ally", "Allies"], ["enemy", "Enemies"], ["notAlly", "Not allies (enemies and neutrals)"]];

const TRIGGER_PRESETS = [
  { icon: "fa-circle-radiation", label: "Aura", hint: "An area around the bearer: creatures starting their turn in it save or take damage",
    rules: { areaRadius: 10 },
    data: { event: ["areaTurnStart"], action: { type: "save", ability: "con", dc: "source", to: { who: "targets" },
      damage: { formula: "2d6", type: "poison", onSuccess: "half" } }, then: "keep" } },
  { icon: "fa-dice-d20", label: "Save ends", hint: "Save at the end of each of its turns; ends on a success",
    data: { event: ["turnEnd"], action: { type: "save", ability: "con", dc: "source" }, then: "removeOnSuccess" } },
  { icon: "fa-heart-crack", label: "Save when hurt", hint: "Save whenever it takes damage; ends on a success",
    data: { event: ["damaged"], action: { type: "save", ability: "wis", dc: "source" }, then: "removeOnSuccess" } },
  { icon: "fa-flask", label: "Save or take damage", hint: "End of each turn: save or take damage; ends on a success",
    data: { event: ["turnEnd"], action: { type: "save", ability: "con", dc: "source",
      damage: { formula: "1d6", type: "poison", onSuccess: "none" } }, then: "removeOnSuccess" } },
  { icon: "fa-link-slash", label: "Ends when hurt", hint: "Ends as soon as the bearer takes damage",
    data: { event: ["damaged"], action: { type: "note" }, then: "remove" } },
  { icon: "fa-fire", label: "Ongoing damage", hint: "Damage at the start of each of its turns",
    data: { event: ["turnStart"], action: { type: "damage", formula: "1d6", damageType: "fire" }, then: "keep" } },
  { icon: "fa-hand-fist", label: "Punish attacks", hint: "When the bearer attacks, the source's activity hits it",
    data: { event: ["attack"], action: { type: "rollActivity", item: "", activity: "" }, then: "remove" } },
  { icon: "fa-clone", label: "Duplicates", hint: "Illusory duplicates may take hits instead",
    data: { event: ["hit"], action: { type: "duplicates", count: 3, threshold: 3 }, then: "keep" } }
];

/* -------------------------------------------- */
/*  Vocabulary: reactions                       */
/* -------------------------------------------- */

const WINDOWS = [
  ["hitBy", "fa-shield-halved", "Hit by an attack", "self"],
  ["d20Succeeded", "fa-dice", "Succeeds on a roll", "other"],
  ["damageIncoming", "fa-heart-crack", "About to take damage", "self"],
  ["spellCast", "fa-hat-wizard", "Casts a spell", "other"],
  ["d20Rolling", "fa-scale-balanced", "Rolls with adv./disadv.", "any"],
  ["hitting", "fa-hand-fist", "You hit with an attack", "self"],
  ["d20Failed", "fa-dice-d20", "Fails a check (known DC)", "any"]
];
const WINDOW_VERB = {
  hitBy: ["are hit by an attack", "is hit by an attack"],
  d20Succeeded: ["succeed on an attack roll, ability check or saving throw", "succeeds on an attack roll, ability check or saving throw"],
  damageIncoming: ["are about to take damage", "is about to take damage"],
  spellCast: ["cast a spell", "casts a spell"],
  d20Rolling: ["are about to roll a d20 with advantage or disadvantage", "is about to roll a d20 with advantage or disadvantage"],
  hitting: ["hit with an attack", "hits with an attack"],
  d20Failed: ["fail an ability check", "fails an ability check"]
};
const WHO = [["self", "You"], ["other", "Another creature"], ["any", "Any creature"]];

const OUTCOMES = {
  acBonus: ["fa-shield", "Raise AC against it", ["hitBy"]],
  reroll: ["fa-rotate-left", "Force a reroll", ["hitBy", "d20Succeeded", "d20Failed"]],
  modifyRoll: ["fa-plus-minus", "Change the roll", ["hitBy", "d20Succeeded", "d20Failed"]],
  damage: ["fa-shield-heart", "Reduce the damage", ["damageIncoming"]],
  counter: ["fa-ban", "Counter the spell", ["spellCast"]],
  straight: ["fa-scale-balanced", "Cancel adv./disadv.", ["d20Rolling"]],
  damageNext: ["fa-bolt", "Change its damage", ["hitBy", "hitting"]],
  none: ["fa-hand-pointer", "Just use the item", ["hitBy", "d20Succeeded", "damageIncoming", "spellCast", "d20Rolling", "hitting", "d20Failed"]]
};
const DEFAULT_OUTCOMES = {
  acBonus: { type: "acBonus", value: 5 },
  reroll: { type: "reroll", keep: "lower" },
  modifyRoll: { type: "modifyRoll", bonus: "-1d6" },
  damage: { type: "damage", mode: "half" },
  counter: { type: "counter", ability: "con", dc: "source" },
  straight: { type: "straight" },
  damageNext: { type: "damageNext", mode: "add", formula: "(@castLevel + 1)d6", critDouble: true },
  none: { type: "none" }
};

/** Presets for an activity's area (its template). */
const AREA_PRESETS = [
  { icon: "fa-burst", label: "Save when it appears", hint: "Everyone inside saves (this activity's save); the area goes if instantaneous",
    data: { event: ["areaCreated"], action: { type: "useActivity", to: { who: "targets" } }, then: "keep" } },
  { icon: "fa-cloud", label: "Save on entering or ending a turn inside", hint: "Cloudkill-style: at most once per creature per turn",
    data: { event: ["areaEnter", "areaTurnEnd"], oncePerTurn: true, action: { type: "useActivity", to: { who: "targets" } }, then: "keep" } },
  { icon: "fa-person-walking-arrow-right", label: "Effect while inside", hint: "Give an effect on entering; remove conditions on leaving",
    data: { event: ["areaEnter"], action: { type: "giveEffect", effect: "", to: { who: "targets" } }, then: "keep" } }
];

const REACTION_PRESETS = [
  { icon: "fa-shield", label: "+AC when hit", hint: "Shield: +5 AC against the attack that hit you",
    data: { window: "hitBy", who: "self", outcome: { type: "acBonus", value: 5 } } },
  { icon: "fa-rotate-left", label: "Force a reroll", hint: "Silvery Barbs: an enemy you can see within 60 ft rerolls, keeps the lower",
    data: { window: "d20Succeeded", who: "other", range: 60, sight: true, filter: [{ k: "subjectIsEnemy", v: true }],
      outcome: { type: "reroll", keep: "lower" } } },
  { icon: "fa-ban", label: "Counter a spell", hint: "Counterspell: an enemy you can see saves or its spell fails",
    data: { window: "spellCast", who: "other", range: 60, sight: true, filter: [{ k: "subjectIsEnemy", v: true }],
      outcome: { type: "counter", ability: "con", dc: "source" } } },
  { icon: "fa-snowflake", label: "Resist elements", hint: "Absorb Elements: resistance to the incoming elemental damage",
    data: { window: "damageIncoming", who: "self", outcome: { type: "damage", mode: "resist",
      types: ["acid", "cold", "fire", "lightning", "thunder"] } } },
  { icon: "fa-person-running", label: "Halve damage", hint: "Uncanny Dodge: halve the incoming damage",
    data: { window: "damageIncoming", who: "self", outcome: { type: "damage", mode: "half" } } },
  { icon: "fa-minus", label: "Lower a roll", hint: "Cutting Words: subtract a die from a creature's roll",
    data: { window: "d20Succeeded", who: "other", range: 60, sight: true, filter: [{ k: "subjectIsEnemy", v: true }],
      outcome: { type: "modifyRoll", bonus: "-1d6" } } }
];

/* -------------------------------------------- */
/*  Conditions ("Only if")                      */
/* -------------------------------------------- */

/*
 * A field describes one thing a condition can test.
 *   kind: number | select | bool | status (has / doesn't have) | listStatus (includes) | listDamage (includes)
 *   key:  data path, or a function of the chosen status for status fields (match: regex to read it back)
 *   on:   events / windows where the field exists (omit = always)
 */
const ATTACK_EVENTS = ["attack", "hit"];
const TRIGGER_FIELDS = [
  { id: "bearerStatus", label: "The bearer has a condition", kind: "status",
    key: s => `bearer.statuses.${s}`, match: /^bearer\.statuses\.([\w-]+)$/ },
  { id: "bearerHp", label: "The bearer's HP (%)", kind: "number", key: "bearer.attributes.hp.pct" },
  { id: "attackType", label: "The attack is", kind: "select", key: "activity.attack.type.value", on: ATTACK_EVENTS,
    entries: () => [["melee", "Melee"], ["ranged", "Ranged"]] },
  { id: "attackKind", label: "The attack kind is", kind: "select", key: "activity.attack.type.classification",
    on: ATTACK_EVENTS, entries: () => [["weapon", "Weapon attack"], ["spell", "Spell attack"], ["unarmed", "Unarmed strike"]] },
  { id: "spellLevel", label: "Spell level", kind: "number", key: "item.level", on: ["attack", "hit", "spell", "activity"] },
  { id: "spellClass", label: "The spell's class is", kind: "select", key: "item.classIdentifier", on: ["attack", "hit", "spell", "activity"], entries: classEntries },
  { id: "proficient", label: "It's a weapon the attacker is proficient with", kind: "yes1", key: "item.prof.multiplier", on: ATTACK_EVENTS },
  { id: "distance", label: "The attacker's distance (ft)", kind: "number", key: "distance", on: ["hit"] },
  { id: "spellSchool", label: "Spell school", kind: "select", key: "item.school", on: ["attack", "hit", "spell", "activity"],
    entries: schoolEntries },
  { id: "attackerStatus", label: "The attacker has a condition", kind: "status", on: ["hit"],
    key: s => `statuses.${s}`, match: /^statuses\.([\w-]+)$/ },
  { id: "attackerBlindsight", label: "The attacker's blindsight (ft)", kind: "number", on: ["hit"],
    key: "attributes.senses.ranges.blindsight", missingIsZero: true },
  { id: "attackerTruesight", label: "The attacker's truesight (ft)", kind: "number", on: ["hit"],
    key: "attributes.senses.ranges.truesight", missingIsZero: true },
  { id: "moved", label: "Distance of this move (ft)", kind: "number", key: "moved", on: ["moved"] },
  { id: "movedThisTurn", label: "Distance moved this turn (ft)", kind: "number", key: "movedThisTurn", on: ["moved"] },
  { id: "ownTurn", label: "It is the bearer's own turn", kind: "bool", key: "ownTurn", on: ["moved"] },
  { id: "gained", label: "The condition gained", kind: "listStatus", key: "gainedStatuses", on: ["statusGained"] },
  { id: "amount", label: "Damage taken / dealt", kind: "number", key: "amount", on: ["damaged", "dealt"] },
  { id: "sourceSpellLevel", label: "The spell level", kind: "number", key: "spellLevel", on: ["missed", "dealt", "damageRolled"] },
  { id: "sourceIsSpell", label: "It's a spell", kind: "bool", key: "isSpell", on: ["missed", "dealt", "damageRolled"] },
  { id: "sourceActivityType", label: "The activity's type", kind: "select", key: "activity.type", on: ["missed", "dealt", "damageRolled", "attack", "hit"],
    entries: () => Object.keys(CONFIG.DND5E.activityTypes).map(k => [k, k.charAt(0).toUpperCase() + k.slice(1)]) },
  { id: "duplicateDice", label: "Two dice show the same number", kind: "bool", key: "duplicateDice", on: ["damageRolled"] },
  { id: "criticalDamage", label: "It's a critical hit", kind: "bool", key: "critical", on: ["damageRolled"] },
  { id: "sourceTurn", label: "It's the source's turn (or no combat)", kind: "bool", key: "sourceTurn" },
  { id: "bearerTurn", label: "It's the bearer's own turn (or no combat)", kind: "bool", key: "bearerTurn" },
  { id: "subjectIsAlly", label: "The creature is the bearer or its ally", kind: "bool", key: "subjectIsAlly",
    on: ["areaEnter", "areaLeave", "areaTurnStart", "areaTurnEnd", "collided", "hit", "damaged", "dealt"] },
  { id: "subjectIsEnemy", label: "The creature is hostile to the bearer", kind: "bool", key: "subjectIsEnemy",
    on: ["areaEnter", "areaLeave", "areaTurnStart", "areaTurnEnd", "collided", "hit", "damaged", "dealt"] },
  { id: "bearerHpValue", label: "The bearer's HP", kind: "number", key: "bearer.attributes.hp.value" },
  { id: "subjectIsSource", label: "The creature is the effect's source", kind: "bool", key: "subjectIsSource",
    on: ["areaEnter", "areaLeave", "areaTurnStart", "areaTurnEnd", "collided", "hit", "damaged"] },
  { id: "subjectIsSummoner", label: "The creature is the bearer's summoner", kind: "bool", key: "subjectIsSummoner",
    on: ["areaEnter", "areaLeave", "areaTurnStart", "areaTurnEnd", "collided", "hit", "damaged"] },
  { id: "sourceHasDamage", label: "It deals damage", kind: "bool", key: "hasDamage", on: ["missed"] },
  { id: "sourceIdentifier", label: "The item's identifier is", kind: "text", key: "identifier", on: ["missed", "dealt", "damageRolled"] },
  { id: "missedAttackType", label: "The attack is", kind: "select", key: "attackType", on: ["missed", "damageRolled"],
    entries: () => [["melee", "Melee"], ["ranged", "Ranged"]] },
  { id: "saveAbility", label: "The save is", kind: "select", key: "ability", on: ["save"], entries: abilityEntries },
  { id: "longRest", label: "It was a long rest", kind: "bool", key: "longRest", on: ["rest"] },
  { id: "shortRest", label: "It was a short rest", kind: "bool", key: "shortRest", on: ["rest"] },
  { id: "hitAttackType", label: "The attack that hit is", kind: "select", key: "attackType", on: ["hit"],
    entries: () => [["melee", "Melee"], ["ranged", "Ranged"]] },
  { id: "activityType", label: "The activity type is", kind: "select", key: "activityType", on: ["spell", "activity"],
    entries: () => Object.keys(CONFIG.DND5E.activityTypes).map(k => [k, k.charAt(0).toUpperCase() + k.slice(1)]) }
];
const MODIFIER_FIELDS = [
  { id: "selfStatus", label: "The bearer has a condition", kind: "status",
    key: s => `statuses.${s}`, match: /^statuses\.([\w-]+)$/ },
  { id: "sourceStatus", label: "The source has a condition", kind: "status",
    key: s => `source.statuses.${s}`, match: /^source\.statuses\.([\w-]+)$/ },
  { id: "event", label: "The trigger was", kind: "select", key: "event",
    entries: () => EVENT_GROUPS.flatMap(g => g.events.map(([id, label]) => [id, label])) }
];
const REACTION_FIELDS = [
  { id: "enemy", label: "The creature is hostile to you", kind: "bool", key: "subjectIsEnemy" },
  { id: "reactorStatus", label: "You have a condition", kind: "status",
    key: s => `reactor.statuses.${s}`, match: /^reactor\.statuses\.([\w-]+)$/ },
  { id: "attackTotal", label: "The attack roll total", kind: "number", key: "total", on: ["hitBy"] },
  { id: "ac", label: "The target's AC", kind: "number", key: "ac", on: ["hitBy"] },
  { id: "attackerStatus", label: "The attacker has a condition", kind: "status", on: ["hitBy"],
    key: s => `attacker.statuses.${s}`, match: /^attacker\.statuses\.([\w-]+)$/ },
  { id: "rollKind", label: "The roll is", kind: "select", key: "kind", on: ["d20Succeeded"],
    entries: () => [["attack", "An attack roll"], ["save", "A saving throw"], ["check", "An ability check"]] },
  { id: "rollTotal", label: "The roll total", kind: "number", key: "total", on: ["d20Succeeded"] },
  { id: "dc", label: "The DC", kind: "number", key: "dc", on: ["d20Succeeded"] },
  { id: "damageTotal", label: "The damage amount", kind: "number", key: "total", on: ["damageIncoming"] },
  { id: "damageTypes", label: "The damage types", kind: "listDamage", key: "types", on: ["damageIncoming"] },
  { id: "ally", label: "The creature is you or an ally", kind: "bool", key: "subjectIsAlly" },
  { id: "hitMelee", label: "Your attack is", kind: "select", key: "attackType", on: ["hitting"], entries: () => [["melee", "Melee"], ["ranged", "Ranged"]] },
  { id: "hitKind", label: "Your attack kind is", kind: "select", key: "classification", on: ["hitting"],
    entries: () => [["weapon", "Weapon attack"], ["spell", "Spell attack"], ["unarmed", "Unarmed strike"]] },
  { id: "hitCrit", label: "It's a critical hit", kind: "bool", key: "critical", on: ["hitting"] },
  { id: "hitAdvantage", label: "It had Advantage", kind: "bool", key: "advantage", on: ["hitting"] },
  { id: "reactorStatus", label: "You have a condition", kind: "status", key: s => `reactor.statuses.${s}`, match: /^reactor\.statuses\.([\w-]+)$/ },
  { id: "hitDisadvantage", label: "It had Disadvantage", kind: "bool", key: "disadvantage", on: ["hitting"] },
  { id: "hitAllyNear", label: "An ally is within 5 ft of the target", kind: "bool", key: "allyNearTarget", on: ["hitting"] },
  { id: "dmgFromAttack", label: "It comes from an attack", kind: "bool", key: "fromAttack", on: ["damageIncoming"] },
  { id: "checkProficient", label: "The check uses a proficient skill or tool", kind: "bool", key: "proficient", on: ["d20Failed"] },
  { id: "targetType", label: "The target's creature type", kind: "select", key: "targetType", on: ["hitting"], entries: creatureTypeEntries },
  { id: "spellLevel", label: "The spell's level", kind: "number", key: "level", on: ["spellCast"] },
  { id: "hasComponents", label: "The spell has components (not Subtle)", kind: "bool", key: "hasComponents", on: ["spellCast"] },
  { id: "advantage", label: "The roll has advantage", kind: "bool", key: "advantage", on: ["d20Rolling"] },
  { id: "disadvantage", label: "The roll has disadvantage", kind: "bool", key: "disadvantage", on: ["d20Rolling"] },
  { id: "spellName", label: "The spell's name", kind: "text", key: "name", on: ["spellCast"] },
  { id: "spellId", label: "The spell's identifier", kind: "text", key: "identifier", on: ["spellCast"] },
  { id: "targetsMe", label: "The spell targets you", kind: "bool", key: "targetsMe", on: ["spellCast"] }
];

const OPS = {
  number: [["gte", "is at least"], ["gt", "is more than"], ["lte", "is at most"], ["lt", "is less than"], ["exact", "is exactly"]],
  select: [["exact", "is"], ["not", "is not"]],
  bool: [["exact", "is"]],
  yes1: [["exact", "is"]],
  text: [["exact", "is"], ["not", "is not"]],
  status: [["has", "has"], ["not", "doesn't have"]],
  listStatus: [["has", "includes"], ["not", "doesn't include"]],
  listDamage: [["has", "include"], ["not", "don't include"]],
  custom: [["exact", "equals"], ["not", "does not equal"], ["gte", "is at least"], ["gt", "is more than"],
    ["lte", "is at most"], ["lt", "is less than"], ["has", "contains"]]
};

function fieldValueEntries(field) {
  switch ( field.kind ) {
    case "select": return field.entries();
    case "bool": case "yes1": return [["true", "Yes"], ["false", "No"]];
    case "status": case "listStatus": return statusEntries();
    case "listDamage": return damageEntries();
    default: return null;
  }
}

function availableFields(catalogue, context) {
  return catalogue.filter(f => !f.on || !context.length || f.on.some(e => context.includes(e)));
}

function newRow(catalogue, context) {
  const field = availableFields(catalogue, context)[0] ?? catalogue[0];
  return { field: field.id, op: OPS[field.kind][0][0], value: fieldValueEntries(field)?.[0]?.[0] ?? "" };
}

/** A condition row → a dnd5e.Filter entry. */
function rowToFilter(row, catalogue) {
  if ( row.field === "raw" ) return row.raw;
  const field = catalogue.find(f => f.id === row.field);
  const numeric = v => (typeof v === "boolean") ? v : (v === "true") ? true : (v === "false") ? false
    : ((v !== "") && Number.isFinite(Number(v))) ? Number(v) : v;
  let entry;
  if ( !field ) {
    const o = row.op === "not" ? "exact" : row.op;
    entry = { k: row.key ?? "", o, v: numeric(row.value) };
    return row.op === "not" ? { o: "NOT", v: entry } : entry;
  }
  switch ( field.kind ) {
    case "status": entry = { k: field.key(row.value), o: "gte", v: 1 }; break;
    case "listStatus": case "listDamage": entry = { k: field.key, o: "has", v: row.value }; break;
    case "bool": entry = { k: field.key, v: row.value === "true" }; break;
    case "yes1":
      entry = { k: field.key, o: "gte", v: 1 };
      return row.value === "true" ? entry : { o: "NOT", v: entry };
    case "number":
      // For values that may be missing and then mean 0 (a creature with no blindsight), "at most" / "less than" are
      // written as NOT "more than" / NOT "at least", so a missing value passes, the way a person reads it.
      if ( field.missingIsZero && (row.op === "lte") ) return { o: "NOT", v: { k: field.key, o: "gt", v: Number(row.value) } };
      if ( field.missingIsZero && (row.op === "lt") ) return { o: "NOT", v: { k: field.key, o: "gte", v: Number(row.value) } };
      entry = { k: field.key, o: row.op, v: Number(row.value) };
      break;
    default: entry = { k: field.key, v: row.value };
  }
  return row.op === "not" ? { o: "NOT", v: entry } : entry;
}

/** A dnd5e.Filter entry → a condition row (unknown shapes become "raw"). */
function filterToRow(entry, catalogue) {
  let negate = false;
  let e = entry;
  if ( (e?.o === "NOT") && e.v && !Array.isArray(e.v) && ("k" in e.v) ) {
    negate = true;
    e = e.v;
  }
  if ( !e || !("k" in e) ) return { field: "raw", raw: entry };
  const o = e.o ?? "exact";
  for ( const field of catalogue ) {
    if ( field.kind === "status" ) {
      const m = field.match.exec(e.k);
      if ( m && (o === "gte") && (Number(e.v) === 1) ) return { field: field.id, op: negate ? "not" : "has", value: m[1] };
      continue;
    }
    if ( e.k !== field.key ) continue;
    if ( ["listStatus", "listDamage"].includes(field.kind) && (o === "has") ) {
      return { field: field.id, op: negate ? "not" : "has", value: e.v };
    }
    if ( field.kind === "number" ) {
      const op = negate ? { gt: "lte", gte: "lt" }[o] : (OPS.number.some(([id]) => id === o) ? o : null);
      if ( op ) return { field: field.id, op, value: e.v };
    }
    if ( (field.kind === "bool") && !negate && (o === "exact") ) return { field: field.id, op: "exact", value: String(!!e.v) };
    if ( (field.kind === "yes1") && (o === "gte") && (Number(e.v) === 1) ) return { field: field.id, op: "exact", value: String(!negate) };
    if ( ["select", "text"].includes(field.kind) && (o === "exact") ) return { field: field.id, op: negate ? "not" : "exact", value: e.v };
  }
  if ( negate && (o !== "exact") ) return { field: "raw", raw: entry };
  return { field: "custom", key: e.k, op: negate ? "not" : o, value: e.v };
}

/** A catalogue with the fields that belong to these events first (several fields can share a key, e.g. distance). */
function fieldsFor(catalogue, events) {
  const rank = f => (!f.on ? 1 : (f.on.some(e => events.includes(e)) ? 0 : 2));
  return [...catalogue].sort((a, b) => rank(a) - rank(b));
}

function filterToRows(filter, catalogue) {
  if ( !filter || foundry.utils.isEmpty(filter) ) return [];
  const list = Array.isArray(filter) ? filter : [filter];
  return list.map(entry => filterToRow(entry, catalogue));
}

function rowsToFilter(rows, catalogue) {
  const list = (rows ?? []).map(r => rowToFilter(r, catalogue));
  return list.length ? list : undefined;
}

function describeRow(row, catalogue) {
  if ( row.field === "raw" ) return describeRawFilter(row.raw, catalogue);
  const field = catalogue.find(f => f.id === row.field);
  const opLabel = (OPS[field?.kind ?? "custom"].find(([id]) => id === row.op) ?? [, row.op])[1];
  if ( !field ) return `“${row.key}” ${opLabel} ${row.value}`;
  const valueLabel = (fieldValueEntries(field)?.find(([id]) => String(id) === String(row.value)) ?? [, row.value])[1];
  let lower = field.label.charAt(0).toLowerCase() + field.label.slice(1);
  const unit = / \((ft|%)\)$/.exec(lower)?.[1];
  if ( unit ) lower = lower.replace(/ \((ft|%)\)$/, "");
  const shown = unit ? `${valueLabel}${unit === "ft" ? " ft" : "%"}` : valueLabel;
  switch ( field.kind ) {
    case "status": if ( /^you have/.test(lower) ) return `you ${row.op === "not" ? "don't have" : "have"} ${valueLabel}`;
      return `${lower.replace(/ has a condition$/, "")} ${row.op === "not" ? "doesn't have" : "has"} ${valueLabel}`;
    case "bool": case "yes1": {
      if ( row.value === "true" ) return lower;
      if ( / is /.test(lower) ) return lower.replace(/ is /, " isn't ");
      if ( /^it's /.test(lower) ) return lower.replace(/^it's /, "it isn't ");
      return `not ${lower}`;
    }
    default: {
      // Labels like "The attack is" already carry the verb: "the attack is melee", not "the attack is is melee".
      const base = /^(is|is not|was)\b/.test(opLabel) ? lower.replace(/ (is|was)$/, "") : lower;
      return `${base} ${opLabel} ${shown}`;
    }
  }
}

/** A filter entry the rows can't show directly (OR / AND / NOT groups) in words, as far as possible. */
function describeRawFilter(entry, catalogue) {
  if ( Array.isArray(entry) ) return entry.map(e => describeRawFilter(e, catalogue)).join(" and ");
  if ( (entry?.o === "OR") || (entry?.o === "AND") ) {
    const parts = (Array.isArray(entry.v) ? entry.v : [entry.v]).map(e => describeRawFilter(e, catalogue));
    return `(${parts.join(entry.o === "OR" ? " or " : " and ")})`;
  }
  if ( entry?.o === "NOT" ) return `not ${describeRawFilter(entry.v, catalogue)}`;
  if ( (entry?.k === "weaponProperties") && (entry.o === "has") ) {
    return `the weapon is ${(CONFIG.DND5E.itemProperties?.[entry.v]?.label ?? entry.v).toLowerCase()}`;
  }
  if ( entry && ("k" in entry) ) {
    const row = filterToRow(entry, catalogue);
    if ( row.field !== "raw" ) return describeRow(row, catalogue);
  }
  return "a custom condition";
}

/* -------------------------------------------- */
/*  Models: triggers                            */
/* -------------------------------------------- */

function triggerToModel(trigger) {
  const { event, filter, action = {}, then = "keep", label = "", ...extra } = clone(trigger);
  const { modifiers, ...rest } = action;
  const actionModel = { ...rest };
  const model = {
    events: Array.isArray(event) ? event : (event ? [event] : []),
    rows: filterToRows(filter, fieldsFor(TRIGGER_FIELDS, Array.isArray(event) ? event : [event])),
    action: actionModel,
    mods: [],
    then, label, extra
  };
  for ( const mod of (Array.isArray(modifiers) ? modifiers : (modifiers ? [modifiers] : [])) ) {
    const rows = filterToRows(mod.filter, MODIFIER_FIELDS);
    for ( const kind of ["advantage", "disadvantage", "bonus", "dc"] ) {
      if ( !mod[kind] ) continue;
      model.mods.push({ kind, value: typeof mod[kind] === "boolean" ? "" : String(mod[kind]), rows: clone(rows),
        label: mod.label ?? "" });
    }
  }
  return model;
}

function modelToTrigger(model) {
  const out = { ...clone(model.extra) };
  if ( model.label?.trim() ) out.label = model.label.trim();
  out.event = model.events.length === 1 ? model.events[0] : [...model.events];
  const filter = rowsToFilter(model.rows, TRIGGER_FIELDS);
  if ( filter ) out.filter = filter;
  const action = clone(model.action);
  if ( action.type === "save" ) {
    const mods = model.mods.map(m => {
      const mod = {};
      if ( (m.kind === "advantage") || (m.kind === "disadvantage") ) mod[m.kind] = true;
      else mod[m.kind] = String(m.value ?? "").trim();
      const f = rowsToFilter(m.rows, MODIFIER_FIELDS);
      if ( f ) mod.filter = f;
      if ( m.label?.trim() ) mod.label = m.label.trim();
      return mod;
    });
    if ( mods.length ) action.modifiers = mods;
  }
  out.action = action;
  if ( model.then && (model.then !== "keep") ) out.then = model.then;
  return out;
}

function validateTrigger(model) {
  const errors = [];
  const a = model.action;
  if ( !model.events.length ) errors.push("Pick at least one moment under “When”.");
  switch ( a.type ) {
    case "save":
      if ( !(a.ability in CONFIG.DND5E.abilities) ) errors.push("Choose which ability the save uses.");
      if ( !["source", "sourceSpell"].includes(a.dc) && !Number.isFinite(Number(a.dc)) && !formulaOk(a.dc) ) errors.push("The save DC must be a number or a formula.");
      if ( a.damage && !formulaOk(a.damage.formula) ) errors.push("The failed-save damage needs a valid formula, e.g. 2d6.");
      for ( const m of model.mods ) {
        if ( ["bonus", "dc"].includes(m.kind) && !formulaOk(m.value) ) errors.push("A save modifier needs a value, e.g. 2 or -1d4.");
      }
      break;
    case "damage":
      if ( !formulaOk(a.formula) ) errors.push("The damage needs a valid formula, e.g. 2d6 or 1d8 + 3.");
      break;
    case "rollActivity":
      if ( !a.item?.trim() || !a.activity?.trim() ) errors.push("Choose the item and the activity to roll.");
      break;
    case "giveEffect":
      if ( !String(a.effect ?? "").trim() ) errors.push("Choose which effect to give.");
      errors.push(...selectorErrors(a.to));
      break;
    case "removeStatus":
      if ( !a.statuses?.length ) errors.push("Pick at least one condition to end.");
      errors.push(...selectorErrors(a.to));
      break;
    case "inspire": case "swapInitiative":
      errors.push(...selectorErrors(a.to));
      break;
    case "tempHp":
      if ( !formulaOk(a.formula) ) errors.push("Temporary HP needs a formula, e.g. 1d10 + 5.");
      break;
    case "recoverSlots":
      if ( !formulaOk(a.budget) ) errors.push("Slot recovery needs a budget, e.g. ceil(@classes.wizard.levels / 2).");
      if ( (a.maxSlots !== undefined) && (a.maxSlots !== null) && (a.maxSlots !== "") && !(Number(a.maxSlots) >= 1) ) errors.push("Slot recovery: the slot count must be 1 or more, or blank.");
      break;
    case "useActivity": case "spendHitDie": break;
    case "drainMaxHp":
      if ( !formulaOk(a.amount) ) errors.push("Reduce max HP: an amount, e.g. @amount (the damage dealt).");
      break;
    case "repeatActivity":
      if ( !formulaOk(a.max) ) errors.push("Attack a new target: how many times, e.g. 1 or @spellLevel.");
      errors.push(...selectorErrors(a.to));
      break;
    case "storeSpell":
      if ( (a.attack !== undefined) && (a.attack !== "") && !Number.isFinite(Number(a.attack)) ) errors.push("Store a spell: the attack bonus must be a number or blank.");
      if ( (a.dc !== undefined) && (a.dc !== "") && !Number.isFinite(Number(a.dc)) ) errors.push("Store a spell: the DC must be a number or blank.");
      break;
    case "activityDamage":
      if ( !(Number(a.multiplier) > 0) ) errors.push("Its own damage: the multiplier must be above 0 (0.5 = half).");
      break;
    case "toggleLight":
      if ( !(Number(a.bright) >= 0) || !(Number(a.dim) >= 0) ) errors.push("The light's radii must be numbers.");
      break;
    case "random":
      if ( !formulaOk(a.formula) ) errors.push("Roll on a table: a die to roll, e.g. 1d8.");
      if ( !a.results?.length ) errors.push("Roll on a table: add at least one row.");
      for ( const r of a.results ?? [] ) {
        if ( !/^\s*\d+\s*(-\s*\d+\s*)?$/.test(String(r.roll ?? "")) ) errors.push("Roll on a table: each row needs a number or a range like 2-3.");
        if ( !String(r.effect ?? "").trim() ) errors.push("Roll on a table: each row needs an effect.");
      }
      if ( a.to ) errors.push(...selectorErrors(a.to));
      break;
    case "teleport":
      if ( !(Number(a.range) > 0) ) errors.push("Teleport: the range must be a number of feet.");
      if ( a.to ) errors.push(...selectorErrors(a.to));
      break;
    case "push":
      if ( !Number(a.distance) ) errors.push("Push or pull: a distance in feet (negative pulls).");
      if ( a.to ) errors.push(...selectorErrors(a.to));
      break;
    case "sense":
      if ( !(Number(a.range) > 0) ) errors.push("Sense: the range must be a number of feet.");
      if ( (a.creatures === undefined) && (a.items !== "magic") ) errors.push("Sense: choose creatures, magic, or both.");
      break;
    case "duplicates":
      if ( !(Number(a.count) >= 1) ) errors.push("Duplicates: the count must be 1 or more.");
      if ( !(Number(a.threshold) >= 1 && Number(a.threshold) <= 6) ) errors.push("Duplicates: the target number must be 1–6.");
      break;
    case "restoreDuplicates":
      if ( !(Number(a.count) >= 1) ) errors.push("Restore duplicates: the count must be 1 or more.");
      break;
    case "note": break;
    default: errors.push("Choose what happens under “Do”.");
  }
  if ( !thenEntries(a.type).some(([id]) => id === model.then) ) errors.push("Choose what happens to the effect afterwards.");
  errors.push(...rowErrors([...model.rows, ...model.mods.flatMap(m => m.rows)]));
  return errors;
}

function selectorErrors(sel) {
  if ( !sel ) return [];
  if ( ["choose", "all"].includes(sel.who ?? "choose") && (sel.range !== undefined) && (sel.range !== "")
    && !(Number(sel.range) >= 0) ) return ["The range must be a number of feet."];
  return [];
}

function rowErrors(rows) {
  const errors = [];
  for ( const row of rows ) {
    if ( (row.field === "custom") && !String(row.key ?? "").trim() ) errors.push("A custom condition needs a data path.");
    const field = [...TRIGGER_FIELDS, ...MODIFIER_FIELDS, ...REACTION_FIELDS].find(f => f.id === row.field);
    if ( (field?.kind === "number") && !Number.isFinite(Number(row.value)) ) errors.push(`“${field.label}” needs a number.`);
  }
  return [...new Set(errors)];
}

/** One-sentence summary of an engine-format trigger. */
export function describeTrigger(trigger) {
  const model = triggerToModel(trigger);
  return describeTriggerModel(model);
}

function describeTriggerModel(model) {
  const a = model.action;
  const when = model.events.length ? model.events.map(e => EVENT_PHRASE[e] ?? e).join(", or ") : "(no moment chosen)";
  const cond = model.rows.length ? `, if ${model.rows.map(r => describeRow(r, TRIGGER_FIELDS)).join(" and ")}` : "";
  let what;
  switch ( a.type ) {
    case "save": {
      const dc = a.dc === "source" ? "the source's DC" : (a.dc === "sourceSpell" ? "the source's spell save DC" : `DC ${a.dc}`);
      const mods = model.mods.map(m => m.kind === "advantage" ? "with advantage" : m.kind === "disadvantage"
        ? "with disadvantage" : m.kind === "bonus" ? `${String(m.value).startsWith("-") ? "" : "+"}${m.value} to the roll`
          : `DC ${String(m.value).startsWith("-") ? "" : "+"}${m.value}`);
      what = `${a.to ? `${describeSelector(a.to, { you: "the bearer" })}: ` : ""}${abilityAbbr(a.ability)} save against ${dc}${mods.length ? ` (${mods.join(", ")})` : ""}`;
      if ( a.failStatus ) what += `; on a failure ${statusLabel(a.failStatus)} until the ${/End$/.test(a.failUntil ?? "") ? "end" : "start"} of ${/^source/.test(a.failUntil ?? "") ? "the source's" : "its"} next turn`;
      if ( a.damage?.formula ) what += `; on a failure ${a.damage.formula} ${damageLabel(a.damage.type).toLowerCase()} damage`
        + (a.damage.onSuccess === "half" ? " (half on a success)" : "");
      break;
    }
    case "damage": what = `${a.formula} ${damageLabel(a.damageType).toLowerCase()} damage to ${a.to ? describeSelector(a.to, { you: "the bearer" }) : "the bearer"}`; break;
    case "giveEffect": what = `“${a.effect || "?"}” goes to ${describeSelector(a.to, { you: "the bearer" })}`; break;
    case "removeStatus": what = `end ${a.choose ? "one of " : ""}${(a.statuses ?? []).map(statusLabel).join(" / ") || "?"} on ${describeSelector(a.to, { you: "the bearer" })}`; break;
    case "inspire": what = `Heroic Inspiration for ${describeSelector(a.to, { you: "the bearer" })}`; break;
    case "swapInitiative": what = `the bearer may swap initiative with ${describeSelector(a.to, { you: "the bearer" })}`; break;
    case "tempHp": what = `${String(a.formula).trim() === "@amount" ? "temporary HP equal to the damage" : `${a.formula} temporary HP`}${a.to ? ` for ${describeSelector(a.to, { you: "the bearer" })}` : ""}`; break;
    case "recoverSlots": what = Number(a.maxSlots) === 1
      ? `recover one expended spell slot of level ${Math.min(Number(a.maxLevel ?? 5), Number(a.budget) || 9)} or lower`
      : `recover spell slots worth up to ${a.budget} levels (none above level ${a.maxLevel ?? 5}${a.maxSlots ? `, at most ${a.maxSlots} slots` : ""})`; break;
    case "spendHitDie": what = `${describeSelector(a.to ?? { who: "targets" }, { you: "the bearer" })} spend a Hit Point Die and heal that much`; break;
    case "useActivity": if ( a.consume ) { what = `the bearer uses ${a.activity ? `“${a.activity}”` : "it"} (paying its cost)`; break; }
      what = `${a.activity ? `“${a.activity}”` : "its own save"} is used on ${a.to ? describeSelector(a.to, { you: "the bearer" }) : "the creatures it concerns"}`; break;
    case "drainMaxHp": what = `${a.to ? describeSelector(a.to, { you: "the bearer" }) : "the damaged creature"} loses ${String(a.amount ?? "@amount") === "@amount" ? "that much" : a.amount} Hit Point maximum${a.until === "never" ? "" : " until a Long Rest"}`; break;
    case "repeatActivity": what = `the same attack against ${describeSelector(a.to ?? {}, { you: "the bearer" })}, up to ${a.max ?? 1} time(s) per use`; break;
    case "storeSpell": what = `store one of the bearer's ${(a.schools ?? []).map(s => s === "specialist" ? "specialty-school" : (CONFIG.DND5E.spellSchools[s]?.label ?? s)).join(" / ") || "any"} spells (a slot is spent)${a.attack !== undefined && a.attack !== "" ? `; cast later at +${a.attack}` : ""}${a.dc !== undefined && a.dc !== "" ? ` / DC ${a.dc}` : ""}`; break;
    case "activityDamage": what = `${Number(a.multiplier) === 0.5 ? "half" : `×${a.multiplier}`} of that attack or spell's own damage to the creature it was aimed at`; break;
    case "toggleLight": what = `the bearer's light turns on or off (${a.bright}/${a.dim} ft)`; break;
    case "random": what = `roll ${a.formula || "?"}: ${(a.results ?? []).map(r => `${r.roll} → “${r.label || r.effect || "?"}”`).join(", ")}${a.to ? ` for ${describeSelector(a.to, { you: "the bearer" })}` : ""}`; break;
    case "teleport": what = `${a.to ? describeSelector(a.to, { you: "the bearer" }) : "the bearer"} teleports up to ${a.range} ft${a.sight !== false ? " to a spot it can see" : ""}`; break;
    case "push": what = `${a.to ? describeSelector(a.to, { you: "the bearer" }) : "the creature concerned"} is ${Number(a.distance) < 0 ? "pulled" : "pushed"} ${Math.abs(Number(a.distance))} ft ${Number(a.distance) < 0 ? "toward" : "away from"} ${a.from === "source" ? "the source" : "the bearer"}`; break;
    case "sense": {
      const parts = [a.creatures !== undefined ? (a.creatures?.length ? "certain creatures" : "creatures") : "", a.items === "magic" ? "magic" : ""].filter(Boolean);
      what = `the bearer's player learns of ${parts.join(" and ") || "?"} within ${a.range} ft`; break;
    }
    case "rollActivity": what = `the source's “${a.activity || "?"}” (${a.item || "?"}) is rolled against the bearer`; break;
    case "note": what = model.then === "remove" ? "the effect ends" : "a chat message"; break;
    case "duplicates": what = `${a.count} duplicate${Number(a.count) === 1 ? "" : "s"} (a d6 each; ${a.threshold}+ and a duplicate takes the hit)`; break;
    case "restoreDuplicates": what = "lost duplicates come back"; break;
    default: what = "(nothing chosen)";
  }
  const then = {
    remove: (a.type === "note") ? "" : "; then the effect ends",
    removeOnSuccess: "; ends on a success", removeOnFailure: "; ends on a failure",
    removeWhenDepleted: "; ends when no duplicates are left"
  }[model.then] ?? "";
  const sentence = `${when}${cond}${model.extra?.oncePerTurn && !model.events.some(e => AREA_EVENT_IDS.includes(e)) ? " (at most once per turn)" : ""}: ${what}${then}.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/* -------------------------------------------- */
/*  Models: reactions                           */
/* -------------------------------------------- */

function reactionToModel(reaction) {
  const { window: win = "hitBy", filter, outcome = { type: "none" }, who, range, label = "", activity = "",
    configure = false, ...extra } = clone(reaction);
  const defaultWho = WINDOWS.find(w => w[0] === win)?.[3] ?? "self";
  return { window: win, rows: filterToRows(filter, REACTION_FIELDS), outcome, who: who ?? defaultWho,
    range: range ?? "", label, activity, configure, extra };
}

function modelToReaction(model) {
  const out = { ...clone(model.extra), window: model.window, who: model.who };
  if ( model.label?.trim() ) out.label = model.label.trim();
  if ( model.activity ) out.activity = model.activity;
  if ( (model.range !== "") && Number.isFinite(Number(model.range)) ) out.range = Number(model.range);
  const filter = rowsToFilter(model.rows, REACTION_FIELDS);
  if ( filter ) out.filter = filter;
  if ( model.configure ) out.configure = true;
  out.outcome = clone(model.outcome);
  return out;
}

function validateReaction(model) {
  const errors = [];
  const o = model.outcome;
  if ( !OUTCOMES[o.type]?.[2].includes(model.window) ) errors.push("Choose what the reaction does.");
  if ( (model.range !== "") && !(Number(model.range) >= 0) ) errors.push("The range must be a number of feet.");
  if ( (o.type === "acBonus") && !Number.isFinite(Number(o.value)) ) errors.push("The AC bonus must be a number.");
  if ( (o.type === "modifyRoll") && !formulaOk(o.bonus) ) errors.push("The roll change needs a formula, e.g. -1d6 or 2.");
  if ( (o.type === "damage") && (o.mode === "reduce") && !formulaOk(o.amount) ) errors.push("Say how much damage is reduced.");
  if ( (o.type === "damage") && (o.mode === "resist") && !o.types?.length ) errors.push("Pick the damage types resisted.");
  if ( (o.type === "counter") && (o.dc !== "source") && !Number.isFinite(Number(o.dc)) ) errors.push("The counter DC must be a number.");
  if ( (o.type === "damageNext") && !formulaOk(o.formula) ) errors.push("The damage change needs a formula, e.g. (@castLevel + 1)d6.");
  if ( model.extra?.after ) {
    const after = model.extra.after;
    if ( (after.type !== "useActivity") && !after.effect ) errors.push("Choose which effect to give afterwards.");
    if ( !["hit", "self"].includes(after.to?.who) ) errors.push(...selectorErrors(after.to));
  }
  errors.push(...rowErrors(model.rows));
  return errors;
}

export function describeReaction(reaction, item) {
  return describeReactionModel(reactionToModel(reaction), item);
}

function describeReactionModel(model, item) {
  const [you, them] = WINDOW_VERB[model.window] ?? ["react", "reacts"];
  const range = (model.range !== "") && (model.who !== "self") ? ` within ${model.range} ft` : "";
  const seen = (model.who !== "self") && model.extra?.sight ? " you can see" : "";
  const subject = model.who === "self" ? `you ${you}`
    : `${model.who === "any" ? "any creature" : "another creature"}${seen}${range} ${them}`;
  const cond = model.rows.length ? `, if ${model.rows.map(r => describeRow(r, REACTION_FIELDS)).join(" and ")}` : "";
  const o = model.outcome;
  let what;
  switch ( o.type ) {
    case "acBonus": what = `+${o.value} AC against that attack`; break;
    case "reroll": what = `force a reroll and keep the ${o.keep === "higher" ? "higher" : "lower"} result`; break;
    case "modifyRoll": what = `add ${o.bonus} to the roll`; break;
    case "damage":
      what = o.mode === "half" ? "halve the damage"
        : o.mode === "resist" ? `resistance to ${(o.types ?? []).map(damageLabel).join(", ").toLowerCase() || "?"} damage`
          : `reduce the damage by ${o.amount}${o.types?.length ? ` (${o.types.map(damageLabel).join(", ").toLowerCase()})` : ""}`;
      break;
    case "straight": what = "the roll ignores advantage and disadvantage (the first d20 counts)"; break;
    case "damageNext": what = `${o.mode === "reduce" ? "reduce" : "add"} ${o.formula}${o.damageType ? ` ${damageLabel(o.damageType).toLowerCase()}` : ""} ${o.mode === "reduce" ? "from" : "to"} that attack's damage${o.critDouble ? " (dice doubled on a critical hit)" : ""}`; break;
    case "counter": what = `the caster makes ${/^[aeiou]/i.test(abilityLabel(o.ability)) ? "an" : "a"} `
      + `${abilityAbbr(o.ability)} save against ${o.dc === "source" ? "your spell save DC" : `DC ${o.dc}`} or the spell fails`; break;
    default: what = model.extra?.detail ? `use the item (${model.extra.detail})` : "use the item";
  }
  const act = model.activity ? item?.system?.activities?.get(model.activity)?.name ?? model.activity : "";
  const g = model.extra?.after;
  const gName = g ? (item?.effects?.get(g.effect)?.name ?? g.effect) : "";
  const whom = to => to?.who === "hit" ? "the creature hit" : to?.who === "self" ? "you" : describeSelector(to);
  let grant = "";
  if ( g?.type === "useActivity" ) {
    const src = g.item ? `“${g.item}”` : `“${item?.system?.activities?.get(g.activity)?.name || "another activity"}”`;
    grant = `; then ${src} is used on ${whom(g.to)}${g.when === "zeroed" ? " if the damage was reduced to 0" : ""}`;
  } else if ( g ) grant = `; then “${gName}” goes to ${whom(g.to)}`;
  return `When ${subject}${cond}: ${what}${grant}${act ? ` (uses “${act}”)` : ""}.`;
}

/* -------------------------------------------- */
/*  The editor                                  */
/* -------------------------------------------- */

/** Actions offered in an activity's "right after it's used" steps. */
const ACTIVITY_ACTIONS = ["giveEffect", "removeStatus", "inspire", "tempHp", "damage", "spendHitDie", "recoverSlots", "storeSpell", "toggleLight",
  "random", "teleport", "push", "sense", "note"];

/** Activity setting "use it automatically when the only target is…" ↔ targetFilter. */
const TARGET_PICKS = {
  damaged: [{ k: "damaged", v: true }], healthy: [{ k: "damaged", v: false }],
  bloodied: [{ k: "bloodied", v: true }], unbloodied: [{ k: "bloodied", v: false }]
};
function targetPickOf(filter) {
  if ( !filter?.length ) return "";
  const json = JSON.stringify(filter);
  return Object.entries(TARGET_PICKS).find(([, f]) => JSON.stringify(f) === json)?.[0] ?? "custom";
}

/** onlyIf as "the target has condition X" (or custom). */
function onlyIfStatusOf(filter) {
  if ( !filter?.length ) return "";
  const m = filter.length === 1 ? String(filter[0].k ?? "").match(/^statuses\.([\w-]+)$/) : null;
  return m ? m[1] : "custom";
}

/** Effect rules ↔ effect flags. */
function readRules(effect) {
  const f = effect.flags?.[MODULE_ID] ?? {};
  return {
    noReactions: !!f.noReactions, noComponents: !!f.noComponents, askFirst: f.askFirst ?? "",
    ignoreDamageFrom: (f.ignoreDamageFrom ?? []).join(", "),
    attackAdd: [...(f.attackAbilities?.add ?? [])], attackProficient: !!f.attackAbilities?.proficient,
    attackOnly: [...(f.attackAbilitiesOnly ?? [])], minLevel: f.minLevel ?? "",
    saveDamageOnSave: f.saveDamage?.onSave ?? "", saveDamageLevel: f.saveDamage?.spellLevel ?? "",
    areaRadius: f.area?.radius ?? "", areaColor: f.area?.color ?? "#ff7a1a", stopOnCollision: !!f.stopOnCollision,
    evasion: [...(f.evasion ?? [])], ownRollsOnly: !!f.ownRollsOnly,
    attackedMode: f.attackedWith?.mode ?? "", attackedOnce: !!f.attackedWith?.once,
    attacksMode: f.attacksWith?.mode ?? "", attacksOnce: !!f.attacksWith?.once, disengaged: !!f.disengaged,
    extraAttack: f.extraAttack?.count ?? "", saveAdvStatuses: [...(f.saveAdvantageAgainst ?? [])], healingExtraDie: !!f.healingExtraDie,
    noHealing: !!f.noHealing, onlyIfStatus: onlyIfStatusOf(f.onlyIf), onlyIfRaw: f.onlyIf ?? null,
    dropSave: !!f.dropSave, dropAbility: f.dropSave?.ability ?? "con", dropDc: f.dropSave?.dc ?? "5 + @damage",
    dropRadiant: (f.dropSave?.unlessTypes ?? ["radiant"]).includes("radiant"), dropCrit: f.dropSave?.unlessCritical ?? true,
    reduceFormula: f.reduceDamage?.formula ?? "", reduceTypes: [...(f.reduceDamage?.types ?? [])], reduceOnce: !!f.reduceDamage?.oncePerTurn,
    diceMin: f.damageDice?.min ?? "", diceFilter: JSON.stringify(f.damageDice?.filter ?? []),
    attackedBySource: f.attackedWith?.by === "source",
    attackedTypes: [...(f.attackedWith?.attacker?.find?.(x => x.k === "details.type.value")?.v ?? [])],
    attacksUnlessSource: f.attacksWith?.unlessTarget === "source",
    lightBright: f.light?.bright ?? "", lightDim: f.light?.dim ?? "", lightColor: f.light?.color ?? "#ffe9a8",
    noSpells: !!f.noSpells,
    sustainEvents: [...(f.sustain?.events ?? [])], sustainFilter: JSON.stringify(f.sustain?.filter ?? [])
  };
}

/** JSON filter text from the rules form → a filter list (invalid or empty → null). */
function parseFilterText(text) {
  try {
    const v = JSON.parse(String(text ?? "").trim() || "[]");
    const list = Array.isArray(v) ? v : [v];
    return list.length ? list : null;
  } catch(err) { return null; }
}

/** Filter presets for the damageDice rule. */
const DICE_FILTERS = {
  "": [],
  gwf: [{ k: "roll.attack.type", v: "melee" }, { k: "roll.attack.classification", v: "weapon" },
    { o: "OR", v: [{ k: "roll.attack.mode", v: "twoHanded" }, { k: "item.properties", o: "has", v: "two" }] }]
};

function rulesUpdate(r) {
  const K = k => `flags.${MODULE_ID}.${k}`;
  const D = k => `flags.${MODULE_ID}.-=${k}`;
  const u = {};
  const set = (key, value, keep) => { if ( keep ) u[K(key)] = value; else u[D(key)] = null; };
  set("noReactions", true, r.noReactions);
  set("noComponents", true, r.noComponents);
  set("askFirst", String(r.askFirst ?? "").trim(), String(r.askFirst ?? "").trim());
  const ignore = String(r.ignoreDamageFrom ?? "").split(",").map(s => s.trim()).filter(Boolean);
  set("ignoreDamageFrom", ignore, ignore.length);
  set("attackAbilities", { add: r.attackAdd, proficient: !!r.attackProficient }, r.attackAdd?.length);
  set("attackAbilitiesOnly", r.attackOnly, r.attackOnly?.length);
  set("minLevel", Number(r.minLevel), Number(r.minLevel) > 0);
  const level = String(r.saveDamageLevel ?? "").trim();
  set("saveDamage", { onSave: r.saveDamageOnSave, ...(level !== "" ? { spellLevel: Number(level) } : {}) }, r.saveDamageOnSave);
  set("area", { radius: Number(r.areaRadius), color: r.areaColor || "#ff7a1a" }, Number(r.areaRadius) > 0);
  set("evasion", r.evasion, r.evasion?.length);
  set("ownRollsOnly", true, r.ownRollsOnly);
  set("attackedWith", { mode: r.attackedMode, ...(r.attackedOnce ? { once: true } : {}), ...(r.attackedBySource ? { by: "source" } : {}),
    ...(r.attackedTypes?.length ? { attacker: [{ k: "details.type.value", o: "in", v: [...r.attackedTypes] }] } : {}) }, r.attackedMode);
  set("attacksWith", { mode: r.attacksMode, ...(r.attacksOnce ? { once: true } : {}), ...(r.attacksUnlessSource ? { unlessTarget: "source" } : {}) }, r.attacksMode);
  const reduce = String(r.reduceFormula ?? "").trim();
  set("reduceDamage", { formula: reduce, ...(r.reduceTypes?.length ? { types: [...r.reduceTypes] } : {}), ...(r.reduceOnce ? { oncePerTurn: true } : {}) }, reduce);
  const diceFilter = parseFilterText(r.diceFilter);
  set("damageDice", { min: Number(r.diceMin), ...(diceFilter ? { filter: diceFilter } : {}) }, Number(r.diceMin) > 1);
  set("light", { bright: Number(r.lightBright) || 0, dim: Number(r.lightDim) || 0, color: r.lightColor || null },
    (Number(r.lightBright) > 0) || (Number(r.lightDim) > 0));
  set("noSpells", true, r.noSpells);
  const sustainFilter = parseFilterText(r.sustainFilter);
  set("sustain", { events: [...(r.sustainEvents ?? [])], ...(sustainFilter ? { filter: sustainFilter } : {}) }, r.sustainEvents?.length);
  set("disengaged", true, r.disengaged);
  set("extraAttack", { count: Number(r.extraAttack) }, Number(r.extraAttack) > 0);
  set("saveAdvantageAgainst", r.saveAdvStatuses, r.saveAdvStatuses?.length);
  set("healingExtraDie", true, r.healingExtraDie);
  set("stopOnCollision", true, r.stopOnCollision);
  set("noHealing", true, r.noHealing);
  const only = r.onlyIfStatus === "custom" ? r.onlyIfRaw : (r.onlyIfStatus ? [{ k: `statuses.${r.onlyIfStatus}`, o: "gt", v: 0 }] : null);
  set("onlyIf", only, only?.length);
  set("dropSave", { ability: r.dropAbility || "con", dc: r.dropDc || "5 + @damage", unlessTypes: r.dropRadiant ? ["radiant"] : [],
    unlessCritical: !!r.dropCrit, hp: 1 }, r.dropSave);
  return u;
}

const OPEN = new Map();

export class TriggerEditor extends ApplicationV2 {
  /**
   * @param {ActiveEffect|Item} document
   */
  constructor(document, opts={}) {
    const { activity, area, ...rest } = opts;
    super(rest);
    this.document = document;
    this.activity = activity ?? null;
    this.mode = activity ? (area ? "area" : "activity") : (document.documentName === "Item" ? "reactions" : "triggers");
    this.openKey = activity ? `${activity.uuid}${area ? "#area" : ""}` : document.uuid;
    this.#load();
  }

  static DEFAULT_OPTIONS = {
    classes: ["aet-editor"],
    window: { icon: "fa-solid fa-bolt", resizable: true },
    position: { width: 780, height: 820 },
    actions: {
      addPreset: TriggerEditor.#onAddPreset,
      addBlank: TriggerEditor.#onAddBlank,
      toggle: TriggerEditor.#onToggle,
      duplicate: TriggerEditor.#onDuplicate,
      remove: TriggerEditor.#onRemove,
      moveUp: TriggerEditor.#onMove,
      moveDown: TriggerEditor.#onMove,
      toggleEvent: TriggerEditor.#onToggleEvent,
      setAction: TriggerEditor.#onSetAction,
      setWindow: TriggerEditor.#onSetWindow,
      setOutcome: TriggerEditor.#onSetOutcome,
      addRow: TriggerEditor.#onAddRow,
      addResult: TriggerEditor.#onAddResult,
      removeResult: TriggerEditor.#onRemoveResult,
      removeRow: TriggerEditor.#onRemoveRow,
      addMod: TriggerEditor.#onAddMod,
      removeMod: TriggerEditor.#onRemoveMod,
      toggleType: TriggerEditor.#onToggleType,
      toggleStatus: TriggerEditor.#onToggleStatus,
      toggleAdvanced: TriggerEditor.#onToggleAdvanced,
      openArea: TriggerEditor.#onOpenArea,
      applyRaw: TriggerEditor.#onApplyRaw,
      save: TriggerEditor.#onSave,
      cancel: TriggerEditor.#onCancel
    }
  };

  /** Open (or focus) the editor for a document. */
  static open(document, { activity, area=false }={}) {
    const key = activity ? `${activity.uuid}${area ? "#area" : ""}` : document.uuid;
    const existing = OPEN.get(key);
    if ( existing?.rendered ) return existing.bringToFront();
    const app = new TriggerEditor(document, { activity, area });
    OPEN.set(key, app);
    return app.render({ force: true });
  }

  get title() {
    if ( this.mode === "activity" ) return `Automation — ${this.activity.name} (${this.document.name})`;
    if ( this.mode === "area" ) return `Area — ${this.activity.name} (${this.document.name})`;
    return `${this.mode === "reactions" ? "Reactions" : "Triggers"} — ${this.document.name}`;
  }

  get editable() {
    return this.document.isOwner && !this.document.pack && (this.document.compendium?.locked !== true);
  }

  /* -------------------------------------------- */
  /*  State                                       */
  /* -------------------------------------------- */

  models = [];
  open = new Set();
  showAdvanced = false;
  rawError = "";
  #saved = "";

  rules = {};
  settings = {};

  #load() {
    if ( this.mode === "activity" ) {
      const f = this.activity.flags?.[MODULE_ID] ?? {};
      this.models = [
        ...(Array.isArray(f.onUse) ? f.onUse : []).map(action => triggerToModel({ event: ["activity"], action })),
        ...(Array.isArray(f.onHit) ? f.onHit : []).map(action => ({ ...triggerToModel({ event: ["activity"], action }), phase: "hit" }))
      ];
      this.settings = { pay: f.pay ? clone(f.pay) : null, chooseEffects: f.chooseEffects ? clone(f.chooseEffects) : null,
        targetFilter: f.targetFilter ? clone(f.targetFilter) : null, summonEffects: Array.isArray(f.summonEffects) ? [...f.summonEffects] : [],
        repeat: f.repeat ? clone(f.repeat) : null, mastery: f.mastery ?? "", properties: [...(f.properties ?? [])] };
    } else if ( this.mode === "area" ) {
      const list = this.activity.flags?.[MODULE_ID]?.area?.triggers;
      this.models = (Array.isArray(list) ? list : []).map(x => triggerToModel(x));
    } else {
      const list = this.document.getFlag(MODULE_ID, this.mode) ?? [];
      this.models = (Array.isArray(list) ? list : []).map(x => this.mode === "reactions" ? reactionToModel(x) : triggerToModel(x));
      if ( this.mode === "triggers" ) this.rules = readRules(this.document);
    }
    this.#saved = this.#snapshot();
    if ( this.models.length === 1 ) this.open.add(0);
  }

  #output() {
    if ( this.mode === "activity" ) {
      const steps = phase => this.models.filter(m => (m.phase === "hit") === (phase === "hit")).map(m => modelToTrigger(m).action);
      const hit = steps("hit");
      return hit.length ? { onUse: steps("use"), onHit: hit } : steps("use");
    }
    return this.models.map(m => this.mode === "reactions" ? modelToReaction(m) : modelToTrigger(m));
  }

  #snapshot() {
    return JSON.stringify({ list: this.#output(), rules: this.rules, settings: this.settings });
  }

  get dirty() {
    return this.#snapshot() !== this.#saved;
  }

  #errors(model) {
    return this.mode === "reactions" ? validateReaction(model) : validateTrigger(model);
  }

  #describe(model) {
    if ( this.mode === "activity" ) return describeTriggerModel(model).replace(/^[^:]*: /, model.phase === "hit" ? "When it hits: " : "Right after it's used: ");
    return this.mode === "reactions" ? describeReactionModel(model, this.document) : describeTriggerModel(model);
  }

  /** The item this effect belongs to, if any (for "source's activity" choices). */
  get parentItem() {
    const parent = this.document.parent;
    return parent?.documentName === "Item" ? parent : null;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  async _renderHTML() {
    return this.#html();
  }

  _replaceHTML(result, content) {
    const scroll = content.querySelector(".aet-scroll")?.scrollTop ?? 0;
    content.innerHTML = result;
    const el = content.querySelector(".aet-scroll");
    if ( el ) el.scrollTop = scroll;
    if ( !this.editable ) content.querySelectorAll("input, select, textarea, button.aet-edit")
      .forEach(el => el.disabled = true);
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this.element.addEventListener("change", this.#onChange.bind(this));
    this.element.addEventListener("input", this.#onInput.bind(this));
  }

  _onClose(options) {
    super._onClose?.(options);
    if ( OPEN.get(this.openKey) === this ) OPEN.delete(this.openKey);
  }

  async close(options={}) {
    if ( this.dirty && this.editable && !options.force ) {
      const discard = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Unsaved changes" },
        content: "<p>You have unsaved changes. Close and lose them?</p>",
        yes: { label: "Discard changes", icon: "fa-solid fa-trash" },
        no: { label: "Keep editing" }
      });
      if ( !discard ) return this;
    }
    return super.close(options);
  }

  #html() {
    const reactions = this.mode === "reactions";
    const activityMode = this.mode === "activity";
    const areaMode = this.mode === "area";
    const intro = areaMode
      ? "Triggers for the area this activity places (its template): when it appears, and when creatures enter, leave, or start or end their turn in it. The creatures concerned are “the targets”. With automatic saves on, a save spell already resolves on everyone inside when it appears — add triggers here for anything more (Cloudkill, Moonbeam, Spirit Guardians…)."
      : activityMode
      ? "Automation for this activity: steps that run right after it's used, how it's paid for, and whether the user picks which of its effects apply."
      : reactions
      ? "Reactions offer this item in a popup when the right moment comes up in play. Pick a preset or build one."
      : "Triggers run while this effect is on a creature (the <em>bearer</em>). Pick a preset or build one.";
    const presets = activityMode ? "" : (reactions ? REACTION_PRESETS : (areaMode ? AREA_PRESETS : TRIGGER_PRESETS)).map((p, i) => `
      <button type="button" class="aet-preset aet-edit" data-action="addPreset" data-preset="${i}" data-tooltip="${esc(p.hint)}">
        <i class="fa-solid ${p.icon}"></i><span class="aet-preset-name">${esc(p.label)}</span>
        <span class="aet-preset-hint">${esc(p.hint)}</span>
      </button>`).join("");
    const cards = this.models.map((m, i) => this.#card(m, i)).join("");
    const noun = activityMode ? "step" : (reactions ? "reaction" : "trigger");
    const empty = `<div class="aet-empty"><i class="fa-solid fa-bolt"></i>
      <p>No ${noun}s yet.</p><p>${activityMode ? "Add one below." : "Pick a preset above, or add a blank one."}</p></div>`;
    const readonly = this.editable ? "" : `<div class="aet-readonly"><i class="fa-solid fa-lock"></i>
      Read only — ${this.document.pack ? "this is in a compendium; import it to edit" : "you don't own this document"}.</div>`;
    const advanced = this.showAdvanced ? `
      <section class="aet-advanced">
        <p class="aet-muted">The raw data the engine reads. Paste to copy triggers between documents.</p>
        <textarea class="aet-raw" spellcheck="false">${esc(JSON.stringify(this.#output(), null, 2))}</textarea>
        ${this.rawError ? `<p class="aet-error-line"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(this.rawError)}</p>` : ""}
        <button type="button" class="aet-btn aet-edit" data-action="applyRaw"><i class="fa-solid fa-check"></i> Use this data</button>
      </section>` : "";
    return `<div class="aet-root">
      <div class="aet-scroll">
        ${readonly}
        <p class="aet-intro">${intro}</p>
        ${this.mode === "triggers" ? this.#rulesSection() : ""}
        ${activityMode ? this.#settingsSection() : `<div class="aet-section-title">Start from a preset</div>
        <div class="aet-presets">${presets}</div>`}
        <div class="aet-section-title">${activityMode ? "Right after it's used" : `${reactions ? "Reactions" : "Triggers"} on ${esc(this.document.name)}`}</div>
        <div class="aet-cards">${cards || empty}</div>
        <button type="button" class="aet-add aet-edit" data-action="addBlank"><i class="fa-solid fa-plus"></i>
          Add a ${activityMode ? "step" : `blank ${noun}`}</button>
        ${advanced}
      </div>
      <footer class="aet-footer">
        <button type="button" class="aet-link" data-action="toggleAdvanced">
          <i class="fa-solid fa-code"></i> ${this.showAdvanced ? "Hide" : "Advanced"}</button>
        <span class="aet-status">${this.dirty ? '<i class="fa-solid fa-circle"></i> Unsaved changes' : ""}</span>
        <button type="button" class="aet-btn" data-action="cancel">${this.editable ? "Cancel" : "Close"}</button>
        ${this.editable ? `<button type="button" class="aet-btn aet-primary" data-action="save">
          <i class="fa-solid fa-floppy-disk"></i> Save</button>` : ""}
      </footer>
    </div>`;
  }

  #card(model, i) {
    const errors = this.#errors(model);
    const open = this.open.has(i);
    const body = this.mode === "reactions" ? this.#reactionBody(model, i)
      : this.mode === "activity" ? this.#activityBody(model, i) : this.#triggerBody(model, i);
    const n = this.models.length;
    return `<section class="aet-card${open ? " open" : ""}${errors.length ? " invalid" : ""}" data-index="${i}">
      <header class="aet-card-head" data-action="toggle">
        <span class="aet-badge">${i + 1}</span>
        <span class="aet-sentence">${esc(this.#describe(model))}</span>
        ${errors.length ? `<i class="fa-solid fa-triangle-exclamation aet-warn" data-tooltip="${esc(errors.join(" "))}"></i>` : ""}
        <span class="aet-tools">
          ${i > 0 ? `<button type="button" class="aet-icon aet-edit" data-action="moveUp" data-tooltip="Move up"><i class="fa-solid fa-arrow-up"></i></button>` : ""}
          ${i < n - 1 ? `<button type="button" class="aet-icon aet-edit" data-action="moveDown" data-tooltip="Move down"><i class="fa-solid fa-arrow-down"></i></button>` : ""}
          <button type="button" class="aet-icon aet-edit" data-action="duplicate" data-tooltip="Duplicate"><i class="fa-solid fa-copy"></i></button>
          <button type="button" class="aet-icon aet-danger aet-edit" data-action="remove" data-tooltip="Delete"><i class="fa-solid fa-trash"></i></button>
          <i class="fa-solid fa-chevron-down aet-chevron"></i>
        </span>
      </header>
      <div class="aet-card-body">
        ${errors.length ? `<ul class="aet-errors">${errors.map(e => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
        ${body}
      </div>
    </section>`;
  }

  #step(num, title, content, hint="") {
    return `<div class="aet-step">
      <div class="aet-step-label"><span class="aet-step-num">${num}</span><span>${title}</span></div>
      <div class="aet-step-body">${hint ? `<p class="aet-muted">${hint}</p>` : ""}${content}</div>
    </div>`;
  }

  #triggerBody(m) {
    const groups = this.mode === "area" ? EVENT_GROUPS.filter(g => g.area) : EVENT_GROUPS;
    const when = groups.map(g => `<div class="aet-pill-group"><span class="aet-group-label">${esc(g.label)}</span>
      <div class="aet-pills">${g.events.map(([id, label]) => `<button type="button"
        class="aet-pill aet-edit${m.events.includes(id) ? " active" : ""}" data-action="toggleEvent" data-event="${id}">
        ${m.events.includes(id) ? '<i class="fa-solid fa-check"></i>' : ""}${esc(label)}</button>`).join("")}</div></div>`).join("");
    const tiles = TRIGGER_ACTIONS.map(([id, icon, label, hint]) => `<button type="button"
      class="aet-tile aet-edit${m.action.type === id ? " active" : ""}" data-action="setAction" data-type="${id}">
      <i class="fa-solid ${icon}"></i><strong>${esc(label)}</strong><small>${esc(hint)}</small></button>`).join("");
    const label = `<label class="aet-inline"><span>Name in chat</span>
      <input type="text" data-path="label" value="${esc(m.label)}" placeholder="${esc(this.document.name)}"></label>`;
    const areaEvents = m.events.some(e => AREA_EVENT_IDS.includes(e));
    const extras = [];
    const perCreature = m.events.some(e => ["areaEnter", "areaTurnStart", "areaTurnEnd"].includes(e));
    extras.push(`<details class="aet-rule-group"${(m.extra.ask || m.extra.needsUses || m.extra.oncePerTurn) ? " open" : ""}><summary>More options</summary><div class="aet-fields">
      <label class="aet-inline"><span>Ask first</span><input type="text" class="aet-wide" data-path="extra.ask" value="${esc(m.extra.ask ?? "")}" placeholder="a yes/no question to the bearer's player (optional)"></label>
      <label class="aet-check"><input type="checkbox" data-path="extra.needsUses" data-type="boolean"${m.extra.needsUses ? " checked" : ""}><span>Only while its item has a use left</span></label>
      <label class="aet-check"><input type="checkbox" data-path="extra.oncePerTurn" data-type="boolean" data-rerender${m.extra.oncePerTurn ? " checked" : ""}><span>${perCreature ? "At most once per creature per turn" : "At most once per turn (in combat; with “Ask first”, only when the answer is yes)"}</span></label></div></details>`);
    if ( m.events.includes("interval") ) extras.push(`<label class="aet-inline"><span>Every</span>
      <input type="number" class="aet-num" data-special="everyHours" min="0" step="any" value="${esc(m.extra.every ? m.extra.every / 3600 : "")}" placeholder="24"><span class="aet-muted">hours of game time, from when the effect began</span></label>`);
    if ( areaEvents && (this.mode === "triggers") && !(Number(this.rules.areaRadius) > 0) ) extras.push(`<p class="aet-hint-warn"><i class="fa-solid fa-circle-info"></i>
      This effect has no area yet — set its size under Effect rules → Area and movement.</p>`);
    return this.#step(1, "When", when + extras.join(""), areaEvents ? "Pick one or more moments. “The targets” are the creatures concerned." : "Pick one or more moments.")
      + this.#step(2, "Only if", this.#rows("rows", m.rows, TRIGGER_FIELDS, m.events), "Optional — leave empty to always run.")
      + this.#step(3, "Do", `<div class="aet-tiles">${tiles}</div>${this.#actionFields(m)}`)
      + this.#step(4, "Then", `<select data-path="then" class="aet-wide">${options(thenEntries(m.action.type), m.then)}</select>${label}`);
  }

  #activityBody(m) {
    const tiles = TRIGGER_ACTIONS.filter(([id]) => ACTIVITY_ACTIONS.includes(id)).map(([id, icon, label, hint]) => `<button type="button"
      class="aet-tile aet-edit${m.action.type === id ? " active" : ""}" data-action="setAction" data-type="${id}">
      <i class="fa-solid ${icon}"></i><strong>${esc(label)}</strong><small>${esc(hint)}</small></button>`).join("");
    const when = this.activity?.type === "attack" ? `<label class="aet-inline"><span>When</span><select data-path="phase" data-rerender>${options([["use", "Right after it's used"],
      ["hit", "When it hits (“the targets” = the creatures hit)"]], m.phase === "hit" ? "hit" : "use")}</select></label>` : "";
    return this.#step(1, "Do", `${when}<div class="aet-tiles">${tiles}</div>${this.#actionFields(m)}`,
      m.phase === "hit" ? "Runs for the attacker after its hits are settled." : "Runs for the creature using it. “The targets” are the creatures it targeted.");
  }

  /** Effect rules: flags on the effect itself, besides its triggers — grouped by what they affect. */
  #rulesSection() {
    const r = this.rules;
    const abilityBoxes = (list, key) => abilityEntries().map(([id, label]) => `<label class="aet-check aet-small-check">
      <input type="checkbox" data-rule-list="${key}" value="${id}"${(list ?? []).includes(id) ? " checked" : ""}><span>${esc(label)}</span></label>`).join("");
    const groups = {
      spells: [r.noReactions, r.noComponents, r.askFirst, r.minLevel, r.saveDamageOnSave, r.ownRollsOnly, r.noSpells, r.sustainEvents?.length],
      damage: [r.ignoreDamageFrom, r.evasion?.length, r.noHealing, r.dropSave, r.onlyIfStatus, r.saveAdvStatuses?.length, r.healingExtraDie,
        String(r.reduceFormula ?? "").trim(), Number(r.diceMin) > 1],
      area: [Number(r.areaRadius) > 0, r.stopOnCollision, r.disengaged, (Number(r.lightBright) > 0) || (Number(r.lightDim) > 0)],
      weapons: [r.attackAdd?.length, r.attackOnly?.length, r.attackedMode, r.attacksMode, Number(r.extraAttack) > 0]
    };
    const typePills = (list, key, entries) => entries.map(([id, label]) => `<label class="aet-check aet-small-check">
      <input type="checkbox" data-rule-list="${key}" value="${id}"${(list ?? []).includes(id) ? " checked" : ""}><span>${esc(label)}</span></label>`).join("");
    const diceMode = Object.entries(DICE_FILTERS).find(([, f]) => JSON.stringify(f) === JSON.stringify(parseFilterText(r.diceFilter) ?? []))?.[0] ?? "custom";
    const sustainEventEntries = [["attack", "attacks"], ["activity", "uses an activity"], ["spell", "casts a spell"], ["dealt", "deals damage"], ["moved", "moves"]];
    const n = list => list.filter(Boolean).length;
    const count = Object.values(groups).reduce((s, g) => s + n(g), 0);
    const group = (key, title, body) => `<details class="aet-rule-group"${n(groups[key]) ? " open" : ""}>
      <summary>${title}${n(groups[key]) ? ` <span class="aet-muted">(${n(groups[key])})</span>` : ""}</summary><div class="aet-fields">${body}</div></details>`;
    return `<details class="aet-rules"${count ? " open" : ""}><summary><i class="fa-solid fa-sliders"></i> Effect rules
      <span class="aet-muted">${count ? `${count} set` : "none set — optional"}</span></summary>
      ${group("spells", "Actions, reactions and spells", `
        <label class="aet-check"><input type="checkbox" data-rule="noReactions"${r.noReactions ? " checked" : ""}><span>The bearer can't take reactions</span></label>
        <label class="aet-check"><input type="checkbox" data-rule="noComponents"${r.noComponents ? " checked" : ""}><span>The bearer's spells have no components (can't be Counterspelled)</span></label>
        <label class="aet-inline"><span>Ask before applying</span><input type="text" class="aet-wide" data-rule="askFirst" value="${esc(r.askFirst)}" placeholder="a yes/no question shown before auto-applying (optional)"></label>
        <label class="aet-inline"><span>Needs slot level</span><input type="number" class="aet-num" data-rule="minLevel" value="${esc(r.minLevel)}" placeholder="any"><span class="aet-muted">for spells that let the caster choose a benefit</span></label>
        <label class="aet-inline"><span>Bearer's save spells, on a success</span><select data-rule="saveDamageOnSave">${options([["", "Rules as written"], ["half", "Half damage"], ["full", "Full damage"]], r.saveDamageOnSave)}</select>
          <span>of level</span><input type="number" class="aet-num" data-rule="saveDamageLevel" value="${esc(r.saveDamageLevel)}" placeholder="any"><span class="aet-muted">only upgrades “no damage” (Potent Cantrip)</span></label>
        <label class="aet-check"><input type="checkbox" data-rule="ownRollsOnly"${r.ownRollsOnly ? " checked" : ""}><span>Its roll bonuses are the bearer's own — summons matching the bearer's spell attack don't get them</span></label>
        <label class="aet-check"><input type="checkbox" data-rule="noSpells"${r.noSpells ? " checked" : ""}><span>The bearer can't cast spells (concentration ends when it's applied)</span></label>
        <div class="aet-subtitle">Ends at the end of the bearer's turn unless during it the bearer…</div>
        <div class="aet-pills">${typePills(r.sustainEvents, "sustainEvents", sustainEventEntries)}</div>
        <label class="aet-inline"><span>…and it matches</span><input type="text" class="aet-wide" data-rule="sustainFilter" value="${esc(r.sustainFilter)}" placeholder='[] (always) — a filter, e.g. [{"k":"activityType","v":"save"}]'></label>
        <p class="aet-muted">Rage-style upkeep: put on during the bearer's turn, it lasts to the end of its next turn; each turn after that it must be kept going.${parseFilterText(r.sustainFilter) ? ` Now: ${esc(describeRawFilter(parseFilterText(r.sustainFilter), TRIGGER_FIELDS))}.` : ""}</p>`)}
      ${group("damage", "Saves, damage and healing", `
        <div class="aet-subtitle">Advantage on saves against becoming</div><div class="aet-pills">${statusEntries().map(([id, label]) => `<label class="aet-check aet-small-check">
          <input type="checkbox" data-rule-list="saveAdvStatuses" value="${id}"${(r.saveAdvStatuses ?? []).includes(id) ? " checked" : ""}><span>${esc(label)}</span></label>`).join("")}</div>
        <label class="aet-check"><input type="checkbox" data-rule="healingExtraDie"${r.healingExtraDie ? " checked" : ""}><span>The bearer's healing rolls one extra die and drops the lowest</span></label>
        <div class="aet-subtitle">Evasion on saves of</div><div class="aet-pills">${abilityBoxes(r.evasion, "evasion")}</div>
        <p class="aet-muted">None on a success, half on a failure, against effects that halve damage — not while Incapacitated.</p>
        <label class="aet-inline"><span>Ignore damage from</span><input type="text" class="aet-wide" data-rule="ignoreDamageFrom" value="${esc(r.ignoreDamageFrom)}" placeholder="item names or identifiers, comma-separated (e.g. Magic Missile)"></label>
        <label class="aet-check"><input type="checkbox" data-rule="noHealing"${r.noHealing ? " checked" : ""}><span>The bearer can't regain hit points</span></label>
        <label class="aet-check"><input type="checkbox" data-rule="dropSave" data-rerender${r.dropSave ? " checked" : ""}><span>When damage drops the bearer to 0 HP, it saves to stay at 1 (Undead Fortitude)</span></label>
        ${r.dropSave ? `<div class="aet-sub"><label class="aet-inline"><span>Save</span><select data-rule="dropAbility">${options(abilityEntries(), r.dropAbility)}</select>
          <span>DC</span><input type="text" class="aet-formula" data-rule="dropDc" value="${esc(r.dropDc)}" placeholder="5 + @damage"></label>
          <label class="aet-check"><input type="checkbox" data-rule="dropRadiant"${r.dropRadiant ? " checked" : ""}><span>Not against Radiant damage</span></label>
          <label class="aet-check"><input type="checkbox" data-rule="dropCrit"${r.dropCrit ? " checked" : ""}><span>Not against a critical hit</span></label></div>` : ""}
        <label class="aet-inline"><span>Reduce incoming damage by</span><input type="text" class="aet-formula" data-rule="reduceFormula" value="${esc(r.reduceFormula)}" placeholder="e.g. 1d4 or @prof">
          <label class="aet-check aet-small-check"><input type="checkbox" data-rule="reduceOnce"${r.reduceOnce ? " checked" : ""}><span>once per turn</span></label></label>
        <div class="aet-pills">${typePills(r.reduceTypes, "reduceTypes", damageEntries().filter(([id]) => id in CONFIG.DND5E.damageTypes))}</div>
        <p class="aet-muted">Only those damage types (none checked = any); applied before resistance.</p>
        <label class="aet-inline"><span>The bearer's damage dice count at least</span><input type="number" class="aet-num" data-rule="diceMin" data-rerender value="${esc(r.diceMin)}" placeholder="—">
          ${Number(r.diceMin) > 1 ? `<span>for</span><select data-rule="diceMode" data-rerender>${options([["", "all its damage"], ["gwf", "melee weapon attacks made two-handed"], ...(diceMode === "custom" ? [["custom", "a custom filter (below)"]] : [])], diceMode)}</select>` : ""}</label>
        ${Number(r.diceMin) > 1 && (diceMode === "custom") ? `<label class="aet-inline"><span>Filter</span><input type="text" class="aet-wide" data-rule="diceFilter" value="${esc(r.diceFilter)}"></label>` : ""}
        <label class="aet-inline"><span>When auto-applied, only to a target that has</span><select data-rule="onlyIfStatus">${options([["", "— (always)"], ...statusEntries(), ...(r.onlyIfStatus === "custom" ? [["custom", "Custom filter (kept)"]] : [])], r.onlyIfStatus)}</select></label>`)}
      ${group("area", "Area and movement", `
        <label class="aet-inline"><span>Area around the bearer</span><input type="number" class="aet-num" data-rule="areaRadius" data-rerender value="${esc(r.areaRadius)}" placeholder="—"><span class="aet-muted">ft, moving with it</span>
          <input type="color" data-rule="areaColor" value="${esc(r.areaColor)}"></label>
        <p class="aet-muted">Use the “Its area…” moments in a trigger: appears, a creature enters / leaves / starts or ends its turn in it.</p>
        <label class="aet-check"><input type="checkbox" data-rule="disengaged"${r.disengaged ? " checked" : ""}><span>Disengaged: moving doesn't offer Opportunity Attacks</span></label>
        <label class="aet-check"><input type="checkbox" data-rule="stopOnCollision"${r.stopOnCollision ? " checked" : ""}><span>Stops when it moves into a creature (use with “Moves into a creature”); can't move again that turn</span></label>
        <label class="aet-inline"><span>The bearer sheds light</span><input type="number" class="aet-num" data-rule="lightBright" value="${esc(r.lightBright)}" placeholder="bright">
          <input type="number" class="aet-num" data-rule="lightDim" value="${esc(r.lightDim)}" placeholder="dim"><span class="aet-muted">ft, while this lasts</span>
          <input type="color" data-rule="lightColor" value="${esc(r.lightColor)}"></label>`)}
      ${group("weapons", "Weapon attacks", `
        <label class="aet-inline"><span>Attacks against the bearer have</span><select data-rule="attackedMode" data-rerender>${options([["", "— (normal)"], ["advantage", "Advantage"], ["disadvantage", "Disadvantage"]], r.attackedMode)}</select>
          ${r.attackedMode ? `<label class="aet-check aet-small-check"><input type="checkbox" data-rule="attackedOnce"${r.attackedOnce ? " checked" : ""}><span>only the next one (then it ends)</span></label>
          <label class="aet-check aet-small-check"><input type="checkbox" data-rule="attackedBySource"${r.attackedBySource ? " checked" : ""}><span>only the source's attacks</span></label>` : ""}</label>
        ${r.attackedMode ? `<div class="aet-sub"><div class="aet-subtitle">…only from attackers of type <span class="aet-muted">(none = any)</span></div>
          <div class="aet-pills">${typePills(r.attackedTypes, "attackedTypes", creatureTypeEntries())}</div></div>` : ""}
        <label class="aet-inline"><span>The bearer's attacks have</span><select data-rule="attacksMode" data-rerender>${options([["", "— (normal)"], ["advantage", "Advantage"], ["disadvantage", "Disadvantage"]], r.attacksMode)}</select>
          ${r.attacksMode ? `<label class="aet-check aet-small-check"><input type="checkbox" data-rule="attacksOnce"${r.attacksOnce ? " checked" : ""}><span>only the next one (then it ends)</span></label>
          <label class="aet-check aet-small-check"><input type="checkbox" data-rule="attacksUnlessSource"${r.attacksUnlessSource ? " checked" : ""}><span>except against the source</span></label>` : ""}</label>
        <label class="aet-inline"><span>Extra attacks with the Attack action</span><input type="number" class="aet-num" data-rule="extraAttack" value="${esc(r.extraAttack)}" placeholder="0"><span class="aet-muted">offered after the first (Extra Attack = 1)</span></label>
        <div class="aet-subtitle">May also use</div><div class="aet-pills">${abilityBoxes(r.attackAdd, "attackAdd")}</div>
        <label class="aet-check"><input type="checkbox" data-rule="attackProficient"${r.attackProficient ? " checked" : ""}><span>…only with weapons the bearer is proficient with</span></label>
        <div class="aet-subtitle">Must use one of</div><div class="aet-pills">${abilityBoxes(r.attackOnly, "attackOnly")}</div>
        <p class="aet-muted">The best allowed ability is used and shown on the sheet; the roll dialog offers the others.</p>`)}
    </details>`;
  }

  /** Activity settings: pay from several pools, choose which effects apply. */
  #settingsSection() {
    const s = this.settings;
    const pools = (this.document.actor?.items.filter(i => i.system.uses?.max && i.system.identifier) ?? [])
      .map(i => `<code>${esc(i.system.identifier)}</code>`).join(", ");
    const effects = this.activity.effects?.length ?? 0;
    return `<div class="aet-section-title">How it's paid and applied</div><div class="aet-settings aet-fields">
      <label class="aet-check"><input type="checkbox" data-setting="payOn" data-rerender${s.pay ? " checked" : ""}><span>Pay from item uses, in order (e.g. Metamagic Adept's points first, then Sorcery Points)</span></label>
      ${s.pay ? `<div class="aet-sub">
        <label class="aet-inline"><span>Cost</span><input type="number" class="aet-num" data-setting="pay.cost" value="${esc(s.pay.cost)}" min="1"></label>
        <label class="aet-inline"><span>Pools</span><input type="text" class="aet-wide" data-setting="pay.from" value="${esc((s.pay.from ?? []).join(", "))}" placeholder="identifiers, comma-separated"></label>
        ${pools ? `<p class="aet-muted">On this character: ${pools}</p>` : ""}
      </div>` : ""}
      <label class="aet-check"><input type="checkbox" data-setting="chooseOn" data-rerender${s.chooseEffects ? " checked" : ""}${effects > 1 ? "" : " disabled"}>
        <span>The user picks which of its ${effects} effects apply${effects > 1 ? "" : " (needs two or more)"}</span></label>
      ${s.chooseEffects ? `<div class="aet-sub"><label class="aet-inline"><span>How many</span><input type="text" class="aet-formula" data-setting="chooseEffects.count" value="${esc(s.chooseEffects.count)}" placeholder="1"></label>
        <p class="aet-muted">A number or formula, e.g. <code>min(2, 1 + floor(@item.level / 4))</code> (@item.level is the level it was cast at). An effect can require a slot level in its Effect rules.</p></div>` : ""}
      ${this.activity.target?.template?.type ? `<div class="aet-subtitle">Its area</div>
        <button type="button" class="aet-btn aet-edit" data-action="openArea"><i class="fa-solid fa-burst"></i>
          Area triggers (${this.activity.flags?.[MODULE_ID]?.area?.triggers?.length ?? 0})</button>
        <p class="aet-muted">What happens in the ${esc(this.activity.target.template.type)} it places: when it appears, as creatures enter, leave, or start/end their turns in it.</p>` : ""}
      ${this.activity.type === "attack" ? `<label class="aet-inline"><span>Strikes per use</span><input type="number" class="aet-num" min="1" data-setting="repeat.count" value="${esc(s.repeat?.count ?? 1)}">
        <span>one may instead be</span><input type="text" class="aet-formula" data-setting="repeat.swap" value="${esc(s.repeat?.swap ?? "")}" placeholder="item identifier (optional)"></label>
        <p class="aet-muted">After the first strike, each next one asks for its target (Flurry of Blows: 2, swap “hand-of-healing”, free).</p>
        <label class="aet-inline"><span>Weapon mastery it always has</span><select data-setting="mastery">${options([["", "— (the weapon's, if chosen)"],
          ...Object.entries(CONFIG.DND5E.weaponMasteries ?? {}).map(([k, v]) => [k, v.label ?? k])], s.mastery)}</select></label>
        <label class="aet-inline"><span>Counts as having</span><input type="text" class="aet-wide" data-setting="propertiesText" value="${esc((s.properties ?? []).join(", "))}" placeholder="weapon properties, e.g. fin, thr (for Sneak Attack and the like)"></label>` : ""}
      <label class="aet-inline"><span>Use it automatically when the only target is</span><select data-setting="targetPick">${options([["", "— (always ask)"],
        ["damaged", "Missing hit points"], ["healthy", "At full hit points"], ["bloodied", "Bloodied (half HP or less)"], ["unbloodied", "Not bloodied"],
        ...(targetPickOf(s.targetFilter) === "custom" ? [["custom", "Custom filter (kept)"]] : [])], targetPickOf(s.targetFilter))}</select></label>
      <p class="aet-muted">For items with one activity per target state (Toll the Dead): the matching one is used without the chooser.</p>
      ${this.activity.type === "summon" ? `<div class="aet-subtitle">Put these effects on the summoned creatures</div><div class="aet-pills">${
        (this.document.effects?.contents ?? []).filter(e => !e.transfer).map(e => `<label class="aet-check aet-small-check"><input type="checkbox" data-setting="summonEffect" value="${e.id}"${(s.summonEffects ?? []).includes(e.id) ? " checked" : ""}><span>${esc(e.name)}</span></label>`).join("")
        || '<span class="aet-muted">(add a non-transfer effect to this item first)</span>'}</div>
        <p class="aet-muted">Stamped with the cast level (@spellLevel); give them triggers such as an aura.</p>` : ""}
    </div>`;
  }

  #actionFields(m) {
    const a = m.action;
    switch ( a.type ) {
      case "save": {
        const dcMode = ["source", "sourceSpell"].includes(a.dc) ? a.dc : (Number.isFinite(Number(a.dc)) ? "fixed" : "formula");
        const dmg = a.damage;
        const mods = m.mods.map((mod, j) => {
          const needsValue = ["bonus", "dc"].includes(mod.kind);
          return `<div class="aet-mod" data-mod="${j}">
            <div class="aet-row">
              <select data-mod-part="kind" data-rerender>${options([["advantage", "Advantage"], ["disadvantage", "Disadvantage"],
                ["bonus", "Bonus to the roll"], ["dc", "Change the DC"]], mod.kind)}</select>
              ${needsValue ? `<input type="text" data-mod-part="value" value="${esc(mod.value)}" placeholder="${mod.kind === "dc" ? "e.g. -2" : "e.g. 1d4 or -2"}">` : ""}
              <button type="button" class="aet-icon aet-danger aet-edit" data-action="removeMod" data-tooltip="Remove"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="aet-mod-when">${this.#rows(`mods.${j}.rows`, mod.rows, MODIFIER_FIELDS, [], "only when…")}</div>
          </div>`;
        }).join("");
        return `<div class="aet-fields">
          <label class="aet-inline"><span>Ability</span><select data-path="action.ability">${options(abilityEntries(), a.ability)}</select></label>
          <label class="aet-inline"><span>Who saves</span><select data-special="saveWho" data-rerender>${options([["bearer", "The bearer"], ["targets", "The creatures it concerns (in the area / the triggering one)"], ["subject", "The triggering creature"], ["chosen", "Creatures chosen…"]], !a.to ? "bearer" : (["subject", "targets"].includes(a.to.who) ? a.to.who : "chosen"))}</select></label>
          ${a.to && !["subject", "targets"].includes(a.to.who) ? this.#selectorFields("action.to", a.to, "trigger") : ""}
          <label class="aet-inline"><span>DC</span><select data-special="dcMode" data-rerender>${options([["source", "Same as the effect's source"], ["sourceSpell", "The source's spell save DC"], ["fixed", "A fixed number"], ["formula", "A formula (the source's data)"]], dcMode)}</select>
            ${dcMode === "fixed" ? `<input type="number" class="aet-num" data-path="action.dc" data-type="number" value="${esc(a.dc)}">` : ""}
            ${dcMode === "formula" ? `<input type="text" class="aet-formula" data-path="action.dc" value="${esc(a.dc)}" placeholder="8 + @prof + @abilities.cha.mod">` : ""}</label>
          <label class="aet-check"><input type="checkbox" data-special="saveDamage" data-rerender${dmg ? " checked" : ""}>
            <span>Deal damage on a failed save</span></label>
          ${dmg ? `<div class="aet-sub">
            <label class="aet-inline"><span>Damage</span><input type="text" class="aet-formula" data-path="action.damage.formula" value="${esc(dmg.formula)}" placeholder="e.g. 2d6">
              <select data-path="action.damage.type">${options(damageEntries(), dmg.type)}</select></label>
            <label class="aet-inline"><span>On a success</span><select data-path="action.damage.onSuccess">${options([["none", "No damage"], ["half", "Half damage"]], dmg.onSuccess ?? "none")}</select></label>
          </div>` : ""}
          <label class="aet-inline"><span>On a failure, also</span><select data-path="action.failStatus">${options([["", "Nothing"], ...statusEntries()], a.failStatus ?? "")}</select>
            <select data-path="action.failUntil">${options([["turnStart", "until the start of its next turn"], ["turnEnd", "until the end of its next turn"],
              ["sourceStart", "until the start of the source's next turn"], ["sourceEnd", "until the end of the source's next turn"]], a.failUntil ?? "turnStart")}</select></label>
          <div class="aet-subtitle">Save modifiers <span class="aet-muted">(optional)</span></div>
          ${mods}
          <button type="button" class="aet-add-small aet-edit" data-action="addMod"><i class="fa-solid fa-plus"></i> Add a modifier</button>
        </div>`;
      }
      case "tempHp":
        return `<div class="aet-fields"><label class="aet-inline"><span>Temporary HP</span>
          <input type="text" class="aet-formula" data-path="action.formula" value="${esc(a.formula)}" placeholder="e.g. 1d10 + 5"></label>
          <p class="aet-muted">${FORMULA_HINT}</p>${this.#selectorFields("action.to", a.to ?? { who: "bearer" }, "trigger")}</div>`;
      case "recoverSlots":
        return `<div class="aet-fields"><label class="aet-inline"><span>Budget (slot levels)</span>
          <input type="text" class="aet-formula" data-path="action.budget" value="${esc(a.budget)}" placeholder="ceil(@classes.wizard.levels / 2)"></label>
          <label class="aet-inline"><span>Highest slot level</span><input type="number" class="aet-num" data-path="action.maxLevel" data-type="number" value="${esc(a.maxLevel ?? 5)}"></label>
          <label class="aet-inline"><span>At most</span><input type="number" class="aet-num" data-path="action.maxSlots" data-type="number" value="${esc(a.maxSlots ?? "")}" placeholder="any"><span class="aet-muted">slots (1 = Pearl of Power)</span></label>
          <p class="aet-muted">The bearer's player picks the slots. As a trigger, spends one use of the item this effect is on; on an activity, the activity's own cost pays.</p></div>`;
      case "spendHitDie":
        return `<div class="aet-fields">${this.#selectorFields("action.to", a.to ?? { who: "targets" }, "trigger")}
          <p class="aet-muted">Each spends its largest Hit Point Die left and regains the roll. A healer with the extra-die rule rolls one more and keeps the best.</p></div>`;
      case "useActivity":
        return `<div class="aet-fields"><label class="aet-inline"><span>Activity</span>
          <input type="text" class="aet-wide" data-path="action.activity" value="${esc(a.activity ?? "")}" placeholder="name or id — blank = its save"></label>
          <label class="aet-check"><input type="checkbox" data-path="action.consume" data-type="boolean"${a.consume ? " checked" : ""}><span>The bearer uses it normally, paying its cost (e.g. Uncanny Metabolism)</span></label>
          <p class="aet-muted">Runs on the triggering creature (or its targets): saves are rolled and damage/effects applied like any automated save.</p></div>`;
      case "drainMaxHp":
        return `<div class="aet-fields"><label class="aet-inline"><span>Amount</span>
          <input type="text" class="aet-formula" data-path="action.amount" value="${esc(a.amount ?? "@amount")}" placeholder="@amount"></label>
          <label class="aet-inline"><span>Lasts</span><select data-path="action.until">${options([["longRest", "Until a Long Rest"], ["never", "Until removed (a curse)"]], a.until ?? "longRest")}</select></label>
          ${this.#selectorFields("action.to", a.to ?? { who: "targets" }, "trigger")}
          <p class="aet-muted">With “Deals damage”, @amount is the damage dealt and “the targets” is the damaged creature.</p></div>`;
      case "repeatActivity":
        return `<div class="aet-fields"><label class="aet-inline"><span>At most</span>
          <input type="text" class="aet-formula" data-path="action.max" value="${esc(a.max ?? "1")}" placeholder="1 or @spellLevel"><span class="aet-muted">times per use (@spellLevel = the level it was cast at)</span></label>
          ${this.#selectorFields("action.to", a.to ?? {}, "trigger")}
          <p class="aet-muted">Use with “Rolls damage”. The new attack can hit or miss; on a hit its damage is rolled, which can trigger this again.</p></div>`;
      case "storeSpell":
        return `<div class="aet-fields"><label class="aet-inline"><span>Schools</span>
          <input type="text" class="aet-wide" data-special="storeSchools" value="${esc((a.schools ?? []).join(", "))}" placeholder="specialist, or school ids (evo, abj…), blank = any"></label>
          <label class="aet-inline"><span>Cast at</span><input type="number" class="aet-num" data-path="action.attack" data-type="number" value="${esc(a.attack ?? "")}" placeholder="own"><span class="aet-muted">to hit</span>
            <input type="number" class="aet-num" data-path="action.dc" data-type="number" value="${esc(a.dc ?? "")}" placeholder="own"><span class="aet-muted">save DC (blank = the caster's own)</span></label>
          <p class="aet-muted">The user picks one of their level 1+ spells and a slot to spend. The item gains a “Cast stored …” activity (no slot needed), gone once cast. Storing again replaces it. “specialist” = the user's Wizard school.</p></div>`;
      case "activityDamage":
        return `<div class="aet-fields"><label class="aet-inline"><span>Multiplier</span>
          <input type="number" class="aet-num" step="0.5" min="0" data-path="action.multiplier" data-type="number" value="${esc(a.multiplier ?? 0.5)}"><span class="aet-muted">0.5 = half</span></label>
          <p class="aet-muted">Use with “Misses with an attack”: rolls the attack or spell's own damage (scaling included) and deals it to the creature it missed. Damage only — no other effects.</p></div>`;
      case "toggleLight":
        return `<div class="aet-fields">
          <label class="aet-inline"><span>Bright / dim (ft)</span><input type="number" class="aet-num" data-path="action.bright" data-type="number" value="${esc(a.bright)}">
            <input type="number" class="aet-num" data-path="action.dim" data-type="number" value="${esc(a.dim)}"></label>
          <label class="aet-inline"><span>Colour</span><input type="color" data-path="action.color" value="${esc(a.color || "#ffb86b")}"></label></div>`;
      case "random": {
        const effects = (this.parentItem ?? (this.mode === "activity" ? this.document : null))?.effects?.contents.filter(e => e.id !== this.document.id) ?? [];
        const effectField = (r, j) => effects.length
          ? `<select data-path="action.results.${j}.effect">${options([["", "— choose —"], ...effects.map(e => [e.name, e.name])], r.effect)}</select>`
          : `<input type="text" data-path="action.results.${j}.effect" value="${esc(r.effect)}" placeholder="Effect name on the item">`;
        const rows = (a.results ?? []).map((r, j) => `<div class="aet-row" data-result="${j}">
          <input type="text" class="aet-num" data-path="action.results.${j}.roll" value="${esc(r.roll)}" placeholder="1 or 2-3">
          ${effectField(r, j)}
          <input type="text" data-path="action.results.${j}.label" value="${esc(r.label ?? "")}" placeholder="name in chat (optional)">
          <button type="button" class="aet-icon aet-danger aet-edit" data-action="removeResult" data-tooltip="Remove"><i class="fa-solid fa-xmark"></i></button></div>`).join("");
        return `<div class="aet-fields"><label class="aet-inline"><span>Roll</span>
          <input type="text" class="aet-formula" data-path="action.formula" value="${esc(a.formula)}" placeholder="1d8"></label>
          <div class="aet-subtitle">Results <span class="aet-muted">(roll → effect given)</span></div>${rows}
          <button type="button" class="aet-add-small aet-edit" data-action="addResult"><i class="fa-solid fa-plus"></i> Add a row</button>
          <label class="aet-check"><input type="checkbox" data-special="actionTo" data-rerender${a.to ? " checked" : ""}><span>Give it to other creatures instead of the bearer</span></label>
          ${a.to ? this.#selectorFields("action.to", a.to, "trigger") : ""}
          <p class="aet-muted">Each result is an effect of this item — give it triggers of its own (a save when applied, a bonus while it lasts…).</p></div>`;
      }
      case "teleport":
        return `<div class="aet-fields"><label class="aet-inline"><span>Up to</span>
          <input type="number" class="aet-num" data-path="action.range" data-type="number" value="${esc(a.range)}"><span class="aet-muted">ft</span></label>
          <label class="aet-check"><input type="checkbox" data-path="action.sight" data-type="boolean" data-invert${a.sight === false ? " checked" : ""}><span>The spot doesn't need to be visible</span></label>
          <label class="aet-check"><input type="checkbox" data-special="actionTo" data-rerender${a.to ? " checked" : ""}><span>Move other creatures instead of the bearer</span></label>
          ${a.to ? this.#selectorFields("action.to", a.to, "trigger") : ""}
          <p class="aet-muted">The creature's player (or the GM) clicks an unoccupied spot within range.</p></div>`;
      case "push":
        return `<div class="aet-fields"><label class="aet-inline"><span>Distance</span>
          <input type="number" class="aet-num" data-path="action.distance" data-type="number" value="${esc(a.distance)}"><span class="aet-muted">ft (negative pulls)</span></label>
          <label class="aet-inline"><span>Away from</span><select data-path="action.from">${options([["", "The bearer"], ["source", "The effect's source"]], a.from ?? "")}</select></label>
          <label class="aet-check"><input type="checkbox" data-special="actionTo" data-rerender${a.to ? " checked" : ""}><span>Choose who moves (default: the creature concerned — the one hit, or the bearer)</span></label>
          ${a.to ? this.#selectorFields("action.to", a.to, "trigger") : ""}
          <p class="aet-muted">Straight line, one square at a time; stops before walls and other creatures.</p></div>`;
      case "sense": {
        const types = new Set(a.creatures?.find?.(f => f.k === "details.type.value")?.v ?? []);
        const pills = creatureTypeEntries().map(([id, label]) => `<label class="aet-check aet-small-check">
          <input type="checkbox" data-special="senseType" value="${id}"${types.has(id) ? " checked" : ""}><span>${esc(label)}</span></label>`).join("");
        return `<div class="aet-fields"><label class="aet-inline"><span>Within</span>
          <input type="number" class="aet-num" data-path="action.range" data-type="number" value="${esc(a.range)}"><span class="aet-muted">ft</span></label>
          <label class="aet-check"><input type="checkbox" data-special="senseCreatures" data-rerender${a.creatures !== undefined ? " checked" : ""}><span>Creatures (their tokens are pinged)</span></label>
          ${a.creatures !== undefined ? `<div class="aet-sub"><div class="aet-subtitle">Of type <span class="aet-muted">(none = any)</span></div><div class="aet-pills">${pills}</div></div>` : ""}
          <label class="aet-check"><input type="checkbox" data-special="senseMagic"${a.items === "magic" ? " checked" : ""}><span>Magic items and spells on creatures, and spell areas</span></label>
          <p class="aet-muted">Whispered to the bearer's player (and the GM).</p></div>`;
      }
      case "damage":
        return `<div class="aet-fields"><label class="aet-inline"><span>Damage</span>
          <input type="text" class="aet-formula" data-path="action.formula" value="${esc(a.formula)}" placeholder="e.g. 2d6">
          <select data-path="action.damageType">${options(damageEntries(), a.damageType)}</select></label>
          <label class="aet-check"><input type="checkbox" data-special="damageTo" data-rerender${a.to ? " checked" : ""}>
            <span>Deal it to other creatures instead of the bearer (e.g. the attacker, for thorns)</span></label>
          ${a.to ? this.#selectorFields("action.to", a.to, "trigger") : ""}
          <p class="aet-muted">${FORMULA_HINT}</p></div>`;
      case "rollActivity": {
        const item = this.parentItem;
        const acts = item?.system.activities?.contents ?? [];
        const itemRef = item ? (item.system.identifier || item.name) : "";
        const actField = acts.length && (a.item === itemRef || !a.item)
          ? `<select data-path="action.activity">${options([["", "— choose —"], ...acts.map(x => [x.name, x.name])], a.activity)}</select>`
          : `<input type="text" data-path="action.activity" value="${esc(a.activity)}" placeholder="Activity name">`;
        return `<div class="aet-fields">
          <label class="aet-inline"><span>Item</span><input type="text" data-path="action.item" value="${esc(a.item || itemRef)}" placeholder="Item name or identifier"></label>
          <label class="aet-inline"><span>Activity</span>${actField}</label>
          <p class="aet-muted">Rolled from the creature that applied this effect, at the bearer.</p></div>`;
      }
      case "giveEffect": {
        const effects = this.parentItem?.effects?.contents.filter(e => e.id !== this.document.id) ?? [];
        const field = effects.length
          ? `<select data-path="action.effect">${options([["", "— choose —"], ...effects.map(e => [e.name, e.name])], a.effect)}</select>`
          : `<input type="text" data-path="action.effect" value="${esc(a.effect)}" placeholder="Effect name on the item">`;
        return `<div class="aet-fields">
          <label class="aet-inline"><span>Effect</span>${field}</label>
          ${this.#selectorFields("action.to", a.to, "trigger")}
          <p class="aet-muted">Taken from the item this effect belongs to or came from. An earlier copy on a creature is replaced.</p></div>`;
      }
      case "removeStatus": {
        const pills = statusEntries().map(([id, label]) => `<button type="button" class="aet-pill aet-small aet-edit${(a.statuses ?? []).includes(id) ? " active" : ""}" data-action="toggleStatus" data-status="${id}">${esc(label)}</button>`).join("");
        const known = new Set(statusEntries().map(([id]) => id));
        const custom = (a.statuses ?? []).filter(s => !known.has(s));
        return `<div class="aet-fields"><div class="aet-subtitle">Conditions</div><div class="aet-pills">${pills}</div>
          <label class="aet-inline"><span>Other statuses</span><input type="text" class="aet-wide" data-special="customStatuses" value="${esc(custom.join(", "))}" placeholder="custom ids set by effects, comma-separated (e.g. tangled)"></label>
          <label class="aet-check"><input type="checkbox" data-path="action.choose" data-type="boolean"${a.choose ? " checked" : ""}><span>End only one per creature (the bearer picks)</span></label>
          ${this.#selectorFields("action.to", a.to, "trigger")}</div>`;
      }
      case "inspire": case "swapInitiative":
        return `<div class="aet-fields">${this.#selectorFields("action.to", a.to, "trigger")}</div>`;
      case "duplicates":
        return `<div class="aet-fields">
          <label class="aet-inline"><span>Duplicates</span><input type="number" class="aet-num" data-path="action.count" data-type="number" value="${esc(a.count)}" min="1"></label>
          <label class="aet-inline"><span>Duplicate hit on</span><input type="number" class="aet-num" data-path="action.threshold" data-type="number" value="${esc(a.threshold)}" min="1" max="6"><span class="aet-muted">or higher on any d6</span></label></div>`;
      case "restoreDuplicates":
        return `<div class="aet-fields">
          <label class="aet-inline"><span>Back to</span><input type="number" class="aet-num" data-path="action.count" data-type="number" value="${esc(a.count)}" min="1"><span class="aet-muted">duplicates</span></label>
          <label class="aet-inline"><span>Chat reason</span><input type="text" data-path="extra.reason" value="${esc(m.extra.reason)}" placeholder="e.g. takes the Dodge action"></label></div>`;
      case "note":
        return `<p class="aet-muted">Posts a line in chat. Choose “End the effect” below for effects that end when this happens.</p>`;
      default: return "";
    }
  }

  #reactionBody(m) {
    const windows = WINDOWS.map(([id, icon, label]) => `<button type="button"
      class="aet-tile aet-edit${m.window === id ? " active" : ""}" data-action="setWindow" data-window="${id}">
      <i class="fa-solid ${icon}"></i><strong>${esc(label)}</strong></button>`).join("");
    const who = `<div class="aet-fields">
      <label class="aet-inline"><span>Who</span><select data-path="who" data-rerender>${options(WHO, m.who)}</select></label>
      ${m.who !== "self" ? `<label class="aet-inline"><span>Within</span><input type="number" class="aet-num" data-path="range" value="${esc(m.range)}" placeholder="any"><span class="aet-muted">ft (empty = any distance)</span></label>
      <label class="aet-check"><input type="checkbox" data-path="extra.sight" data-type="boolean" data-rerender${m.extra.sight ? " checked" : ""}>
        <span>Only if you can see that creature</span></label>` : ""}
    </div>`;
    const outcomes = Object.entries(OUTCOMES).filter(([, o]) => o[2].includes(m.window)).map(([id, [icon, label]]) =>
      `<button type="button" class="aet-tile aet-edit${m.outcome.type === id ? " active" : ""}" data-action="setOutcome" data-type="${id}">
      <i class="fa-solid ${icon}"></i><strong>${esc(label)}</strong></button>`).join("");
    const acts = this.document.system?.activities?.contents ?? [];
    const use = `<div class="aet-fields">
      <label class="aet-check"><input type="checkbox" data-special="payCharges" data-rerender${m.extra.cost ? " checked" : ""}>
        <span>Pay with this item's charges instead of using an activity (Enspelled weapons, wands…)</span></label>
      ${m.extra.cost ? `<div class="aet-sub">
        <label class="aet-inline"><span>Charges</span><input type="number" class="aet-num" data-path="extra.cost.uses" data-type="number" value="${esc(m.extra.cost.uses)}" min="1"></label>
        <label class="aet-inline"><span>Spell level</span><input type="number" class="aet-num" data-path="extra.cost.level" data-type="number" value="${esc(m.extra.cost.level)}" min="0"><span class="aet-muted">used as @castLevel</span></label>
      </div>` : `<label class="aet-inline"><span>Uses activity</span><select data-path="activity">${options([["", "The first reaction activity"], ...acts.map(x => [x.id, x.name])], m.activity)}</select></label>`}
      <label class="aet-check"><input type="checkbox" data-path="extra.reaction" data-type="boolean" data-invert${m.extra.reaction === false ? " checked" : ""}>
        <span>Not a reaction (e.g. a Bonus Action): doesn't need or spend your reaction</span></label>
      <label class="aet-check"><input type="checkbox" data-path="configure" data-type="boolean"${m.configure ? " checked" : ""}>
        <span>Show the usage dialog (e.g. to pick a spell slot)</span></label>
      <label class="aet-inline"><span>Button text</span><input type="text" data-path="label" value="${esc(m.label)}" placeholder="${esc(this.document.name)}"></label>
      <label class="aet-inline"><span>Popup note</span><input type="text" class="aet-wide" data-path="extra.detail" value="${esc(m.extra.detail)}" placeholder="optional, shown next to the button"></label>
      <label class="aet-check"><input type="checkbox" data-path="extra.oncePerTurn" data-type="boolean" data-rerender${m.extra.oncePerTurn ? " checked" : ""}><span>At most once per turn</span></label>
      ${m.extra.oncePerTurn ? `<label class="aet-inline"><span>Shared with</span><input type="text" class="aet-formula" data-path="extra.onceKey" value="${esc(m.extra.onceKey ?? "")}" placeholder="a key (optional)"><span class="aet-muted">popups with the same key count as one (Sneak Attack and its variants)</span></label>` : ""}
      <label class="aet-check"><input type="checkbox" data-path="extra.free" data-type="boolean"${m.extra.free ? " checked" : ""}><span>Free — nothing to use or pay (an ability that's simply active)</span></label>
      <label class="aet-inline"><span>Only if they have</span><input type="text" class="aet-formula" data-path="extra.requiresItem" value="${esc(m.extra.requiresItem ?? "")}" placeholder="an item identifier (optional)"></label>
      ${m.window === "hitting" ? `<label class="aet-check"><input type="checkbox" data-path="extra.atTarget" data-type="boolean"${m.extra.atTarget ? " checked" : ""}>
        <span>Use it on the creature that was hit (e.g. its save — Stunning Strike)</span></label>` : ""}
      ${this.#grantFields(m)}
    </div>`;
    return this.#step(1, "When", `<div class="aet-tiles aet-tiles-4">${windows}</div>${who}`)
      + this.#step(2, "Only if", this.#rows("rows", m.rows, REACTION_FIELDS, [m.window]), "Optional — leave empty to always offer it.")
      + this.#step(3, "Effect", `<div class="aet-tiles">${outcomes}</div>${this.#outcomeFields(m)}`)
      + this.#step(4, "Use", use);
  }

  #grantFields(m) {
    const g = m.extra.after;
    const effects = this.document.effects?.contents ?? [];
    const activities = this.document.system?.activities?.contents ?? [];
    const kind = g?.type ?? "";
    const pick = `<label class="aet-inline"><span>Afterwards</span><select data-special="after" data-rerender>${options([["", "Nothing more"],
      ...(effects.length ? [["giveEffect", "Give one of its effects to creatures"]] : []),
      ...(activities.length > 1 ? [["useActivity", "Use another of its activities on creatures"]] : [])], kind)}</select></label>`;
    if ( !g ) return pick;
    if ( kind === "useActivity" ) return `${pick}<div class="aet-sub">
      <label class="aet-inline"><span>From item</span><input type="text" class="aet-formula" data-path="extra.after.item" value="${esc(g.item ?? "")}" placeholder="this item (or an identifier)" data-rerender></label>
      ${g.item ? "" : `<label class="aet-inline"><span>Activity</span><select data-path="extra.after.activity">${options(activities.map(a => [a.id, a.name || a.type]), g.activity)}</select></label>`}
      ${m.window === "hitting" ? `<label class="aet-check"><input type="checkbox" data-special="afterHit" data-rerender${g.to?.who === "hit" ? " checked" : ""}>
        <span>On the creature that was hit</span></label>` : ""}
      ${m.window === "damageIncoming" ? `<label class="aet-check"><input type="checkbox" data-special="afterZeroed"${g.when === "zeroed" ? " checked" : ""}>
        <span>Only if the damage was reduced to 0 (Deflect Attacks' redirect)</span></label>` : ""}
      ${g.to?.who === "hit" ? "" : this.#selectorFields("extra.after.to", g.to, "reaction")}
      <p class="aet-muted">The activity's own cost and save apply. When creatures are picked, no one skips it.</p></div>`;
    return `${pick}<div class="aet-sub">
      <label class="aet-inline"><span>Effect</span><select data-path="extra.after.effect">${options(effects.map(e => [e.id, e.name]), g.effect)}</select></label>
      ${this.#selectorFields("extra.after.to", g.to, "reaction")}
      <p class="aet-muted">An earlier copy of the same effect on a creature is replaced.</p>
    </div>`;
  }

  /** The reusable "who" block: pick one / everyone matching / a specific creature, with range, sight and side. */
  #selectorFields(path, sel={}, context="trigger") {
    const who = sel.who ?? "choose";
    const matching = ["choose", "all"].includes(who);
    const you = context === "reaction" ? "you" : "the bearer";
    return `<div class="aet-selector">
      <label class="aet-inline"><span>To</span><select data-path="${path}.who" data-rerender>${options(SELECTOR_WHO[context], who)}</select></label>
      ${who === "targets" ? `<label class="aet-inline"><span>Only those that are</span><select data-path="${path}.side">${options(SIDES, sel.side ?? "any")}</select></label>` : ""}
      ${matching ? `
      <label class="aet-inline"><span>Within</span><input type="number" class="aet-num" data-path="${path}.range" data-type="number" value="${esc(sel.range)}" placeholder="any"><span class="aet-muted">ft of</span>
        <select data-path="${path}.from">${options([["", you], ["subject", "the triggering creature"]], sel.from ?? "")}</select></label>
      ${who === "choose" ? `<label class="aet-inline"><span>How many</span><input type="text" class="aet-num" data-path="${path}.count" value="${esc(sel.count ?? "")}" placeholder="1"><span class="aet-muted">up to — a number or e.g. @prof</span></label>` : ""}
      <label class="aet-inline"><span>From</span><select data-path="${path}.pool">${options([["nearby", "Creatures on the map"], ["targets", "The triggering spell's targets"], ["combat", "Creatures in the combat"]], sel.pool ?? "nearby")}</select></label>
      <label class="aet-inline"><span>Who counts</span><select data-path="${path}.side">${options(SIDES, sel.side ?? "any")}</select></label>
      ${context === "trigger" ? `<label class="aet-inline"><span>Chosen by</span><select data-path="${path}.by" data-rerender>${options([["", you], ["source", "the effect's source (range from them)"]], sel.by ?? "")}</select></label>` : ""}
      <label class="aet-check"><input type="checkbox" data-path="${path}.able" data-type="boolean"${sel.able ? " checked" : ""}><span>Not Incapacitated</span></label>
      <label class="aet-check"><input type="checkbox" data-path="${path}.sight" data-type="boolean"${sel.sight ? " checked" : ""}><span>Only creatures ${you} can see</span></label>
      <label class="aet-check"><input type="checkbox" data-path="${path}.self" data-type="boolean" data-invert${sel.self === false ? " checked" : ""}><span>Not ${you === "you" ? "yourself" : "the bearer"}</span></label>
      <label class="aet-check"><input type="checkbox" data-path="${path}.notSubject" data-type="boolean"${sel.notSubject ? " checked" : ""}><span>Not the triggering creature</span></label>` : ""}
      <p class="aet-muted">→ ${esc(describeSelector(sel, { you: context === "reaction" ? "you" : "the bearer" }))}</p>
    </div>`;
  }

  #outcomeFields(m) {
    const o = m.outcome;
    switch ( o.type ) {
      case "acBonus":
        return `<div class="aet-fields"><label class="aet-inline"><span>AC bonus</span><input type="number" class="aet-num" data-path="outcome.value" data-type="number" value="${esc(o.value)}"></label></div>`;
      case "reroll":
        return `<div class="aet-fields"><label class="aet-inline"><span>Keep</span><select data-path="outcome.keep">${options([["lower", "The lower roll"], ["higher", "The higher roll"]], o.keep)}</select></label></div>`;
      case "modifyRoll":
        return `<div class="aet-fields"><label class="aet-inline"><span>Add to the roll</span><input type="text" class="aet-formula" data-path="outcome.bonus" value="${esc(o.bonus)}" placeholder="e.g. -1d6"></label>
          <p class="aet-muted">Negative to lower it. @-references use your data, e.g. <code>-@scale.bard.inspiration</code>.</p></div>`;
      case "damage": {
        const types = damageEntries().filter(([id]) => id in CONFIG.DND5E.damageTypes).map(([id, label]) =>
          `<button type="button" class="aet-pill aet-small aet-edit${(o.types ?? []).includes(id) ? " active" : ""}" data-action="toggleType" data-type="${id}">${esc(label)}</button>`).join("");
        return `<div class="aet-fields">
          <label class="aet-inline"><span>How</span><select data-path="outcome.mode" data-rerender>${options([["half", "Halve all of it"], ["resist", "Resistance to some types"], ["reduce", "Reduce it by an amount"]], o.mode)}</select></label>
          ${o.mode === "reduce" ? `<label class="aet-inline"><span>Reduce by</span><input type="text" class="aet-formula" data-path="outcome.amount" value="${esc(o.amount)}" placeholder="e.g. 1d10 + @abilities.dex.mod"></label>` : ""}
          ${o.mode !== "half" ? `<div class="aet-subtitle">${o.mode === "resist" ? "Resisted types" : "Only these types"} <span class="aet-muted">${o.mode === "reduce" ? "(none = any)" : ""}</span></div><div class="aet-pills">${types}</div>` : ""}
        </div>`;
      }
      case "straight":
        return `<p class="aet-muted">Before the roll is shown, the first of its two d20s is kept and the other ignored.</p>`;
      case "damageNext":
        return `<div class="aet-fields">
          <label class="aet-inline"><span>How</span><select data-path="outcome.mode">${options([["add", "Add damage (same type)"], ["reduce", "Reduce the damage"]], o.mode)}</select></label>
          <label class="aet-inline"><span>Amount</span><input type="text" class="aet-formula" data-path="outcome.formula" value="${esc(o.formula)}" placeholder="(@castLevel + 1)d6"></label>
          ${o.mode !== "reduce" ? `<label class="aet-inline"><span>Damage type</span><select data-path="outcome.damageType">${options([["", "Same as the attack"], ...damageEntries()], o.damageType ?? "")}</select></label>` : ""}
          <label class="aet-check"><input type="checkbox" data-path="outcome.critDouble" data-type="boolean"${o.critDouble ? " checked" : ""}><span>Double the dice on a critical hit</span></label>
          <p class="aet-muted">@castLevel is the slot level the reaction was cast with. Applied when that attack's damage lands.</p></div>`;
      case "counter": {
        const dcMode = o.dc === "source" ? "source" : "fixed";
        return `<div class="aet-fields">
          <label class="aet-inline"><span>Caster saves with</span><select data-path="outcome.ability">${options(abilityEntries(), o.ability)}</select></label>
          <label class="aet-inline"><span>Against</span><select data-special="counterDc" data-rerender>${options([["source", "Your spell save DC"], ["fixed", "A fixed DC"]], dcMode)}</select>
            ${dcMode === "fixed" ? `<input type="number" class="aet-num" data-path="outcome.dc" data-type="number" value="${esc(o.dc)}">` : ""}</label>
          <p class="aet-muted">On a failure the spell fails and nothing is spent.</p></div>`;
      }
      default:
        return `<p class="aet-muted">The item's activity is used as normal; its own effects apply.</p>`;
    }
  }

  /** A list of condition rows. `path` locates the rows array in the model. */
  #rows(path, rows, catalogue, context, addLabel="Add a condition") {
    const fields = availableFields(catalogue, context);
    const list = rows.map((row, j) => {
      if ( row.field === "raw" ) return `<div class="aet-row aet-cond" data-rows="${path}" data-row="${j}">
        <span class="aet-raw-cond"><i class="fa-solid fa-code"></i> Custom condition (edit in Advanced)</span>
        <button type="button" class="aet-icon aet-danger aet-edit" data-action="removeRow" data-tooltip="Remove"><i class="fa-solid fa-xmark"></i></button></div>`;
      const field = catalogue.find(f => f.id === row.field);
      const fieldEntries = [...fields.map(f => [f.id, f.label]), ["custom", "Custom data path…"]];
      if ( field && !fields.includes(field) ) fieldEntries.unshift([field.id, `${field.label} (not for these moments)`]);
      const kind = field?.kind ?? "custom";
      const valueEntries = field ? fieldValueEntries(field) : null;
      const value = valueEntries
        ? `<select data-part="value">${options(valueEntries, row.value)}</select>`
        : `<input type="${kind === "number" ? "number" : "text"}" class="aet-num" data-part="value" value="${esc(row.value)}">`;
      return `<div class="aet-row aet-cond" data-rows="${path}" data-row="${j}">
        ${j ? '<span class="aet-and">and</span>' : '<span class="aet-and">if</span>'}
        <select data-part="field" data-rerender>${options(fieldEntries, row.field)}</select>
        ${kind === "custom" ? `<input type="text" data-part="key" value="${esc(row.key)}" placeholder="e.g. bearer.attributes.hp.value">` : ""}
        ${["bool", "yes1"].includes(kind) ? "" : `<select data-part="op">${options(OPS[kind], row.op)}</select>`}
        ${value}
        <button type="button" class="aet-icon aet-danger aet-edit" data-action="removeRow" data-tooltip="Remove"><i class="fa-solid fa-xmark"></i></button>
      </div>`;
    }).join("");
    return `<div class="aet-conds" data-rows-list="${path}" data-context="${esc(context.join(","))}">${list}
      <button type="button" class="aet-add-small aet-edit" data-action="addRow" data-rows="${path}"><i class="fa-solid fa-plus"></i> ${addLabel}</button></div>`;
  }

  /* -------------------------------------------- */
  /*  Input handling                              */
  /* -------------------------------------------- */

  #modelFor(el) {
    const index = Number(el.closest(".aet-card")?.dataset.index);
    return Number.isInteger(index) ? { index, model: this.models[index] } : {};
  }

  #catalogue() {
    return this.mode === "reactions" ? REACTION_FIELDS : TRIGGER_FIELDS;
  }

  #readValue(el) {
    if ( (el.type === "checkbox") && el.hasAttribute("data-invert") ) return el.checked ? false : true;
    if ( el.type === "checkbox" ) return el.checked;
    if ( el.dataset.type === "number" ) return el.value === "" ? "" : Number(el.value);
    return el.value;
  }

  /** Apply one input's value to the model. Returns true when the form's shape changed. */
  #apply(el) {
    const { model } = this.#modelFor(el);
    if ( !model ) return false;
    if ( el.dataset.path ) {
      foundry.utils.setProperty(model, el.dataset.path, this.#readValue(el));
      return el.hasAttribute("data-rerender");
    }
    if ( el.dataset.special === "dcMode" ) model.action.dc = ["source", "sourceSpell"].includes(el.value) ? el.value
      : (el.value === "formula" ? "8 + @prof + @abilities.cha.mod" : 13);
    if ( el.dataset.special === "storeSchools" ) {
      model.action.schools = el.value.split(",").map(s => s.trim()).filter(Boolean);
      return false;
    }
    if ( el.dataset.special === "everyHours" ) {
      const hours = Number(el.value);
      if ( hours > 0 ) model.extra.every = Math.round(hours * 3600); else delete model.extra.every;
      return false;
    }
    if ( el.dataset.special === "saveWho" ) {
      if ( el.value === "bearer" ) delete model.action.to;
      else if ( ["subject", "targets"].includes(el.value) ) model.action.to = { who: el.value };
      else model.action.to = { who: "choose", range: 30 };
    }
    if ( el.dataset.special === "counterDc" ) model.outcome.dc = el.value === "source" ? "source" : 15;
    if ( el.dataset.special === "after" ) {
      if ( el.value === "giveEffect" ) {
        const first = this.document.effects?.contents[0];
        model.extra.after = { type: "giveEffect", effect: first?.id ?? "", to: { who: "choose", range: 60, sight: true, notSubject: true } };
      } else if ( el.value === "useActivity" ) {
        const other = this.document.system?.activities?.contents.find(a => a.id !== model.activity) ?? this.document.system?.activities?.contents[0];
        model.extra.after = { type: "useActivity", activity: other?.id ?? "", to: { who: "choose", side: "enemy", range: 60, sight: true } };
      } else delete model.extra.after;
    }
    if ( el.dataset.special === "afterHit" ) {
      model.extra.after.to = el.checked ? { who: "hit" } : { who: "choose", side: "enemy", range: 60, sight: true };
      return true;
    }
    if ( el.dataset.special === "afterZeroed" ) {
      if ( el.checked ) model.extra.after.when = "zeroed"; else delete model.extra.after.when;
      return false;
    }
    if ( el.dataset.special === "payCharges" ) {
      if ( el.checked ) model.extra.cost = { uses: 1, level: 1 };
      else delete model.extra.cost;
    }
    if ( el.dataset.special === "actionTo" ) {
      if ( el.checked ) model.action.to = { who: "choose", range: 30 };
      else delete model.action.to;
    }
    if ( el.dataset.special === "senseCreatures" ) {
      if ( el.checked ) model.action.creatures = [];
      else delete model.action.creatures;
    }
    if ( el.dataset.special === "customStatuses" ) {
      const known = new Set(statusEntries().map(([id]) => id));
      model.action.statuses = [...(model.action.statuses ?? []).filter(s => known.has(s)),
        ...el.value.split(",").map(s => s.trim()).filter(Boolean)];
      return false;
    }
    if ( el.dataset.special === "senseMagic" ) {
      if ( el.checked ) model.action.items = "magic"; else delete model.action.items;
      return false;
    }
    if ( el.dataset.special === "senseType" ) {
      const types = new Set(model.action.creatures?.find?.(f => f.k === "details.type.value")?.v ?? []);
      if ( el.checked ) types.add(el.value); else types.delete(el.value);
      model.action.creatures = types.size ? [{ k: "details.type.value", o: "in", v: [...types] }] : [];
      return false;
    }
    if ( el.dataset.special === "damageTo" ) {
      if ( el.checked ) model.action.to = { who: "subject" };
      else delete model.action.to;
    }
    if ( el.dataset.special === "saveDamage" ) {
      if ( el.checked ) model.action.damage = { formula: "1d6", type: "poison", onSuccess: "none" };
      else delete model.action.damage;
    }
    if ( el.dataset.special ) return true;
    if ( el.dataset.modPart ) {
      const mod = model.mods[Number(el.closest(".aet-mod").dataset.mod)];
      mod[el.dataset.modPart] = el.value;
      if ( el.dataset.modPart === "kind" ) mod.value = ["bonus", "dc"].includes(el.value) ? (mod.value || "") : "";
      return el.dataset.modPart === "kind";
    }
    if ( el.dataset.part ) {
      const rowEl = el.closest(".aet-cond");
      const rows = foundry.utils.getProperty(model, rowEl.dataset.rows);
      const row = rows[Number(rowEl.dataset.row)];
      if ( el.dataset.part === "field" ) {
        const catalogue = rowEl.dataset.rows.startsWith("mods.") ? MODIFIER_FIELDS : this.#catalogue();
        const field = catalogue.find(f => f.id === el.value);
        row.field = el.value;
        row.op = OPS[field?.kind ?? "custom"][0][0];
        row.value = field ? (fieldValueEntries(field)?.[0]?.[0] ?? "") : "";
        if ( !field ) row.key = row.key ?? "";
        return true;
      }
      row[el.dataset.part] = el.value;
      return false;
    }
    return false;
  }

  #onChange(event) {
    const el = event.target;
    if ( el.classList.contains("aet-raw") ) return;
    if ( el.closest(".aet-rules") || el.closest(".aet-settings") ) {
      if ( this.#applyExtra(el) ) this.render();
      else this.#refreshStatus();
      return;
    }
    if ( !el.closest(".aet-card") ) return;
    if ( this.#apply(el) ) this.render();
    else this.#refreshCard(el);
  }

  #onInput(event) {
    const el = event.target;
    if ( !el.matches('input[type="text"], input[type="number"]') || !el.closest(".aet-card") ) return;
    this.#apply(el);
    this.#refreshCard(el);
  }

  /** Effect rules and activity settings inputs. Returns true when the form's shape changed. */
  #applyExtra(el) {
    if ( el.dataset.ruleList ) {
      const list = new Set(this.rules[el.dataset.ruleList] ?? []);
      if ( el.checked ) list.add(el.value);
      else list.delete(el.value);
      this.rules[el.dataset.ruleList] = [...list];
      return false;
    }
    if ( el.dataset.rule === "diceMode" ) {
      if ( el.value in DICE_FILTERS ) this.rules.diceFilter = JSON.stringify(DICE_FILTERS[el.value]);
      return true;
    }
    if ( el.dataset.rule ) {
      this.rules[el.dataset.rule] = el.type === "checkbox" ? el.checked : el.value;
      return el.hasAttribute("data-rerender");
    }
    const key = el.dataset.setting;
    if ( key === "payOn" ) { this.settings.pay = el.checked ? { cost: 1, from: [] } : null; return true; }
    if ( key === "propertiesText" ) {
      this.settings.properties = el.value.split(",").map(s => s.trim()).filter(Boolean);
      return false;
    }
    if ( key === "targetPick" ) {
      this.settings.targetFilter = TARGET_PICKS[el.value] ?? (el.value === "custom" ? this.settings.targetFilter : null);
      return false;
    }
    if ( key === "summonEffect" ) {
      const list = new Set(this.settings.summonEffects ?? []);
      if ( el.checked ) list.add(el.value); else list.delete(el.value);
      this.settings.summonEffects = [...list];
      return false;
    }
    if ( key === "chooseOn" ) { this.settings.chooseEffects = el.checked ? { count: "1" } : null; return true; }
    if ( key === "pay.from" ) { this.settings.pay.from = el.value.split(",").map(s => s.trim()).filter(Boolean); return false; }
    if ( key === "pay.cost" ) { this.settings.pay.cost = Number(el.value) || 1; return false; }
    if ( key ) foundry.utils.setProperty(this.settings, key, el.value);
    return false;
  }

  #refreshStatus() {
    const status = this.element.querySelector(".aet-status");
    if ( status ) status.innerHTML = this.dirty ? '<i class="fa-solid fa-circle"></i> Unsaved changes' : "";
  }

  /** Update a card's sentence, warnings and the footer without re-rendering (keeps focus while typing). */
  #refreshCard(el) {
    const card = el.closest(".aet-card");
    const { model } = this.#modelFor(el);
    if ( !card || !model ) return;
    card.querySelector(".aet-sentence").textContent = this.#describe(model);
    const errors = this.#errors(model);
    card.classList.toggle("invalid", !!errors.length);
    const list = card.querySelector(".aet-errors");
    if ( errors.length ) {
      const html = `<ul class="aet-errors">${errors.map(e => `<li>${esc(e)}</li>`).join("")}</ul>`;
      if ( list ) list.outerHTML = html;
      else card.querySelector(".aet-card-body").insertAdjacentHTML("afterbegin", html);
    } else list?.remove();
    const warn = card.querySelector(".aet-warn");
    if ( errors.length && !warn ) card.querySelector(".aet-tools").insertAdjacentHTML("beforebegin",
      `<i class="fa-solid fa-triangle-exclamation aet-warn"></i>`);
    if ( !errors.length ) warn?.remove();
    if ( warn && errors.length ) warn.dataset.tooltip = errors.join(" ");
    const status = this.element.querySelector(".aet-status");
    if ( status ) status.innerHTML = this.dirty ? '<i class="fa-solid fa-circle"></i> Unsaved changes' : "";
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #index(target) {
    return Number(target.closest(".aet-card")?.dataset.index);
  }

  static #onOpenArea() {
    TriggerEditor.open(this.document, { activity: this.activity, area: true });
  }

  static #onAddPreset(event, target) {
    const presets = this.mode === "reactions" ? REACTION_PRESETS : (this.mode === "area" ? AREA_PRESETS : TRIGGER_PRESETS);
    const preset = presets[Number(target.dataset.preset)];
    const data = clone(preset.data);
    if ( preset.rules ) for ( const [k, v] of Object.entries(preset.rules) ) if ( !this.rules[k] ) this.rules[k] = v;
    if ( (data.action?.type === "rollActivity") && this.parentItem ) {
      data.action.item = this.parentItem.system.identifier || this.parentItem.name;
    }
    this.models.push(this.mode === "reactions" ? reactionToModel(data) : triggerToModel(data));
    this.open = new Set([this.models.length - 1]);
    this.render().then(() => this.element.querySelector(".aet-card.open")?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  static #onAddBlank() {
    if ( this.mode === "activity" ) {
      this.models.push(triggerToModel({ event: ["activity"], action: { type: "note" } }));
      this.open = new Set([this.models.length - 1]);
      return this.render();
    }
    const data = this.mode === "reactions"
      ? { window: "hitBy", who: "self", outcome: { type: "none" } }
      : this.mode === "area"
        ? { event: ["areaEnter"], action: { type: "useActivity", to: { who: "targets" } }, then: "keep" }
        : { event: [], action: { type: "save", ability: "con", dc: "source" }, then: "removeOnSuccess" };
    this.models.push(this.mode === "reactions" ? reactionToModel(data) : triggerToModel(data));
    this.open = new Set([this.models.length - 1]);
    this.render().then(() => this.element.querySelector(".aet-card.open")?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  static #onToggle(event, target) {
    const i = TriggerEditor.#index(target);
    if ( this.open.has(i) ) this.open.delete(i);
    else this.open.add(i);
    target.closest(".aet-card").classList.toggle("open", this.open.has(i));
  }

  static #onDuplicate(event, target) {
    event.stopPropagation();
    const i = TriggerEditor.#index(target);
    this.models.splice(i + 1, 0, clone(this.models[i]));
    this.open = new Set([i + 1]);
    this.render();
  }

  static async #onRemove(event, target) {
    event.stopPropagation();
    const i = TriggerEditor.#index(target);
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete?" },
      content: `<p>Delete this ${this.mode === "reactions" ? "reaction" : "trigger"}?</p><p class="aet-muted">${esc(this.#describe(this.models[i]))}</p>`,
      yes: { label: "Delete", icon: "fa-solid fa-trash" }, no: { label: "Keep" }
    });
    if ( !ok ) return;
    this.models.splice(i, 1);
    this.open = new Set([...this.open].filter(x => x !== i).map(x => x > i ? x - 1 : x));
    this.render();
  }

  static #onMove(event, target) {
    event.stopPropagation();
    const i = TriggerEditor.#index(target);
    const j = target.dataset.action === "moveUp" ? i - 1 : i + 1;
    [this.models[i], this.models[j]] = [this.models[j], this.models[i]];
    const wasOpen = [this.open.has(i), this.open.has(j)];
    this.open.delete(i); this.open.delete(j);
    if ( wasOpen[0] ) this.open.add(j);
    if ( wasOpen[1] ) this.open.add(i);
    this.render();
  }

  static #onToggleEvent(event, target) {
    const model = this.models[TriggerEditor.#index(target)];
    const id = target.dataset.event;
    model.events = model.events.includes(id) ? model.events.filter(e => e !== id) : [...model.events, id];
    this.render();
  }

  static #onSetAction(event, target) {
    const model = this.models[TriggerEditor.#index(target)];
    const type = target.dataset.type;
    if ( model.action.type === type ) return;
    model.action = clone(DEFAULT_ACTIONS[type]);
    if ( (type === "rollActivity") && this.parentItem ) model.action.item = this.parentItem.system.identifier || this.parentItem.name;
    if ( type !== "save" ) model.mods = [];
    if ( !thenEntries(type).some(([id]) => id === model.then) ) model.then = "keep";
    if ( type === "save" ) model.then = "removeOnSuccess";
    this.render();
  }

  static #onSetWindow(event, target) {
    const model = this.models[TriggerEditor.#index(target)];
    const win = target.dataset.window;
    if ( model.window === win ) return;
    model.window = win;
    model.who = WINDOWS.find(w => w[0] === win)[3];
    if ( !OUTCOMES[model.outcome.type]?.[2].includes(win) ) {
      const first = Object.entries(OUTCOMES).find(([, o]) => o[2].includes(win))[0];
      model.outcome = clone(DEFAULT_OUTCOMES[first]);
    }
    model.rows = model.rows.filter(r => {
      const f = REACTION_FIELDS.find(x => x.id === r.field);
      return !f?.on || f.on.includes(win);
    });
    this.render();
  }

  static #onSetOutcome(event, target) {
    const model = this.models[TriggerEditor.#index(target)];
    if ( model.outcome.type === target.dataset.type ) return;
    model.outcome = clone(DEFAULT_OUTCOMES[target.dataset.type]);
    this.render();
  }

  static #onToggleType(event, target) {
    const model = this.models[TriggerEditor.#index(target)];
    const types = new Set(model.outcome.types ?? []);
    if ( types.has(target.dataset.type) ) types.delete(target.dataset.type);
    else types.add(target.dataset.type);
    model.outcome.types = [...types];
    this.render();
  }

  static #onToggleStatus(event, target) {
    const model = this.models[TriggerEditor.#index(target)];
    const list = new Set(model.action.statuses ?? []);
    if ( list.has(target.dataset.status) ) list.delete(target.dataset.status);
    else list.add(target.dataset.status);
    model.action.statuses = [...list];
    this.render();
  }

  static #onAddRow(event, target) {
    const model = this.models[TriggerEditor.#index(target)];
    const path = target.dataset.rows;
    const rows = foundry.utils.getProperty(model, path);
    const catalogue = path.startsWith("mods.") ? MODIFIER_FIELDS : this.#catalogue();
    const context = this.mode === "reactions" ? [model.window] : (path.startsWith("mods.") ? [] : model.events);
    rows.push(newRow(catalogue, context));
    this.render();
  }

  static #onRemoveRow(event, target) {
    const model = this.models[TriggerEditor.#index(target)];
    const rowEl = target.closest(".aet-cond");
    foundry.utils.getProperty(model, rowEl.dataset.rows).splice(Number(rowEl.dataset.row), 1);
    this.render();
  }

  static #onAddResult(event, target) {
    const model = this.models[TriggerEditor.#index(target)];
    const results = model.action.results ??= [];
    const last = Number(String(results.at(-1)?.roll ?? "0").split("-").pop()) || 0;
    results.push({ roll: String(last + 1), effect: "" });
    this.render();
  }

  static #onRemoveResult(event, target) {
    const model = this.models[TriggerEditor.#index(target)];
    model.action.results?.splice(Number(target.closest("[data-result]").dataset.result), 1);
    this.render();
  }

  static #onAddMod(event, target) {
    const model = this.models[TriggerEditor.#index(target)];
    model.mods.push({ kind: "advantage", value: "", rows: [], label: "" });
    this.render();
  }

  static #onRemoveMod(event, target) {
    const model = this.models[TriggerEditor.#index(target)];
    model.mods.splice(Number(target.closest(".aet-mod").dataset.mod), 1);
    this.render();
  }

  static #onToggleAdvanced() {
    this.showAdvanced = !this.showAdvanced;
    this.rawError = "";
    this.render();
  }

  static #onApplyRaw() {
    const text = this.element.querySelector(".aet-raw")?.value ?? "[]";
    try {
      let data = JSON.parse(text);
      if ( (this.mode === "activity") && data && !Array.isArray(data) && (data.onUse || data.onHit) ) {
        this.models = [...(data.onUse ?? []).map(x => triggerToModel({ event: ["activity"], action: x })),
          ...(data.onHit ?? []).map(x => ({ ...triggerToModel({ event: ["activity"], action: x }), phase: "hit" }))];
        data = null;
      }
      if ( data && !Array.isArray(data) ) data = [data];
      if ( data ) this.models = data.map(x => this.mode === "reactions" ? reactionToModel(x)
        : this.mode === "activity" ? triggerToModel({ event: ["activity"], action: x }) : triggerToModel(x));
      this.rawError = "";
      this.open = new Set();
      ui.notifications.info("Raw data loaded — check the cards, then Save.");
    } catch(err) {
      this.rawError = `That isn't valid JSON: ${err.message}`;
    }
    this.render();
  }

  static async #onSave() {
    const bad = this.models.map((m, i) => [i, this.#errors(m)]).filter(([, e]) => e.length);
    if ( bad.length ) {
      bad.forEach(([i]) => this.open.add(i));
      await this.render();
      this.element.querySelector(".aet-card.invalid")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return ui.notifications.warn(`Fix the highlighted ${bad.length === 1 ? "item" : "items"} first.`);
    }
    const list = this.#output();
    if ( this.mode === "activity" ) {
      const s = this.settings;
      const onUse = Array.isArray(list) ? list : list.onUse;
      const onHit = Array.isArray(list) ? [] : list.onHit;
      await this.activity.update({ [`flags.${MODULE_ID}`]: {
        ...(this.activity.flags?.[MODULE_ID] ?? {}),
        onUse: onUse.length ? onUse : null, onHit: onHit.length ? onHit : null,
        pay: s.pay?.from?.length ? s.pay : null, chooseEffects: s.chooseEffects ?? null,
        targetFilter: s.targetFilter?.length ? s.targetFilter : null, summonEffects: s.summonEffects?.length ? s.summonEffects : null,
        repeat: (Number(s.repeat?.count) > 1) ? { count: Number(s.repeat.count), ...(s.repeat.swap ? { swap: s.repeat.swap } : {}) } : null,
        mastery: s.mastery || null, properties: s.properties?.length ? s.properties : null
      } });
    } else if ( this.mode === "area" ) {
      await this.activity.update({ [`flags.${MODULE_ID}`]: {
        ...(this.activity.flags?.[MODULE_ID] ?? {}), area: list.length ? { triggers: list } : null
      } });
    } else {
      const key = `flags.${MODULE_ID}.${this.mode}`;
      const update = list.length ? { [key]: list } : { [`flags.${MODULE_ID}.-=${this.mode}`]: null };
      if ( this.mode === "triggers" ) Object.assign(update, rulesUpdate(this.rules));
      await this.document.update(update);
    }
    this.#saved = this.#snapshot();
    ui.notifications.info(`${{ activity: "Automation", area: "Area triggers", reactions: "Reactions", triggers: "Triggers" }[this.mode]} saved on ${this.activity?.name ?? this.document.name}.`);
    return this.close({ force: true });
  }

  static #onCancel() {
    return this.close();
  }
}

/* -------------------------------------------- */
/*  Sheet integration                           */
/* -------------------------------------------- */

const hasReactionActivity = item => item.system?.activities?.some?.(a => a.activation?.type === "reaction");

/** ⚡ entry in the header menu of effect and item sheets. */
Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
  const activity = app.activity ?? (app.document?.documentName === "Activity" ? app.document : null);
  if ( activity?.item ) {
    if ( !game.user.isGM && !activity.item.isOwner ) return;
    controls.unshift({ icon: "fa-solid fa-bolt", label: "Automation (Alivas's Engine)", action: "aetOpenAutomation",
      onClick: () => TriggerEditor.open(activity.item, { activity }) });
    return;
  }
  const doc = app.document;
  if ( !doc || !["ActiveEffect", "Item"].includes(doc.documentName) ) return;
  if ( !game.user.isGM && !doc.isOwner ) return;
  const reactions = doc.documentName === "Item";
  controls.unshift({
    icon: "fa-solid fa-bolt",
    label: reactions ? "Reactions (Alivas's Engine)" : "Triggers (Alivas's Engine)",
    action: "aetOpenEditor",
    onClick: () => TriggerEditor.open(doc)
  });
});

function summaryBlock(title, sentences, buttonLabel, emptyText) {
  const list = sentences.length
    ? `<ol class="aet-summary-list">${sentences.map(s => `<li>${esc(s)}</li>`).join("")}</ol>`
    : `<p class="aet-muted">${emptyText}</p>`;
  return `<fieldset class="aet-summary"><legend><i class="fa-solid fa-bolt"></i> ${title}</legend>${list}
    <button type="button" class="aet-summary-edit"><i class="fa-solid fa-pen-to-square"></i> ${buttonLabel}</button></fieldset>`;
}

/** An effect's rules (flags besides triggers) as sentences. */
function describeRules(effect) {
  const r = readRules(effect);
  const f = effect.flags?.[MODULE_ID] ?? {};
  const list = [];
  const abl = ids => ids.map(id => CONFIG.DND5E.abilities[id]?.label ?? id).join(", ");
  if ( r.noReactions ) list.push("The bearer can't take reactions.");
  if ( r.noComponents ) list.push("The bearer's spells have no components.");
  if ( r.askFirst ) list.push(`Asks before applying: “${r.askFirst}”`);
  if ( r.ignoreDamageFrom ) list.push(`Ignores damage from ${r.ignoreDamageFrom}.`);
  if ( r.minLevel ) list.push(`Needs a level ${r.minLevel}+ slot.`);
  if ( r.saveDamageOnSave ) list.push(`The bearer's save spells${r.saveDamageLevel !== "" ? ` of level ${r.saveDamageLevel}` : ""} deal ${r.saveDamageOnSave} damage on a success.`);
  if ( r.ownRollsOnly ) list.push("Its roll bonuses don't carry over to the bearer's summons.");
  if ( r.evasion?.length ) list.push(`Evasion on ${abl(r.evasion)} saves.`);
  if ( r.saveAdvStatuses?.length ) list.push(`Advantage on saves against becoming ${r.saveAdvStatuses.map(statusLabel).join(" / ")}.`);
  if ( r.healingExtraDie ) list.push("The bearer's healing rolls an extra die and drops the lowest.");
  if ( r.noHealing ) list.push("The bearer can't regain hit points.");
  if ( r.dropSave ) list.push(`At 0 HP from damage: ${abl([r.dropAbility])} save (DC ${r.dropDc}) to stay at 1${r.dropRadiant ? ", not vs Radiant" : ""}${r.dropCrit ? ", not vs a critical hit" : ""}.`);
  if ( r.onlyIfStatus ) list.push(r.onlyIfStatus === "custom" ? "Auto-applied only to targets matching a custom filter." : `Auto-applied only to targets that are ${statusLabel(r.onlyIfStatus)}.`);
  if ( Number(r.areaRadius) > 0 ) list.push(`An area of ${r.areaRadius} ft around the bearer moves with it.`);
  if ( r.stopOnCollision ) list.push("Stops when it moves into a creature.");
  if ( r.disengaged ) list.push("Moving doesn't offer Opportunity Attacks.");
  if ( r.attacksMode ) list.push(`The bearer's attacks have ${r.attacksMode}${r.attacksOnce ? " (the next one only)" : ""}.`);
  if ( r.attackedMode ) list.push(`Attacks against the bearer have ${r.attackedMode}${r.attackedOnce ? " (the next one only)" : ""}.`);
  if ( Number(r.extraAttack) > 0 ) list.push(`${r.extraAttack} extra attack${Number(r.extraAttack) > 1 ? "s" : ""} with the Attack action.`);
  if ( r.attackAdd?.length ) list.push(`Weapon attacks may also use ${abl(r.attackAdd)}${r.attackProficient ? " (proficient weapons)" : ""}.`);
  if ( r.attackOnly?.length ) list.push(`Weapon attacks must use ${abl(r.attackOnly)}.`);
  const typeNames = ids => ids.map(id => game.i18n.localize(CONFIG.DND5E.creatureTypes[id]?.label ?? id)).join(", ");
  if ( r.attackedMode && (r.attackedBySource || r.attackedTypes?.length) ) list.push(`(${r.attackedMode} only ${r.attackedBySource ? "for the source's attacks" : ""}${r.attackedBySource && r.attackedTypes?.length ? " and " : ""}${r.attackedTypes?.length ? `from ${typeNames(r.attackedTypes)}` : ""}.)`);
  if ( r.attacksMode && r.attacksUnlessSource ) list.push("(not against the source.)");
  if ( String(r.reduceFormula ?? "").trim() ) list.push(`Incoming ${r.reduceTypes?.length ? r.reduceTypes.map(damageLabel).join(" / ").toLowerCase() + " " : ""}damage is reduced by ${r.reduceFormula}${r.reduceOnce ? " (once per turn)" : ""}.`);
  if ( Number(r.diceMin) > 1 ) list.push(`The bearer's damage dice count at least ${r.diceMin}${(parseFilterText(r.diceFilter) ?? []).length ? " (on matching attacks)" : ""}.`);
  if ( (Number(r.lightBright) > 0) || (Number(r.lightDim) > 0) ) list.push(`Sheds light (${r.lightBright || 0}/${r.lightDim || 0} ft) while it lasts.`);
  if ( r.noSpells ) list.push("The bearer can't cast spells or concentrate.");
  if ( r.sustainEvents?.length ) list.push(`Ends at the end of the bearer's turn unless it ${r.sustainEvents.join(" / ")}${(parseFilterText(r.sustainFilter) ?? []).length ? " (matching a condition)" : ""} during it.`);
  return list;
}

/** An activity's automation (its engine flags) as sentences. */
function describeActivityAutomation(activity) {
  const f = activity.flags?.[MODULE_ID] ?? {};
  const item = activity.item;
  const list = [];
  for ( const action of Array.isArray(f.onUse) ? f.onUse : [] ) {
    try { list.push(describeTrigger({ event: ["activity"], action }).replace(/^[^:]*: /, "Right after it's used: ")); }
    catch(err) { list.push("(a step the editor can't read)"); }
  }
  for ( const action of Array.isArray(f.onHit) ? f.onHit : [] ) {
    try { list.push(describeTrigger({ event: ["activity"], action }).replace(/^[^:]*: /, "When it hits: ")); }
    catch(err) { list.push("(a step the editor can't read)"); }
  }
  if ( f.pay?.from?.length ) list.push(`Paid from ${f.pay.from.join(", ")} (${f.pay.cost ?? 1} each).`);
  if ( f.chooseEffects ) list.push(`The user picks ${f.chooseEffects.count ?? 1} of its effects.`);
  if ( f.targetFilter?.length ) list.push("Used automatically when its single target matches.");
  if ( f.summonEffects?.length ) list.push(`Puts ${f.summonEffects.map(id => item?.effects.get(id)?.name ?? id).join(", ")} on what it summons.`);
  if ( f.repeat?.count > 1 ) list.push(`${f.repeat.count} strikes per use${f.repeat.swap ? ` (one may be ${f.repeat.swap})` : ""}.`);
  for ( const tr of f.area?.triggers ?? [] ) {
    try { list.push(`Its area: ${describeTrigger(tr)}`); } catch(err) { list.push("Its area: (a trigger the editor can't read)"); }
  }
  return list;
}

/** Effect sheet: triggers as sentences at the top of the Details tab. */
Hooks.on("renderActiveEffectConfig", (app, html) => {
  const effect = app.document;
  const tab = html.querySelector('.tab[data-tab="details"]');
  if ( !tab || tab.querySelector(".aet-summary") ) return;
  const triggers = effect.getFlag(MODULE_ID, "triggers") ?? [];
  const sentences = (Array.isArray(triggers) ? triggers : []).map(t => {
    try { return describeTrigger(t); } catch(err) { return "(a trigger the editor can't read)"; }
  });
  const rules = describeRules(effect);
  tab.insertAdjacentHTML("afterbegin", summaryBlock("Triggers", [...sentences, ...rules.map(s => `Rule: ${s}`)],
    (sentences.length || rules.length) ? "Edit triggers and rules" : "Add triggers or rules", "No triggers or rules."));
  tab.querySelector(".aet-summary-edit").addEventListener("click", () => TriggerEditor.open(effect));
});

/** Item sheet: reactions as sentences on the Activities tab, when the item has (or could obviously have) any. */
Hooks.on("renderItemSheet5e", (app, html) => {
  const item = app.document;
  const tab = html.querySelector('.tab[data-tab="activities"]');
  const reactions = item.getFlag(MODULE_ID, "reactions") ?? [];
  if ( !tab || tab.querySelector(".aet-summary") ) return;
  // Activity automation (per activity, with its own edit button), then reaction popups.
  const automated = (item.system.activities?.contents ?? []).map(a => ({ activity: a, lines: describeActivityAutomation(a) })).filter(x => x.lines.length);
  const hasReactions = (Array.isArray(reactions) && reactions.length) || hasReactionActivity(item);
  if ( !automated.length && !hasReactions ) return;
  if ( automated.length ) {
    const rows = automated.map(({ activity, lines }) => `<div class="aet-summary-activity"><div><div class="aet-summary-sub">${esc(activity.name || activity.type)}</div>
      <ol class="aet-summary-list">${lines.map(s => `<li>${esc(s)}</li>`).join("")}</ol></div>
      <button type="button" data-aet-activity="${activity.id}"><i class="fa-solid fa-pen-to-square"></i> Edit</button></div>`).join("");
    tab.insertAdjacentHTML("afterbegin", `<fieldset class="aet-summary aet-summary-activities"><legend><i class="fa-solid fa-bolt"></i> Activity automation</legend>${rows}</fieldset>`);
    tab.querySelectorAll("[data-aet-activity]").forEach(b => b.addEventListener("click", () =>
      TriggerEditor.open(item, { activity: item.system.activities.get(b.dataset.aetActivity) })));
  }
  if ( !hasReactions ) return;
  const sentences = reactions.map(r => {
    try { return describeReaction(r, item); } catch(err) { return "(a reaction the editor can't read)"; }
  });
  tab.insertAdjacentHTML("afterbegin", summaryBlock("Reaction popups", sentences,
    sentences.length ? "Edit reactions" : "Set up a reaction popup",
    "This item has a reaction activity but no popup set up."));
  tab.querySelector(".aet-summary-edit").addEventListener("click", () => TriggerEditor.open(item));
});

/** Converters, exported for tests and macros. */
export const converters = { triggerToModel, modelToTrigger, reactionToModel, modelToReaction, validateTrigger, validateReaction };
