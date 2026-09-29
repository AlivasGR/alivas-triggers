/**
 * Alivas's Engine of Triggers — one grouped window for the engine's world settings (Module Settings → "Automation
 * settings"). The individual settings stay registered (hidden from the flat list) and are read as before.
 */

const MODULE_ID = "alivas-engine-of-triggers";
const { ApplicationV2 } = foundry.applications.api;

/** Sections and the settings in each, in display order. */
const SECTIONS = [
  { title: "Rolling and resolving", icon: "fa-dice-d20", hint: "What the engine rolls and resolves for you. Players and NPCs are set separately.",
    keys: ["wfAttackPC", "wfAttackNPC", "wfSavePC", "wfSaveNPC", "wfHeal", "wfMastery", "wfTargetPC"] },
  { title: "Applying results", icon: "fa-wand-magic-sparkles", hint: "What happens to creatures once rolls are made.",
    keys: ["autoApplyEffects", "triggerDamage", "autoConcentration"] },
  { title: "Reactions", icon: "fa-bolt", hint: "Popups offering reactions (Shield, Counterspell, Deflect Attacks…) at the right moment.",
    keys: ["reactions", "reactionTimeout", "opportunityAttacks"] },
  { title: "Areas", icon: "fa-burst", hint: "Spell templates and auras.",
    keys: ["wfRemoveTemplates"] },
  { title: "Combat", icon: "fa-hourglass-half", hint: "Turn options on the combat tracker.",
    keys: ["delayTurn", "delayExpiry"] }
];
export const GROUPED_SETTINGS = SECTIONS.flatMap(s => s.keys);

export class AutomationSettings extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "aet-automation-settings", tag: "form", classes: ["aet-editor", "aet-settings-app"],
    window: { title: "Alivas's Engine — Automation settings", icon: "fa-solid fa-sliders", resizable: true },
    position: { width: 620, height: "auto" },
    form: { handler: AutomationSettings.#onSubmit, closeOnSubmit: true }
  };

  async _renderHTML() {
    const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
    const field = key => {
      const cfg = game.settings.settings.get(`${MODULE_ID}.${key}`);
      if ( !cfg ) return "";
      const value = game.settings.get(MODULE_ID, key);
      let input;
      if ( cfg.type === Boolean ) input = `<input type="checkbox" name="${key}"${value ? " checked" : ""}>`;
      else if ( cfg.choices ) input = `<select name="${key}">${Object.entries(cfg.choices).map(([k, l]) =>
        `<option value="${esc(k)}"${k === value ? " selected" : ""}>${esc(game.i18n.localize(l))}</option>`).join("")}</select>`;
      else if ( cfg.type === Number ) input = `<input type="number" name="${key}" value="${esc(value)}"${cfg.range ? ` min="${cfg.range.min}" max="${cfg.range.max}" step="${cfg.range.step}"` : ""} style="width:80px">`;
      else input = `<input type="text" name="${key}" value="${esc(value)}">`;
      return `<div class="aet-setting"><label><span class="aet-setting-name">${esc(game.i18n.localize(cfg.name))}</span>${input}</label>
        <p class="aet-muted">${esc(game.i18n.localize(cfg.hint ?? ""))}</p></div>`;
    };
    const html = SECTIONS.map(s => `<fieldset class="aet-setting-section"><legend><i class="fa-solid ${s.icon}"></i> ${esc(s.title)}</legend>
      <p class="aet-muted">${esc(s.hint)}</p>${s.keys.map(field).join("")}</fieldset>`).join("");
    const div = document.createElement("div");
    div.className = "aet-root aet-settings-body";
    div.innerHTML = `${html}<footer class="aet-footer"><button type="submit" class="aet-btn aet-primary"><i class="fa-solid fa-floppy-disk"></i> Save</button></footer>`;
    return div;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  static async #onSubmit(event, form, formData) {
    const data = formData.object;
    for ( const key of GROUPED_SETTINGS ) {
      const cfg = game.settings.settings.get(`${MODULE_ID}.${key}`);
      if ( !cfg ) continue;
      let value = cfg.type === Boolean ? !!data[key] : data[key];
      if ( cfg.type === Number ) value = Number(value);
      if ( value !== game.settings.get(MODULE_ID, key) ) await game.settings.set(MODULE_ID, key, value);
    }
    ui.notifications.info("Automation settings saved.");
  }
}

/** Register the menu and hide the grouped settings from the flat list. Call in "init", after the settings. */
export function registerSettingsMenu() {
  for ( const key of GROUPED_SETTINGS ) {
    const cfg = game.settings.settings.get(`${MODULE_ID}.${key}`);
    if ( cfg ) cfg.config = false;
  }
  game.settings.registerMenu(MODULE_ID, "automation", {
    name: "Automation settings", label: "Open automation settings", icon: "fa-solid fa-sliders",
    hint: "Rolling, applying, reactions and areas — everything the engine automates, in one place.",
    type: AutomationSettings, restricted: true
  });
}
