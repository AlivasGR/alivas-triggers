/**
 * Alivas's Engine of Triggers — skill checks with a different ability (2024 PHB: Ability Checks > "Skill checks may use
 * an ability other than the skill's usual one", e.g. Strength (Intimidation)). Standalone: nothing here depends on the
 * rest of the engine's state beyond what `registerSkills` is handed.
 *
 * dnd5e API used:
 *   actor.rollSkill({ skill, ability, advantage, disadvantage, target }, { configure }, { data })
 *     `config.ability` overrides the skill's ability (dnd5e 6 #rollSkillTool: `config.ability ?? skill.ability`), and the
 *     roll dialog's own ability select keeps working. Proficiency / Expertise on the skill still apply (it is the same skill).
 *   hook `renderActorSheetV2` (the base of the v6 character and NPC sheets; Foundry fires it for every subclass)
 *   foundry.applications.ux.ContextMenu(element, selector, entries, { jQuery: false, fixed: true })
 *   foundry.applications.api.DialogV2.prompt  (the ability picker)
 *
 * API (game.modules.get("alivas-engine-of-triggers").api.skills / the named export)
 *   rollSkillWith(actor, skill, ability, { target, advantage, disadvantage, configure = false, flavor }) → the D20Roll[]
 *     skill: a dnd5e skill id ("itm"); ability: an ability id ("str"). configure true shows dnd5e's roll dialog.
 *     The same function backs the check trigger action's `skillAbility` field (maneuvers.mjs rollCheck).
 *
 * SHEET ENTRY
 *   Right-click a skill row on a character sheet (the Details tab's skill list) or an NPC sheet (the skill pills) →
 *   "Roll using a different ability…" → pick one of the six abilities (the skill's own marked "(default)") → the usual
 *   roll dialog opens with that ability. Only offered to the actor's owners.
 */

const MODULE_ID = "alivas-engine-of-triggers";

// Character sheet: <li data-key="itm"> in the skills box. NPC sheet: <a data-action="roll" data-type="skill" data-key="itm">.
const SELECTOR = 'filigree-box.skills li[data-key], a[data-action="roll"][data-type="skill"][data-key]';

/**
 * Roll a skill check using another ability than the skill's usual one.
 * @param {Actor} actor
 * @param {string} skill     dnd5e skill id.
 * @param {string} ability   dnd5e ability id.
 * @returns {Promise<D20Roll[]|null>}
 */
export async function rollSkillWith(actor, skill, ability, { target=null, advantage=false, disadvantage=false, configure=false, flavor=null }={}) {
  if ( !actor?.rollSkill ) return null;
  if ( !CONFIG.DND5E.skills?.[skill] ) { console.warn(`${MODULE_ID} | rollSkillWith: unknown skill "${skill}"`); return null; }
  if ( !CONFIG.DND5E.abilities?.[ability] ) { console.warn(`${MODULE_ID} | rollSkillWith: unknown ability "${ability}"`); return null; }
  const config = { skill, ability, advantage, disadvantage, ...(target ? { target } : {}) };
  const message = flavor ? { data: { flavor } } : {};
  return actor.rollSkill(config, { configure }, message);
}

/** Ask which ability to use, then roll with dnd5e's dialog. */
async function pickAndRoll(actor, skill) {
  const abilities = CONFIG.DND5E.abilities;
  const usual = actor.system.skills?.[skill]?.ability ?? CONFIG.DND5E.skills[skill]?.ability;
  const skillName = game.i18n.localize(CONFIG.DND5E.skills[skill]?.label ?? skill);
  const choices = Object.entries(abilities).map(([id, a]) =>
    `<option value="${id}"${id === usual ? " selected" : ""}>${game.i18n.localize(a.label)}${id === usual ? " (default)" : ""}</option>`).join("");
  const ability = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${skillName} — roll using a different ability` },
    content: `<div class="form-group"><label>Ability</label><div class="form-fields"><select name="ability">${choices}</select></div></div>`,
    ok: { label: "Roll", callback: (event, button) => button.form.elements.ability.value },
    rejectClose: false
  });
  if ( ability ) await rollSkillWith(actor, skill, ability, { configure: true });
}

/** Called once at ready by main.mjs with the engine's shared helpers. */
export function registerSkills(deps) {
  Hooks.on("renderActorSheetV2", app => {
    const element = app.element;
    const actor = app.document ?? app.actor;
    if ( !element || (actor?.documentName !== "Actor") || !actor.system?.skills || (element.dataset.aetSkillMenu === "1") ) return;
    element.dataset.aetSkillMenu = "1";
    new foundry.applications.ux.ContextMenu(element, SELECTOR, [{
      label: "Roll using a different ability…",
      icon: "fa-solid fa-dice-d20",
      visible: () => actor.isOwner,
      onClick: (event, target) => {
        const skill = target?.dataset?.key ?? target?.closest?.("[data-key]")?.dataset.key;
        if ( skill ) pickAndRoll(actor, skill);
      }
    }], { jQuery: false, fixed: true });
  });
}

export const api = { rollSkillWith };
