/**
 * Alivas's Engine of Triggers — world settings for the table-ruling modules (bodies, trading, cover, action economy,
 * token interactions, maneuvers, loot piles and locks). Registered in "init" (main.mjs), BEFORE registerSettingsMenu(), so
 * settings-app.mjs can hide them from the flat list and show them in the grouped "Automation settings" window.
 * Read them anywhere with `opt(key)`; every default equals the value the code used before it was configurable.
 */

const MODULE_ID = "alivas-engine-of-triggers";

/** Read one of this module's world settings. */
export const opt = key => game.settings.get(MODULE_ID, key);

const bool = (name, hint, def = true) => ({ name, hint, type: Boolean, default: def });
const num = (name, hint, def, min, max, step = 1) => ({ name, hint, type: Number, default: def, range: { min, max, step } });
const text = (name, hint, def) => ({ name, hint, type: String, default: def });
const pick = (name, hint, def, choices) => ({ name, hint, type: String, default: def, choices });

const DEFS = {
  /* Bodies and looting */
  bodiesCarry: bool("Carrying bodies", "Offer \"Pick up\" on an unconscious, dead or 0-HP creature: the carrier gets the body as a container item. Putting a carried body down always works."),
  bodiesLoot: bool("Looting the unconscious", "Offer \"Loot\" on an unconscious, dead or 0-HP creature (a window of its items; each Take costs an object interaction in combat)."),
  bodiesPickpocket: bool("Pickpocketing", "Offer \"Pickpocket\" on a conscious creature: Utilize action, Sleight of Hand against its passive Perception, one small item."),
  pickpocketRequiresHidden: bool("Pickpocketing needs Hidden", "The pickpocket must be hidden (status hiding or invisible). Off: anyone can try."),
  pickpocketAskDisadvantage: bool("Pickpocketing: ask the GM about disadvantage", "The GM is asked whether the target is alert or suspicious (disadvantage). Off: never disadvantage."),
  pickpocketMaxLb: num("Pickpocketing: heaviest item (lb)", "A pickpocket can take one unit of an unequipped, non-container item of at most this weight.", 1, 0, 100, 0.5),
  bodyWeightTiny: num("Body weight: Tiny (lb)", "Used when the creature's own weight field is empty.", 8, 1, 100000),
  bodyWeightSm: num("Body weight: Small (lb)", "", 35, 1, 100000),
  bodyWeightMed: num("Body weight: Medium (lb)", "", 150, 1, 100000),
  bodyWeightLg: num("Body weight: Large (lb)", "", 500, 1, 100000),
  bodyWeightHuge: num("Body weight: Huge (lb)", "", 2000, 1, 100000),
  bodyWeightGrg: num("Body weight: Gargantuan (lb)", "", 10000, 1, 1000000),

  /* Token interactions */
  interactMenu: bool("Token interaction menu (right-click)", "Right-clicking a token you don't own opens a menu of the interactions available (Pick up, Loot, Pickpocket…)."),
  interactHud: bool("Token interactions in the Token HUD", "The same interactions as buttons on the Token HUD (owners and the GM)."),
  interactionRange: num("Interaction range (ft)", "How close the acting token must be for a token interaction.", 5, 0, 120, 5),

  /* Trading */
  tradeRules: bool("Trading rules", "Dragging an item onto another creature's token hands it over, throws it or has it caught, by the rules below. Off: Item Piles' own give flow (or nothing) applies."),
  tradeAnyDistanceOutOfCombat: bool("Trades out of combat at any distance", "Outside combat a hand-over succeeds at any distance on the scene. Off: reach is required out of combat too (else it is a throw)."),
  tradeThrowRange: num("Throw range (ft)", "Farthest a controlled throw reaches.", 20, 5, 120, 5),
  tradeThrowCheck: pick("Throw under pressure: Strength or Dexterity check", "When a conscious enemy is within 5 ft of the thrower.", "ask",
    { ask: "Ask the GM (default Yes)", always: "Always require it", never: "Never" }),
  tradeThrowCheckDc: num("Throw under pressure: check DC", "", 10, 1, 30),
  tradeCatchDc: num("Catch: Dexterity check DC", "", 10, 1, 30),
  tradeCatchHeavyDc: num("Catch: DC for an awkward or heavy item", "", 15, 1, 30),
  tradeHeavyLb: num("Catch: weight hint (lb)", "The \"awkward or heavy\" question to the GM is preselected Yes at or above this weight.", 10, 1, 1000),
  tradeRetrieveUtilize: bool("Retrieving from a container costs Utilize", "In combat, taking an item out of a container needs a free hand and the Utilize action (a Thief's Fast Hands may use the Bonus Action)."),
  fragileHeuristic: bool("Thrown items can shatter (fragile guess)", "An item that falls after a failed catch shatters when it counts as fragile. A flag on the item (fragile true/false) always wins."),
  fragilePattern: text("Fragile item name pattern", "A regular expression (case-insensitive) on the item's name; potions always count while the guess is on.", "vial|flask|bottle|potion|glass"),
  gmAskTimeout: num("GM prompt timeout: pickpocket (seconds)", "The disadvantage question closes (answer No) after this long. 0 = wait.", 20, 0, 300, 5),
  tradeAskTimeout: num("GM prompt timeout: trading (seconds)", "The throw-check and heavy-item questions use their default answer after this long. 0 = wait.", 0, 0, 300, 5),
  freeHandChecks: bool("Free-hand checks", "Maneuvers that need a free hand, retrieving from a container and catching refuse a creature with two hands full (two-handed weapon, or weapon and shield)."),

  /* Cover */
  coverDialog: bool("Cover choice in the attack dialog", "A \"Target's cover\" selector in the attack roll dialog (Half +2 AC, Three-Quarters +5 AC)."),
  coverButtons: bool("Cover buttons on attack cards", "\"½ cover\" / \"¾ cover\" buttons on attack chat cards, to apply cover after the roll (undoing a lost hit)."),
  damageTypeChoice: bool("Choose the damage type", "When the engine rolls damage that can be of several types (Sacred Weapon's Radiant, a Pact Weapon, Chromatic Orb, weapon options), the roller picks the type each time. Off: dnd5e's last choice on that item, else its first type."),
  flanking: pick("Flanking", "2014 DMG optional rule (squares): you and a creature your faction regards as an ally on opposite sides or corners of an enemy, both adjacent, give each of you this on melee attack rolls against it. Not against a creature you can't see, nor while Incapacitated. Surround (variant, any grid): a creature is flanked when two or more opponents wielding melee weapons have it in reach, at least two of them on opposite sides (size and elevation count); melee attacks against it get +1 per such opponent, up to the attacker's Proficiency Bonus.", "advantage",
    { off: "Off", advantage: "Advantage (DMG)", plus2: "+2 to hit", custom: "Custom modifier (below)",
      surround: "Surround: +1 per flanker, up to PB (stacks with Advantage)" }),
  flankingRanged: bool("Surround flanking: ranged attacks too", "With Flanking set to Surround: ranged weapon and spell attacks against a flanked creature get the bonus too, and ranged attackers add to it. A creature that attacked a target at range on its turn adds +1 to that target's flank bonus from the end of that turn until the end of its next turn, whatever happens to it meanwhile, and keeps adding while it attacks it at range each turn. The target must still be flanked by two melee opponents on opposite sides.", true),
  flankingFormula: text("Flanking: custom modifier", "Added to melee attack rolls when Flanking is set to Custom (a number or formula, e.g. 1d4).", "2"),
  unseenAttacks: bool("Unseen attackers and targets", "Attack rolls against a target the attacker can't see have Disadvantage; attacks by an attacker the target can't see have Advantage. Uses token vision (darkness, Invisible, Blinded; Blindsight, Truesight and See Invisibility count). Scenes without token vision are unaffected."),

  /* Action economy and maneuvers */
  economyTracking: bool("Action economy tracking", "Track each creature's Action, Bonus Action and free object interaction per combat turn, and ask before a creature spends one it doesn't have (trading, looting, pickpocketing, retrieving)."),
  grappleFollowThrough: bool("Variant: Swing and Hurl as part of a Grapple", "After a successful Grapple, the grappler may Swing or Hurl the creature at once for free, as part of that same attack (it doesn't use up an attack). Later Swings and Hurls count as attacks normally. Off: Swing and Hurl are always attacks of the Attack action.", false),
  blockedOffers: bool("Offer Tumble / Overrun when blocked", "When a hostile creature blocks a move, offer the mover its activities flagged as blocked-move options."),
  skillAbilityMenu: bool("Skills with another ability", "Right-click a skill on a character or NPC sheet: \"Roll using a different ability…\"."),

  /* Factions (factions.mjs) */
  factions: bool("Factions", "Every creature token has a faction letter (A, B…); the scene's relations table (flag button on the combat tracker or Token HUD) says how factions regard each other: ally, neutral or hostile. Everything that asks ally or enemy follows it — pickers, auras, reactions, Opportunity Attacks, movement, flanking — and token dispositions are kept in line with it (the party's view). Players' creatures start as the letter below, summons as their summoner, other NPCs as B; the party and B are hostile, other pairs neutral, until you change them. Off: token dispositions decide sides."),
  factionPC: text("Faction of players' creatures", "The letter player-owned creatures start with (unless their sheet sets another).", "A"),
  factionOaAllies: bool("Opportunity Attacks against allies", "Also offer an Opportunity Attack when a creature your faction regards as an ally leaves your reach.", false),

  /* Locks and loot piles */
  doorLocks: bool("Door lock interaction", "Lock DC / force DC / key fields on doors, and players' Pick Lock / Force open / Use key on a locked door."),
  defaultLockDc: num("Default lock and force DC", "Used when a lock, door or pile has no DC of its own.", 15, 1, 40),
  dropTiming: bool("Combat timing for drops", "In combat, equipped armor can't be dropped (doffing takes minutes) and dropping an equipped shield asks for the Utilize action."),
  pileComposite: bool("Loot pile composite image", "A pile of several items shows a combined image of its first items' icons (uploaded to the user data folder). Off: keeps the pile's current image."),
  pileNames: bool("Loot pile automatic names", "A pile is named after its single item, or \"Loot pile (N)\"; names the GM typed are kept."),
  pileSingleScale: num("Single-item pile scale", "Token scale of a pile that holds one item.", 0.75, 0.1, 3, 0.05)
};

/** Keys per grouped section (settings-app.mjs). */
export const GROUPS = {
  bodies: ["bodiesCarry", "bodiesLoot", "bodiesPickpocket", "pickpocketRequiresHidden", "pickpocketAskDisadvantage", "pickpocketMaxLb", "gmAskTimeout",
    "bodyWeightTiny", "bodyWeightSm", "bodyWeightMed", "bodyWeightLg", "bodyWeightHuge", "bodyWeightGrg"],
  interactions: ["interactMenu", "interactHud", "interactionRange"],
  trading: ["tradeRules", "tradeAnyDistanceOutOfCombat", "tradeThrowRange", "tradeThrowCheck", "tradeThrowCheckDc", "tradeCatchDc", "tradeCatchHeavyDc",
    "tradeHeavyLb", "tradeRetrieveUtilize", "fragileHeuristic", "fragilePattern", "tradeAskTimeout"],
  cover: ["coverDialog", "coverButtons", "unseenAttacks", "damageTypeChoice", "flanking", "flankingRanged", "flankingFormula"],
  economy: ["economyTracking", "freeHandChecks", "blockedOffers", "grappleFollowThrough", "skillAbilityMenu"],
  factions: ["factions", "factionPC", "factionOaAllies"],
  locks: ["doorLocks", "defaultLockDc", "dropTiming", "pileComposite", "pileNames", "pileSingleScale"]
};

/** Register every setting above (world scope, hidden from the flat list by settings-app.mjs). Call in "init". */
export function registerAutomationSettings() {
  for ( const [key, def] of Object.entries(DEFS) ) {
    game.settings.register(MODULE_ID, key, { scope: "world", config: true, ...def });
  }
}
